import { HttpError, json, readJson, str } from '../lib/http.js';
import { systemKey } from '../lib/keys.js';
import { hashPin, makePassRecord, timingSafeEqualHex, isWeakPin, ITER_PERMANENT } from '../lib/crypto.js';
import { createSession, getSession, requireUser, sessionCookie, clearCookie, audit, auditStmt } from '../lib/session.js';
import { getConfigValue } from '../lib/config.js';
import { setupStatus } from './setup.js';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const DUMMY_SALT = '00112233445566778899aabbccddeeff';

export async function login(request, env) {
  const body = await readJson(request);
  const username = str(body.username, 'username', { max: 40 }).toLowerCase();
  const password = str(body.password, 'password', { max: 64, trim: false });
  const now = Date.now();

  const user = await env.DB.prepare(
    `SELECT id, username, nis, name, role, class_id, pass_hash, pass_salt, pass_iter, is_default_password,
            must_change_password, active, failed_attempts, locked_until FROM users WHERE username = ?`,
  ).bind(username).first();

  if (!user) {
    await hashPin(password, DUMMY_SALT, ITER_PERMANENT, await systemKey(env)); // samakan waktu respons
    await audit(env, null, 'login_unknown_user', null, { username });
    throw new HttpError(401, 'bad_credentials', 'Username atau password salah.');
  }
  if (!user.active) throw new HttpError(403, 'inactive', 'Akun Anda dinonaktifkan. Hubungi wali kelas atau admin.');
  if (user.locked_until && user.locked_until > now) {
    const minutes = Math.ceil((user.locked_until - now) / 60000);
    throw new HttpError(423, 'locked', `Terlalu banyak percobaan salah. Coba lagi dalam ${minutes} menit.`);
  }

  const hash = await hashPin(password, user.pass_salt, user.pass_iter, await systemKey(env));
  if (!timingSafeEqualHex(hash, user.pass_hash)) {
    const fails = user.failed_attempts + 1;
    const lock = fails >= MAX_FAILS;
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?')
        .bind(lock ? 0 : fails, lock ? now + LOCK_MS : null, now, user.id),
      auditStmt(env, user.id, lock ? 'login_locked' : 'login_failed', user.id, { fails }),
    ]);
    if (lock) throw new HttpError(423, 'locked', 'Terlalu banyak percobaan salah. Akun dikunci 15 menit.');
    throw new HttpError(401, 'bad_credentials', `Username atau password salah. Sisa percobaan: ${MAX_FAILS - fails}.`);
  }

  const { token, ttl } = await createSession(env, user, request);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, user.id),
    auditStmt(env, user.id, 'login', user.id),
  ]);
  return json(
    { must_change_password: !!user.must_change_password },
    200,
    { 'Set-Cookie': sessionCookie(token, ttl) },
  );
}

export async function logout(request, env) {
  await readJson(request);
  const session = await getSession(env, request);
  if (session) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.sessionId).run();
  return json({}, 200, { 'Set-Cookie': clearCookie() });
}

export function validateNewPassword(pw, user) {
  const isStaff = user.role !== 'siswa';
  const min = isStaff ? 8 : 6;
  if (typeof pw !== 'string' || pw.length < min) throw new HttpError(400, 'weak_password', `Password minimal ${min} karakter.`);
  if (pw.length > 64) throw new HttpError(400, 'weak_password', 'Password maksimal 64 karakter.');
  const lower = pw.toLowerCase();
  if (lower === user.username || (user.nis && pw === user.nis)) {
    throw new HttpError(400, 'weak_password', 'Password tidak boleh sama dengan NIS atau username.');
  }
  if (/^\d+$/.test(pw) && isWeakPin(pw)) {
    throw new HttpError(400, 'weak_password', 'Password terlalu mudah ditebak (misalnya 123456 atau 111111).');
  }
}

export async function changePassword(request, env) {
  const { sessionId, user } = await requireUser(env, request, null, { allowPendingPin: true });
  const body = await readJson(request);
  const current = str(body.current_password, 'password lama', { max: 64, trim: false });
  const next = typeof body.new_password === 'string' ? body.new_password : '';

  const row = await env.DB.prepare('SELECT pass_hash, pass_salt, pass_iter FROM users WHERE id = ?').bind(user.id).first();
  const hash = await hashPin(current, row.pass_salt, row.pass_iter, await systemKey(env));
  if (!timingSafeEqualHex(hash, row.pass_hash)) throw new HttpError(400, 'bad_current_password', 'Password lama tidak sesuai.');
  if (next === current) throw new HttpError(400, 'same_password', 'Password baru harus berbeda dari password lama.');
  validateNewPassword(next, user);

  const rec = await makePassRecord(next, await systemKey(env), ITER_PERMANENT);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, is_default_password = 0, must_change_password = 0, updated_at = ?
        WHERE id = ?`,
    ).bind(rec.pass_hash, rec.pass_salt, rec.pass_iter, now, user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(user.id, sessionId),
    auditStmt(env, user.id, 'change_password', user.id),
  ]);
  return json({ message: 'Password berhasil diganti.' });
}

export async function me(request, env) {
  const { user } = await requireUser(env, request, null, { allowPendingPin: true });
  const [cls, school, homeroom, face] = await env.DB.batch([
    env.DB.prepare('SELECT id, name FROM classes WHERE id = ?').bind(user.class_id ?? ''),
    env.DB.prepare("SELECT value FROM app_config WHERE key = 'school_name'"),
    env.DB.prepare('SELECT id, name FROM classes WHERE homeroom_user_id = ? ORDER BY name').bind(user.id),
    env.DB.prepare('SELECT enrolled_at FROM face_profiles WHERE student_id = ?').bind(user.id),
  ]);
  return json({
    user: {
      id: user.id,
      username: user.username,
      nis: user.nis,
      name: user.name,
      role: user.role,
      class_id: user.class_id,
      class_name: cls.results[0]?.name ?? null,
      homeroom_classes: homeroom.results,
      face_enrolled: !!face.results[0],
      is_default_password: !!user.is_default_password,
    },
    must_change_password: !!user.must_change_password,
    school: { name: school.results[0]?.value ?? 'Sekolah' },
    server_time: Date.now(),
  });
}

export async function publicConfig(_request, env) {
  const setup = await setupStatus(env);
  return json({ school: { name: await getConfigValue(env, 'school_name') }, setup_needed: setup.needed }, 200, { 'Cache-Control': 'no-store' });
}
