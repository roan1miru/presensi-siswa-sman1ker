// Pemeliharaan tanpa terminal: kunci ekspor Google Sheets, backup & pemulihan dari aplikasi,
// serta reset massal password siswa ke NIS.
import { HttpError, json, readJson } from '../lib/http.js';
import { requireUser, auditStmt } from '../lib/session.js';
import { randomHex, sha256Hex, makePassRecord, ITER_TEMPORARY } from '../lib/crypto.js';
import { systemKey } from '../lib/keys.js';
import { getConfig } from '../lib/config.js';
import { ADMINS } from '../lib/scope.js';
import { backupPage, BACKUP_TABLES, KEY_COLUMN } from './export.js';

// ───────────────────────── Kunci ekspor Google Apps Script ─────────────────────────
export async function exportKey(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const b = await readJson(request);
  if (b.enable === false) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM app_config WHERE key = 'export_key_hash'"),
      auditStmt(env, user.id, 'export_key_disable'),
    ]);
    return json({ enabled: false });
  }
  const key = randomHex(24);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO app_config (key, value) VALUES ('export_key_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(await sha256Hex(key)),
    auditStmt(env, user.id, 'export_key_create'),
  ]);
  return json({ enabled: true, key }); // ditampilkan sekali; server hanya menyimpan hash-nya
}

export async function exportKeyStatus(env) {
  const row = await env.DB.prepare("SELECT 1 FROM app_config WHERE key = 'export_key_hash'").first();
  return !!row || !!(env.EXPORT_KEY && env.EXPORT_KEY.length >= 24);
}

// ───────────────────────── Backup dari aplikasi ─────────────────────────
export async function adminBackup(request, env) {
  await requireUser(env, request, ['superadmin']);
  return json(await backupPage(env, new URL(request.url)));
}

// ───────────────────────── Pemulihan ─────────────────────────
// Urutan: begin (kosongkan data, kecuali akun superadmin yang sedang memulihkan) → chunk per tabel
// sesuai BACKUP_TABLES → classes_homeroom → finish. Setiap chunk satu transaksi D1; bila kuota
// tulis harian habis, lanjutkan esok hari dari tabel/baris terakhir (status disimpan di restore_state).
const DATA_TABLES_DELETE = ['attendance', 'attendance_tokens', 'attempt_logs', 'face_profiles', 'schedules', 'holidays', 'audit_logs'];
const USER_REF_COLS = ['created_by', 'enrolled_by', 'admin_id', 'homeroom_user_id', 'user_id', 'student_id', 'actor_id', 'target_id', 'started_by'];
const columnCache = new Map();

async function columns(env, table) {
  if (!columnCache.has(table)) {
    const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`).bind(table).all();
    columnCache.set(table, results.map((r) => r.name));
  }
  return columnCache.get(table);
}

async function restoreState(env, user) {
  const st = await env.DB.prepare('SELECT * FROM restore_state WHERE id = 1').first();
  if (!st) throw new HttpError(409, 'no_restore', 'Belum ada proses pemulihan yang dimulai.');
  if (st.started_by !== user.id) throw new HttpError(403, 'forbidden', 'Pemulihan dimulai oleh admin lain.');
  return { ...st, progress: JSON.parse(st.progress) };
}

export async function restoreBegin(request, env) {
  const { user } = await requireUser(env, request, ['superadmin']);
  const b = await readJson(request);
  if (b.format !== 'presensi-backup-v1') throw new HttpError(400, 'bad_format', 'File bukan backup aplikasi ini.');
  if (b.confirm !== 'PULIHKAN') throw new HttpError(400, 'not_confirmed', 'Ketik PULIHKAN untuk mengonfirmasi.');
  const st = await env.DB.prepare('SELECT key_check FROM setup_state WHERE id = 1').first();
  const sameKey = !!b.key_check && st?.key_check === b.key_check ? 1 : 0;
  // Akun superadmin di backup yang ber-username sama dengan admin saat ini dipetakan ke akun ini.
  const mapFrom = typeof b.self_old_id === 'string' && b.self_old_id !== user.id ? b.self_old_id : null;
  const now = Date.now();
  await env.DB.batch([
    ...DATA_TABLES_DELETE.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    env.DB.prepare('UPDATE classes SET homeroom_user_id = NULL'),
    env.DB.prepare('DELETE FROM users WHERE id <> ?').bind(user.id),
    env.DB.prepare('DELETE FROM classes'),
    env.DB.prepare('INSERT INTO restore_state (id, started_at, started_by, same_key, progress) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, started_by = excluded.started_by, same_key = excluded.same_key, progress = excluded.progress')
      .bind(now, user.id, sameKey, JSON.stringify({ map_from: mapFrom, self_username: user.username, done: {} })),
    auditStmt(env, user.id, 'restore_begin', null, { same_key: sameKey }),
  ]);
  return json({ same_key: !!sameKey });
}

export async function restoreChunk(request, env) {
  const { user } = await requireUser(env, request, ['superadmin']);
  const b = await readJson(request, 900 * 1024);
  const st = await restoreState(env, user);
  const table = b.table;
  if (!Array.isArray(b.rows) || b.rows.length > 200) throw new HttpError(400, 'bad_rows', 'Maksimal 200 baris per kiriman.');
  const map = (v) => (st.progress.map_from && v === st.progress.map_from ? user.id : v);

  const stmts = [];
  if (table === 'classes_homeroom') {
    for (const r of b.rows) stmts.push(env.DB.prepare('UPDATE classes SET homeroom_user_id = ? WHERE id = ?').bind(map(r.homeroom_user_id) ?? null, r.id));
  } else {
    if (!BACKUP_TABLES.includes(table)) throw new HttpError(400, 'bad_table', 'Tabel tidak dikenal.');
    const cols = await columns(env, table);
    const key = KEY_COLUMN[table] || 'id';
    for (const raw of b.rows) {
      const r = { ...raw };
      if (table === 'users') {
        if (r.id === user.id || r.id === st.progress.map_from || r.username === st.progress.self_username) continue;
        if (!st.same_key) {
          // Kunci berbeda: hash lama tidak bisa dipakai. Akun ditandai wajib reset.
          r.pass_hash = 'perlu-reset';
          r.is_default_password = 1;
          r.must_change_password = 1;
        }
      }
      if (table === 'classes') r.homeroom_user_id = null; // dipasang ulang setelah users dipulihkan
      if (table === 'app_config' && r.key === 'export_key_hash') continue;
      for (const c of USER_REF_COLS) if (c in r) r[c] = map(r[c]);
      const use = cols.filter((c) => c in r);
      if (!use.includes(key)) continue;
      const vals = use.map((c) => {
        if (table === 'face_profiles' && c === 'embedding') {
          const bin = atob(String(r.embedding));
          return Uint8Array.from(bin, (ch) => ch.charCodeAt(0)).buffer;
        }
        return r[c] ?? null;
      });
      const updates = use.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`).join(', ');
      stmts.push(env.DB.prepare(
        `INSERT INTO ${table} (${use.join(', ')}) VALUES (${use.map(() => '?').join(', ')})
         ON CONFLICT(${key}) DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`,
      ).bind(...vals));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  st.progress.done[table] = (st.progress.done[table] || 0) + b.rows.length;
  await env.DB.prepare('UPDATE restore_state SET progress = ? WHERE id = 1').bind(JSON.stringify(st.progress)).run();
  return json({ written: stmts.length });
}

export async function restoreFinish(request, env) {
  const { user } = await requireUser(env, request, ['superadmin']);
  await readJson(request);
  const st = await restoreState(env, user);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM restore_state WHERE id = 1'),
    auditStmt(env, user.id, 'restore_finish', null, st.progress.done),
  ]);
  return json({ same_key: !!st.same_key, done: st.progress.done });
}

export async function restoreStatus(request, env) {
  await requireUser(env, request, ['superadmin']);
  const st = await env.DB.prepare('SELECT started_at, same_key, progress FROM restore_state WHERE id = 1').first();
  return json({ restore: st ? { ...st, progress: JSON.parse(st.progress) } : null });
}

// ───────────────────────── Reset massal password siswa ke NIS ─────────────────────────
// Dipakai setelah pemulihan ke instalasi baru (kunci sistem berbeda). 20 siswa per panggilan
// agar hashing tetap di bawah batas CPU 10 ms paket gratis.
export async function resetAllStudents(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const b = await readJson(request);
  const after = typeof b.after === 'string' ? b.after : '';
  const onlyBroken = b.only_broken !== false;
  const { results } = await env.DB.prepare(
    `SELECT id, nis FROM users WHERE role = 'siswa' AND nis IS NOT NULL AND id > ? ${onlyBroken ? "AND pass_hash = 'perlu-reset'" : ''} ORDER BY id LIMIT 20`,
  ).bind(after).all();
  if (!results.length) return json({ done: true, count: 0 });
  const key = await systemKey(env);
  const force = (await getConfig(env)).force_password_change ? 1 : 0;
  const now = Date.now();
  const stmts = [];
  for (const s of results) {
    const rec = await makePassRecord(s.nis, key, ITER_TEMPORARY);
    stmts.push(env.DB.prepare(
      `UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, is_default_password = 1, must_change_password = ?,
              failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
    ).bind(rec.pass_hash, rec.pass_salt, rec.pass_iter, force, now, s.id));
  }
  stmts.push(auditStmt(env, user.id, 'reset_students_bulk', null, { count: results.length }));
  await env.DB.batch(stmts);
  return json({ done: results.length < 20, count: results.length, after: results.at(-1).id });
}
