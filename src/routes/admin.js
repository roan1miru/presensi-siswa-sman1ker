import { HttpError, json, readJson, str } from '../lib/http.js';
import { systemKey } from '../lib/keys.js';
import { exportKeyStatus } from './maintenance.js';
import { generatePassword, makePassRecord, ITER_TEMPORARY } from '../lib/crypto.js';
import { requireUser, audit, auditStmt } from '../lib/session.js';
import { getConfig } from '../lib/config.js';
import { ADMINS, STAFF, scopeClassIds, placeholders } from '../lib/scope.js';
import { clientIp, validLat, validLng } from '../lib/geo.js';
import { isDate, jakarta } from '../lib/time.js';

export const IMPORT_CHUNK = 20; // ±0,3 ms hashing per siswa → aman di bawah 10 ms CPU
export const studentUsername = (nis) => 's' + String(nis).toLowerCase();

// ───────────────────────── Kelas ─────────────────────────
export async function listClasses(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const scope = await scopeClassIds(env, user);
  if (scope && scope.length === 0) return json({ classes: [] });
  const where = scope ? `WHERE c.id IN (${placeholders(scope.length)})` : '';
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.name, c.homeroom_user_id, h.name AS homeroom_name,
            (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'siswa' AND u.active = 1) AS students,
            (SELECT COUNT(*) FROM users u JOIN face_profiles f ON f.student_id = u.id
              WHERE u.class_id = c.id AND u.role = 'siswa' AND u.active = 1) AS faces
       FROM classes c LEFT JOIN users h ON h.id = c.homeroom_user_id
       ${where} ORDER BY c.name`,
  ).bind(...(scope ?? [])).all();
  return json({ classes: results });
}

export async function saveClass(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const body = await readJson(request);
  const name = str(body.name, 'nama kelas', { max: 40 }).replace(/\s+/g, ' ');
  const homeroom = body.homeroom_user_id || null;
  if (homeroom) {
    const h = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'wali' AND active = 1").bind(homeroom).first();
    if (!h) throw new HttpError(400, 'invalid_homeroom', 'Wali kelas tidak ditemukan atau bukan akun wali.');
  }
  const dup = await env.DB.prepare('SELECT id FROM classes WHERE name = ? AND id <> ?').bind(name, body.id || '').first();
  if (dup) throw new HttpError(409, 'duplicate_class', `Kelas ${name} sudah ada.`);

  if (body.id) {
    const res = await env.DB.prepare('UPDATE classes SET name = ?, homeroom_user_id = ? WHERE id = ?').bind(name, homeroom, body.id).run();
    if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Kelas tidak ditemukan.');
    await audit(env, user.id, 'class_update', body.id, { name, homeroom });
    return json({ id: body.id });
  }
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO classes (id, name, homeroom_user_id, created_at) VALUES (?, ?, ?, ?)').bind(id, name, homeroom, Date.now()),
    auditStmt(env, user.id, 'class_create', id, { name, homeroom }),
  ]);
  return json({ id }, 201);
}

export async function deleteClass(request, env, { id }) {
  const { user } = await requireUser(env, request, ADMINS);
  await readJson(request);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE class_id = ? AND role = 'siswa'").bind(id).first();
  if (n.n > 0) throw new HttpError(409, 'class_not_empty', `Kelas masih berisi ${n.n} siswa. Pindahkan siswanya terlebih dahulu.`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM classes WHERE id = ?').bind(id),
    auditStmt(env, user.id, 'class_delete', id),
  ]);
  return json({});
}

// ───────────────────────── Siswa ─────────────────────────
export async function listStudents(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const url = new URL(request.url);
  const classId = url.searchParams.get('class_id') || '';
  const scope = await scopeClassIds(env, user);

  const cond = ["u.role = 'siswa'"];
  const args = [];
  if (scope) {
    if (classId && !scope.includes(classId)) throw new HttpError(403, 'forbidden', 'Anda hanya dapat melihat siswa kelas yang Anda ampu.');
    const ids = classId ? [classId] : scope;
    if (ids.length === 0) return json({ students: [], server_time: Date.now() });
    cond.push(`u.class_id IN (${placeholders(ids.length)})`);
    args.push(...ids);
  } else if (classId === '_none') {
    cond.push('u.class_id IS NULL');
  } else if (classId) {
    cond.push('u.class_id = ?');
    args.push(classId);
  }
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.nis, u.name, u.class_id, c.name AS class_name, u.is_default_password,
            u.active, u.locked_until, u.last_login_at, f.enrolled_at AS face_enrolled_at
       FROM users u
       LEFT JOIN classes c ON c.id = u.class_id
       LEFT JOIN face_profiles f ON f.student_id = u.id
      WHERE ${cond.join(' AND ')}
      ORDER BY c.name, u.name LIMIT 2000`,
  ).bind(...args).all();
  return json({ students: results, server_time: Date.now() });
}

export async function updateStudent(request, env, { id }) {
  const { user } = await requireUser(env, request, ADMINS);
  const body = await readJson(request);
  const name = str(body.name, 'nama', { min: 2, max: 100 }).replace(/\s+/g, ' ');
  const classId = body.class_id || null;
  if (classId && !(await env.DB.prepare('SELECT 1 FROM classes WHERE id = ?').bind(classId).first())) {
    throw new HttpError(400, 'invalid_class', 'Kelas tidak ditemukan.');
  }
  const res = await env.DB.prepare("UPDATE users SET name = ?, class_id = ?, updated_at = ? WHERE id = ? AND role = 'siswa'")
    .bind(name, classId, Date.now(), id).run();
  if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Siswa tidak ditemukan.');
  await audit(env, user.id, 'student_update', id, { name, classId });
  return json({});
}

/**
 * Impor bertahap (maks. IMPORT_CHUNK baris per permintaan).
 * NIS baru → akun s<NIS> dengan password awal = NIS. NIS lama → nama/kelas diperbarui, password tidak berubah.
 */
export async function importStudents(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const body = await readJson(request, 32 * 1024);
  if (!Array.isArray(body.rows) || body.rows.length === 0) throw new HttpError(400, 'empty', 'Tidak ada data siswa yang dikirim.');
  if (body.rows.length > IMPORT_CHUNK) throw new HttpError(400, 'chunk_too_large', `Maksimal ${IMPORT_CHUNK} siswa per permintaan.`);
  const forceChange = (await getConfig(env)).force_password_change ? 1 : 0;

  const results = [];
  const valid = [];
  const seen = new Set();
  for (const raw of body.rows) {
    const nis = String(raw?.nis ?? '').trim();
    const name = String(raw?.name ?? '').trim().replace(/\s+/g, ' ');
    const className = String(raw?.class_name ?? '').trim().replace(/\s+/g, ' ');
    const out = { nis, name, class_name: className };
    if (!/^[0-9A-Za-z]{3,20}$/.test(nis)) results.push({ ...out, status: 'error', message: 'NIS harus 3–20 karakter angka/huruf.' });
    else if (seen.has(nis)) results.push({ ...out, status: 'error', message: 'NIS ganda di file.' });
    else if (name.length < 2 || name.length > 100) results.push({ ...out, status: 'error', message: 'Nama harus 2–100 karakter.' });
    else if (className.length < 1 || className.length > 40) results.push({ ...out, status: 'error', message: 'Nama kelas wajib diisi (maks. 40 karakter).' });
    else { seen.add(nis); valid.push(out); }
  }
  if (valid.length === 0) return json({ results });

  const now = Date.now();
  const classNames = [...new Set(valid.map((r) => r.class_name))];
  await env.DB.batch(
    classNames.map((n) => env.DB.prepare('INSERT OR IGNORE INTO classes (id, name, created_at) VALUES (?, ?, ?)').bind(crypto.randomUUID(), n, now)),
  );
  const classRows = await env.DB.prepare(`SELECT id, name FROM classes WHERE name IN (${placeholders(classNames.length)})`).bind(...classNames).all();
  const classId = Object.fromEntries(classRows.results.map((c) => [c.name, c.id]));

  const usernames = valid.map((r) => studentUsername(r.nis));
  const existing = await env.DB.prepare(`SELECT id, username, role FROM users WHERE username IN (${placeholders(usernames.length)})`)
    .bind(...usernames).all();
  const byUsername = Object.fromEntries(existing.results.map((u) => [u.username, u]));

  const stmts = [];
  for (const r of valid) {
    const username = studentUsername(r.nis);
    const found = byUsername[username];
    if (found && found.role !== 'siswa') {
      results.push({ ...r, status: 'error', message: `Username ${username} sudah dipakai akun guru/admin.` });
      continue;
    }
    if (found) {
      stmts.push(env.DB.prepare('UPDATE users SET name = ?, class_id = ?, updated_at = ? WHERE id = ?').bind(r.name, classId[r.class_name], now, found.id));
      results.push({ ...r, username, status: 'updated' });
      continue;
    }
    const rec = await makePassRecord(r.nis, await systemKey(env), ITER_TEMPORARY);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO users (id, username, nis, name, role, class_id, pass_hash, pass_salt, pass_iter,
                            is_default_password, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'siswa', ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), username, r.nis, r.name, classId[r.class_name], rec.pass_hash, rec.pass_salt, rec.pass_iter, forceChange, now, now),
    );
    results.push({ ...r, username, status: 'created' });
  }
  const created = results.filter((r) => r.status === 'created').length;
  const updated = results.filter((r) => r.status === 'updated').length;
  stmts.push(auditStmt(env, user.id, 'students_import', null, { created, updated, errors: results.length - created - updated }));
  await env.DB.batch(stmts); // satu transaksi per chunk
  return json({ results });
}

// ───────────────────────── Akun: reset & status ─────────────────────────
async function loadTargetFor(env, actor, targetId) {
  const target = await env.DB.prepare('SELECT id, username, nis, name, role, class_id FROM users WHERE id = ?').bind(targetId).first();
  if (!target) throw new HttpError(404, 'not_found', 'Akun tidak ditemukan.');
  if (target.id === actor.id) throw new HttpError(400, 'self', 'Gunakan menu Ganti password untuk akun Anda sendiri.');
  const allowed = { superadmin: ['superadmin', 'admin', 'wali', 'siswa'], admin: ['wali', 'siswa'], wali: ['siswa'] }[actor.role] || [];
  if (!allowed.includes(target.role)) throw new HttpError(403, 'forbidden', 'Anda tidak berwenang mengubah akun ini.');
  if (actor.role === 'wali') {
    const scope = await scopeClassIds(env, actor);
    if (!scope.includes(target.class_id)) throw new HttpError(403, 'forbidden', 'Siswa ini bukan anggota kelas yang Anda ampu.');
  }
  return target;
}

/** Siswa: password kembali ke NIS. Guru/admin: sandi sementara acak yang ditampilkan sekali. */
export async function resetPassword(request, env, { id }) {
  const { user } = await requireUser(env, request, STAFF);
  await readJson(request);
  const target = await loadTargetFor(env, user, id);
  const isStudent = target.role === 'siswa';
  const secret = isStudent ? target.nis : generatePassword();
  const mustChange = isStudent ? ((await getConfig(env)).force_password_change ? 1 : 0) : 1;
  const rec = await makePassRecord(secret, await systemKey(env), ITER_TEMPORARY);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, is_default_password = 1, must_change_password = ?,
              failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
    ).bind(rec.pass_hash, rec.pass_salt, rec.pass_iter, mustChange, now, target.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
    auditStmt(env, user.id, 'reset_password', target.id),
  ]);
  return json(isStudent
    ? { username: target.username, name: target.name, reset_to: 'nis' }
    : { username: target.username, name: target.name, password: secret });
}

export async function unlockUser(request, env, { id }) {
  const { user } = await requireUser(env, request, STAFF);
  await readJson(request);
  const target = await loadTargetFor(env, user, id);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').bind(Date.now(), target.id),
    auditStmt(env, user.id, 'unlock', target.id),
  ]);
  return json({});
}

export async function setActive(request, env, { id }) {
  const { user } = await requireUser(env, request, ADMINS);
  const body = await readJson(request);
  const active = body.active ? 1 : 0;
  const target = await loadTargetFor(env, user, id);
  const stmts = [
    env.DB.prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?').bind(active, Date.now(), target.id),
    auditStmt(env, user.id, active ? 'user_activate' : 'user_deactivate', target.id),
  ];
  if (!active) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id));
  await env.DB.batch(stmts);
  return json({});
}

// ───────────────────────── Akun guru & admin ─────────────────────────
export async function listStaff(request, env) {
  await requireUser(env, request, ADMINS);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role, u.active, u.is_default_password, u.last_login_at, u.locked_until,
            (SELECT GROUP_CONCAT(c.name, ', ') FROM classes c WHERE c.homeroom_user_id = u.id) AS classes
       FROM users u WHERE u.role IN ('superadmin','admin','wali')
      ORDER BY CASE u.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
  ).all();
  return json({ staff: results, server_time: Date.now() });
}

export async function createStaff(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const body = await readJson(request);
  const username = str(body.username, 'username', { min: 3, max: 30 }).toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,29}$/.test(username) || /^s\d/.test(username)) {
    throw new HttpError(400, 'invalid_username',
      'Username 3–30 karakter, diawali huruf (huruf kecil, angka, titik, minus). Awalan s+angka dipakai untuk siswa.');
  }
  const name = str(body.name, 'nama', { min: 2, max: 100 });
  const role = body.role;
  const allowed = user.role === 'superadmin' ? ['superadmin', 'admin', 'wali'] : ['wali'];
  if (!allowed.includes(role)) throw new HttpError(403, 'forbidden', 'Anda tidak berwenang membuat akun dengan peran ini.');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) {
    throw new HttpError(409, 'duplicate_username', 'Username sudah dipakai.');
  }
  const classId = role === 'wali' && body.class_id ? body.class_id : null;
  if (classId && !(await env.DB.prepare('SELECT 1 FROM classes WHERE id = ?').bind(classId).first())) {
    throw new HttpError(400, 'invalid_class', 'Kelas tidak ditemukan.');
  }
  const password = generatePassword();
  const rec = await makePassRecord(password, await systemKey(env), ITER_TEMPORARY);
  const id = crypto.randomUUID();
  const now = Date.now();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO users (id, username, name, role, pass_hash, pass_salt, pass_iter, is_default_password, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    ).bind(id, username, name, role, rec.pass_hash, rec.pass_salt, rec.pass_iter, now, now),
    auditStmt(env, user.id, 'staff_create', id, { username, role, classId }),
  ];
  if (classId) stmts.push(env.DB.prepare('UPDATE classes SET homeroom_user_id = ? WHERE id = ?').bind(id, classId));
  await env.DB.batch(stmts);
  return json({ id, username, name, role, password }, 201);
}

export async function updateStaff(request, env, { id }) {
  const { user } = await requireUser(env, request, ADMINS);
  const body = await readJson(request);
  const target = await loadTargetFor(env, user, id);
  if (target.role === 'siswa') throw new HttpError(400, 'not_staff', 'Gunakan menu Siswa untuk mengubah data siswa.');
  const name = str(body.name, 'nama', { min: 2, max: 100 });
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').bind(name, Date.now(), id),
    auditStmt(env, user.id, 'staff_update', id, { name }),
  ]);
  return json({});
}

// ───────────────────────── Pengaturan sekolah ─────────────────────────
export async function getSettings(request, env) {
  await requireUser(env, request, ADMINS);
  return json({ settings: await getConfig(env), my_ip: clientIp(request), export_enabled: await exportKeyStatus(env) });
}

export async function saveSettings(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const b = await readJson(request);
  const updates = {};
  if (b.school_name !== undefined) updates.school_name = str(b.school_name, 'nama sekolah', { min: 3, max: 80 });
  if (b.default_lat !== undefined || b.default_lng !== undefined) {
    if (b.default_lat === null && b.default_lng === null) {
      updates.default_lat = '';
      updates.default_lng = '';
    } else {
      if (!validLat(b.default_lat) || !validLng(b.default_lng)) throw new HttpError(400, 'invalid_location', 'Koordinat sekolah tidak valid.');
      updates.default_lat = String(b.default_lat);
      updates.default_lng = String(b.default_lng);
    }
  }
  if (b.default_radius_m !== undefined) {
    const r = Number(b.default_radius_m);
    if (!(r >= 20 && r <= 2000)) throw new HttpError(400, 'invalid_radius', 'Radius harus 20–2000 meter.');
    updates.default_radius_m = String(Math.round(r));
  }
  if (b.default_max_accuracy_m !== undefined) {
    const a = Number(b.default_max_accuracy_m);
    if (!(a >= 10 && a <= 200)) throw new HttpError(400, 'invalid_accuracy', 'Batas akurasi harus 10–200 meter.');
    updates.default_max_accuracy_m = String(Math.round(a));
  }
  if (b.school_ips !== undefined) {
    if (!Array.isArray(b.school_ips) || b.school_ips.length > 20) throw new HttpError(400, 'invalid_ips', 'Daftar IP maksimal 20 entri.');
    const ips = b.school_ips.map((x) => String(x).trim()).filter(Boolean);
    if (ips.some((x) => x.length > 50 || !/^[0-9a-fA-F:.\/*]+$/.test(x))) throw new HttpError(400, 'invalid_ips', 'Format IP tidak valid.');
    updates.school_ips = JSON.stringify([...new Set(ips)]);
  }
  if (b.face_threshold !== undefined) {
    const t = Number(b.face_threshold);
    if (!(t >= 0.3 && t <= 0.7)) throw new HttpError(400, 'invalid_threshold', 'Ambang wajah harus 0,30–0,70.');
    updates.face_threshold = t.toFixed(2);
  }
  if (b.force_password_change !== undefined) updates.force_password_change = b.force_password_change ? '1' : '0';

  const keys = Object.keys(updates);
  if (!keys.length) return json({});
  await env.DB.batch([
    ...keys.map((k) => env.DB.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, updates[k])),
    auditStmt(env, user.id, 'settings_update', null, updates),
  ]);
  return json({ settings: await getConfig(env) });
}

// ───────────────────────── Hari libur ─────────────────────────
export async function listHolidays(request, env) {
  await requireUser(env, request, STAFF);
  const from = jakarta().date.slice(0, 4) + '-01-01';
  const { results } = await env.DB.prepare('SELECT date, name FROM holidays WHERE date >= ? ORDER BY date').bind(from).all();
  return json({ holidays: results });
}

export async function saveHoliday(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const b = await readJson(request);
  if (!isDate(b.date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  const name = str(b.name, 'keterangan', { min: 2, max: 80 });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name').bind(b.date, name),
    auditStmt(env, user.id, 'holiday_save', b.date, { name }),
  ]);
  return json({});
}

export async function deleteHoliday(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const b = await readJson(request);
  if (!isDate(b.date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM holidays WHERE date = ?').bind(b.date),
    auditStmt(env, user.id, 'holiday_delete', b.date),
  ]);
  return json({});
}
