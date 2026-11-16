// Sesi berbasis cookie: token acak di browser, hanya SHA-256-nya yang disimpan di D1.
import { HttpError } from './http.js';
import { randomHex, sha256Hex } from './crypto.js';

export const COOKIE = '__Host-sid';
const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = { siswa: 14 * DAY, wali: 12 * 60 * 60 * 1000, admin: 12 * 60 * 60 * 1000, superadmin: 12 * 60 * 60 * 1000 };

function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token, maxAgeMs) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function createSession(env, user, request) {
  const token = randomHex(32);
  const now = Date.now();
  const ttl = SESSION_TTL[user.role];
  await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), user.id, now, now + ttl, (request.headers.get('User-Agent') || '').slice(0, 200))
    .run();
  return { token, ttl };
}

/** Mengembalikan { sessionId, user } atau null. Satu query JOIN per permintaan. */
export async function getSession(env, request) {
  const token = readCookie(request, COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const sid = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.nis, u.name, u.role, u.class_id, u.must_change_password, u.is_default_password, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  ).bind(sid).first();
  if (!row) return null;
  if (row.expires_at < Date.now() || !row.active) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return null;
  }
  const { session_id, expires_at, ...user } = row;
  return { sessionId: session_id, user };
}

/**
 * Wajib login. Jika allowPendingPin=false, akun yang wajib mengganti password
 * hanya boleh memanggil endpoint ganti password, /me, dan logout.
 */
export async function requireUser(env, request, roles = null, { allowPendingPin = false } = {}) {
  const session = await getSession(env, request);
  if (!session) throw new HttpError(401, 'unauthenticated', 'Sesi berakhir. Silakan masuk kembali.');
  if (session.user.must_change_password && !allowPendingPin) {
    throw new HttpError(403, 'must_change_password', 'Anda harus mengganti password terlebih dahulu.');
  }
  if (roles && !roles.includes(session.user.role)) {
    throw new HttpError(403, 'forbidden', 'Anda tidak memiliki akses ke fitur ini.');
  }
  return session;
}

export async function audit(env, actorId, action, targetId = null, detail = null) {
  await env.DB.prepare('INSERT INTO audit_logs (ts, actor_id, action, target_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), actorId, action, targetId, detail == null ? null : JSON.stringify(detail).slice(0, 1000))
    .run();
}

export function auditStmt(env, actorId, action, targetId = null, detail = null) {
  return env.DB.prepare('INSERT INTO audit_logs (ts, actor_id, action, target_id, detail) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), actorId, action, targetId, detail == null ? null : JSON.stringify(detail).slice(0, 1000));
}
