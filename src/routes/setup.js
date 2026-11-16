// Instalasi awal tanpa terminal: membuat superadmin pertama + kunci sistem.
// Pengaman:
//  1. Hanya bisa dipakai bila tabel setup_state masih kosong (baris id=1 belum ada).
//  2. Atomik: setup_state(id=1) dan akun superadmin disisipkan dalam satu transaksi D1;
//     PRIMARY KEY menjamin hanya satu permintaan yang menang walau dua orang menekan bersamaan.
//  3. Wajib kode instalasi (secret SETUP_CODE yang diisi pemilik di formulir deploy Cloudflare),
//     agar orang lain yang lebih dulu menemukan alamat aplikasi tidak bisa mengambil alih.
//  4. Maksimal 10 percobaan kode salah per 15 menit.
//  5. Setelah selesai, endpoint ini menolak permanen. Pengecualian satu-satunya: "pemulihan"
//     bila kunci sistem di KV hilang (>10 menit setelah instalasi), tetap memerlukan kode instalasi.
import { HttpError, json, readJson, str } from '../lib/http.js';
import { makePassRecord, randomHex, sha256Hex, timingSafeEqualHex, isWeakPin, ITER_PERMANENT } from '../lib/crypto.js';
import { createSession, sessionCookie, auditStmt } from '../lib/session.js';
import { KEY_NAME, keyCheck, readStoredKey, rememberKey, requireKv, forgetKey } from '../lib/keys.js';
import { clientIp } from '../lib/geo.js';

const MIN_CODE = 10;
// Nilai contoh di .dev.vars.example (publik di GitHub) tidak boleh dipakai sebagai kode sungguhan.
const PLACEHOLDER = 'GANTI-dengan-kata-rahasia-anda';
const codeReady = (env) => typeof env.SETUP_CODE === 'string' && env.SETUP_CODE.trim().length >= MIN_CODE && env.SETUP_CODE.trim() !== PLACEHOLDER;
const MAX_FAILS = 10;
const WINDOW = 15 * 60 * 1000;
const RECOVERY_AFTER = 10 * 60 * 1000;

export async function setupStatus(env) {
  requireKv(env);
  const state = await env.DB.prepare('SELECT completed_at FROM setup_state WHERE id = 1').first();
  if (!state) return { needed: true, recovery: false };
  const key = await readStoredKey(env);
  // KV hilang setelah instalasi → mode pemulihan (tidak dalam 10 menit pertama: KV bisa terlambat sinkron).
  const recovery = !key && Date.now() - state.completed_at > RECOVERY_AFTER;
  return { needed: recovery, recovery };
}

export async function status(_request, env) {
  const s = await setupStatus(env);
  return json({ ...s, has_code: codeReady(env) });
}

export async function install(request, env) {
  const b = await readJson(request);
  const s = await setupStatus(env);
  if (!s.needed) throw new HttpError(410, 'already_installed', 'Aplikasi sudah diinstal. Silakan masuk dengan akun admin.');
  if (!codeReady(env)) {
    throw new HttpError(503, 'no_setup_code', 'Kode instalasi belum diatur di Cloudflare. Ikuti langkah "Kode instalasi belum diatur" di panduan.');
  }

  const now = Date.now();
  const ip = clientIp(request);
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM setup_attempts WHERE ts > ?').bind(now - WINDOW).first();
  if (fails.n >= MAX_FAILS) throw new HttpError(429, 'too_many_attempts', 'Terlalu banyak kode salah. Coba lagi 15 menit lagi.');
  const code = typeof b.code === 'string' ? b.code : '';
  if (!timingSafeEqualHex(await sha256Hex(code.trim()), await sha256Hex(env.SETUP_CODE.trim()))) {
    await env.DB.prepare('INSERT INTO setup_attempts (ts, ip) VALUES (?, ?)').bind(now, ip).run();
    throw new HttpError(401, 'bad_setup_code', `Kode instalasi salah. Sisa percobaan: ${MAX_FAILS - fails.n - 1}.`);
  }

  const name = str(b.name, 'nama', { min: 2, max: 100 });
  const username = str(b.username, 'username', { min: 3, max: 30 }).toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,29}$/.test(username) || /^s\d/.test(username)) {
    throw new HttpError(400, 'invalid_username', 'Username 3–30 karakter, diawali huruf (huruf kecil, angka, titik, minus). Awalan s+angka dipakai siswa.');
  }
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < 10) throw new HttpError(400, 'weak_password', 'Password admin minimal 10 karakter.');
  if (password.length > 64) throw new HttpError(400, 'weak_password', 'Password maksimal 64 karakter.');
  if (password.toLowerCase().includes(username) || (/^\d+$/.test(password) && isWeakPin(password)) || password === env.SETUP_CODE) {
    throw new HttpError(400, 'weak_password', 'Password terlalu mudah ditebak atau sama dengan kode instalasi/username.');
  }

  // Kunci sistem baru (64 karakter hex dari CSPRNG) — unik untuk setiap instalasi.
  const key = randomHex(32);
  const check = await keyCheck(key);
  const rec = await makePassRecord(password, key, ITER_PERMANENT);
  let adminId = crypto.randomUUID();

  if (!s.recovery) {
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO setup_state (id, completed_at, admin_id, key_check) VALUES (1, ?, ?, ?)').bind(now, adminId, check),
        env.DB.prepare(
          `INSERT INTO users (id, username, name, role, pass_hash, pass_salt, pass_iter, is_default_password, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, 'superadmin', ?, ?, ?, 0, 0, ?, ?)`,
        ).bind(adminId, username, name, rec.pass_hash, rec.pass_salt, rec.pass_iter, now, now),
        auditStmt(env, adminId, 'install', adminId, { username }),
      ]);
    } catch (e) {
      if (String(e.message || e).includes('UNIQUE')) {
        const done = await env.DB.prepare('SELECT 1 FROM setup_state WHERE id = 1').first();
        if (done) throw new HttpError(409, 'already_installed', 'Instalasi baru saja diselesaikan oleh orang lain. Hubungi pemilik aplikasi.');
        throw new HttpError(409, 'duplicate_username', 'Username sudah dipakai.');
      }
      throw e;
    }
    try {
      await env.KEYS.put(KEY_NAME, key);
    } catch (e) {
      // Batalkan agar instalasi bisa diulang; jangan biarkan admin tanpa kunci.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM audit_logs WHERE actor_id = ?').bind(adminId),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(adminId),
        env.DB.prepare('DELETE FROM setup_state WHERE id = 1 AND admin_id = ?').bind(adminId),
      ]);
      throw new HttpError(503, 'kv_failed', 'Kunci sistem gagal disimpan. Coba lagi beberapa saat lagi.');
    }
  } else {
    // Pemulihan: kunci lama hilang sehingga semua password tidak bisa diverifikasi.
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    const old = await env.DB.prepare('SELECT completed_at FROM setup_state WHERE id = 1').first();
    if (existing) adminId = existing.id;
    const res = await env.DB.batch([
      env.DB.prepare('UPDATE setup_state SET completed_at = ?, admin_id = ?, key_check = ? WHERE id = 1 AND completed_at = ?').bind(now, adminId, check, old.completed_at),
      existing
        ? env.DB.prepare(`UPDATE users SET name = ?, role = 'superadmin', active = 1, pass_hash = ?, pass_salt = ?, pass_iter = ?, is_default_password = 0,
                          must_change_password = 0, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`)
          .bind(name, rec.pass_hash, rec.pass_salt, rec.pass_iter, now, adminId)
        : env.DB.prepare(`INSERT INTO users (id, username, name, role, pass_hash, pass_salt, pass_iter, is_default_password, must_change_password, created_at, updated_at)
                          VALUES (?, ?, ?, 'superadmin', ?, ?, ?, 0, 0, ?, ?)`).bind(adminId, username, name, rec.pass_hash, rec.pass_salt, rec.pass_iter, now, now),
      // Semua password lain dibuat dengan kunci yang hilang → tandai agar bisa direset massal ke NIS.
      env.DB.prepare("UPDATE users SET pass_hash = 'perlu-reset', is_default_password = 1, must_change_password = 1 WHERE id <> ?").bind(adminId),
      env.DB.prepare('DELETE FROM sessions'),
      auditStmt(env, adminId, 'install_recovery', adminId, { username }),
    ]);
    if (!res[0].meta.changes) throw new HttpError(409, 'already_installed', 'Pemulihan sedang dilakukan dari perangkat lain.');
    forgetKey();
    await env.KEYS.put(KEY_NAME, key);
  }

  rememberKey(key);
  const { token, ttl } = await createSession(env, { id: adminId, role: 'superadmin' }, request);
  return json({ recovery: s.recovery, username }, 200, { 'Set-Cookie': sessionCookie(token, ttl) });
}
