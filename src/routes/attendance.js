import { HttpError, json, readJson } from '../lib/http.js';
import { requireUser, auditStmt } from '../lib/session.js';
import { randomHex, sha256Hex, randomInt } from '../lib/crypto.js';
import { STAFF, scopeClassIds, scheduleAppliesToClass, scheduleClassIds, placeholders } from '../lib/scope.js';
import { jakarta, toMinutes, isDate, addDays, weekdayOf } from '../lib/time.js';
import { haversine, validLat, validLng, ipMatches, clientIp } from '../lib/geo.js';
import { getConfig } from '../lib/config.js';
import { schedulesOn, sessionState, publicSchedule } from './schedules.js';
import { MODEL_ID, parseDescriptor, distance, blobToDescriptor } from './face.js';

const TOKEN_TTL = 180_000;          // 3 menit untuk GPS + kamera + tantangan
const MAX_TOKENS_PER_SESSION = 15;  // batas percobaan per siswa per sesi per hari
const GPS_MAX_AGE = 120_000;        // posisi GPS paling lama 2 menit
const CHALLENGES = ['blink', 'turn_left', 'turn_right'];

class Reject extends HttpError {
  constructor(status, code, message, log = {}) {
    super(status, code, message);
    this.log = log;
  }
}

async function logAttempt(env, request, user, scheduleId, date, err) {
  await env.DB.prepare(
    `INSERT INTO attempt_logs (ts, user_id, schedule_id, session_date, reason, message, distance_m, accuracy_m, face_distance, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(Date.now(), user.id, scheduleId ?? null, date, err.code, err.message, err.log.distance ?? null,
    err.log.accuracy ?? null, err.log.face ?? null, clientIp(request)).run();
}

/** Mencari sesi yang sedang berlaku hari ini untuk siswa. */
async function findOpenSession(env, user, scheduleId) {
  const t = jakarta();
  const { holiday, schedules } = await schedulesOn(env, t.date);
  if (holiday) throw new Reject(409, 'holiday', `Hari ini libur: ${holiday}.`);
  const s = schedules.find((x) => x.id === scheduleId);
  if (!s || !scheduleAppliesToClass(s, user.class_id)) throw new Reject(404, 'no_schedule', 'Jadwal presensi ini tidak berlaku untuk Anda hari ini.');
  const state = sessionState(s, t.minutes);
  if (state === 'upcoming') throw new Reject(409, 'not_open', `Presensi ${s.title} belum dibuka. Dibuka pukul ${s.start_time}.`);
  if (state === 'closed') throw new Reject(409, 'closed', `Presensi ${s.title} sudah ditutup pukul ${s.end_time}.`);
  return { schedule: s, t };
}

// ───────────────────────── Token ─────────────────────────
export async function issueToken(request, env) {
  const { user } = await requireUser(env, request, ['siswa']);
  const b = await readJson(request);
  let ctx;
  try {
    ctx = await findOpenSession(env, user, String(b.schedule_id || ''));
  } catch (e) {
    if (e instanceof Reject) await logAttempt(env, request, user, b.schedule_id, jakarta().date, e);
    throw e;
  }
  const { schedule: s, t } = ctx;
  const [done, count, face] = await env.DB.batch([
    env.DB.prepare('SELECT status FROM attendance WHERE schedule_id = ? AND session_date = ? AND student_id = ?').bind(s.id, t.date, user.id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM attendance_tokens WHERE user_id = ? AND schedule_id = ? AND session_date = ?').bind(user.id, s.id, t.date),
    env.DB.prepare('SELECT model_id FROM face_profiles WHERE student_id = ?').bind(user.id),
  ]);
  if (done.results[0]) throw new HttpError(409, 'already', 'Anda sudah tercatat presensi pada sesi ini.');
  if (count.results[0].n >= MAX_TOKENS_PER_SESSION) {
    throw new HttpError(429, 'too_many_attempts', 'Percobaan presensi sudah terlalu banyak. Hubungi wali kelas untuk presensi manual.');
  }
  if (s.require_face && !face.results[0]) {
    throw new HttpError(409, 'face_not_enrolled', 'Wajah Anda belum didaftarkan. Minta wali kelas atau admin mendaftarkan wajah Anda.');
  }

  const pool = [...CHALLENGES];
  const challenges = s.require_liveness ? [pool.splice(randomInt(pool.length), 1)[0], pool.splice(randomInt(pool.length), 1)[0]] : [];
  const token = randomHex(32);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO attendance_tokens (id, user_id, schedule_id, session_date, challenges, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(await sha256Hex(token), user.id, s.id, t.date, JSON.stringify(challenges), now, now + TOKEN_TTL).run();

  return json({
    token,
    expires_in: TOKEN_TTL / 1000,
    challenges,
    model_id: MODEL_ID,
    schedule: { id: s.id, title: s.title, lat: s.lat, lng: s.lng, radius_m: s.radius_m, max_accuracy_m: s.max_accuracy_m,
      require_face: !!s.require_face, require_liveness: !!s.require_liveness, require_school_ip: !!s.require_school_ip },
  });
}

// ───────────────────────── Submit ─────────────────────────
export async function submit(request, env) {
  const { user } = await requireUser(env, request, ['siswa']);
  const b = await readJson(request, 16 * 1024);
  const date = jakarta().date;
  let scheduleId = null;
  try {
    // 1–2. Token sekali pakai milik siswa ini.
    if (typeof b.token !== 'string' || !/^[0-9a-f]{64}$/.test(b.token)) throw new Reject(400, 'bad_token', 'Sesi verifikasi tidak valid. Ulangi presensi.');
    const tokenId = await sha256Hex(b.token);
    const now = Date.now();
    const used = await env.DB.prepare(
      `UPDATE attendance_tokens SET used_at = ? WHERE id = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?
       RETURNING schedule_id, session_date, challenges`,
    ).bind(now, tokenId, user.id, now).first();
    if (!used) throw new Reject(410, 'token_expired', 'Waktu verifikasi habis atau sudah dipakai. Ulangi presensi.');
    scheduleId = used.schedule_id;
    if (used.session_date !== date) throw new Reject(410, 'token_expired', 'Waktu verifikasi habis. Ulangi presensi.');

    // 3. Jadwal masih terbuka menurut jam server.
    const { schedule: s, t } = await findOpenSession(env, user, used.schedule_id);
    const cfg = await getConfig(env);

    // 4–6. Lokasi.
    const { lat, lng, accuracy, gps_time: gpsTime } = b.location || {};
    if (!validLat(lat) || !validLng(lng) || typeof accuracy !== 'number' || !(accuracy > 0)) {
      throw new Reject(400, 'bad_location', 'Data lokasi tidak valid. Aktifkan GPS lalu coba lagi.');
    }
    if (typeof gpsTime !== 'number' || Math.abs(now - gpsTime) > GPS_MAX_AGE) {
      throw new Reject(400, 'stale_location', 'Data lokasi sudah kedaluwarsa. Perbarui lokasi lalu coba lagi.', { accuracy });
    }
    const dist = haversine(lat, lng, s.lat, s.lng);
    const log = { distance: Math.round(dist), accuracy: Math.round(accuracy) };
    if (accuracy > s.max_accuracy_m) {
      throw new Reject(422, 'low_accuracy', `Akurasi GPS ±${Math.round(accuracy)} m, batasnya ${s.max_accuracy_m} m. Pindah ke area terbuka lalu coba lagi.`, log);
    }
    if (dist > s.radius_m) {
      throw new Reject(422, 'out_of_range', `Anda berada ${Math.round(dist - s.radius_m)} m di luar area presensi.`, log);
    }

    // 7. Jaringan sekolah.
    const onSchool = ipMatches(clientIp(request), cfg.school_ips);
    if (s.require_school_ip && !onSchool) throw new Reject(422, 'not_school_network', 'Sambungkan HP ke Wi-Fi sekolah lalu coba lagi.', log);

    // 8. Wajah: descriptor dari HP dicocokkan dengan template di server.
    let faceDist = null;
    let liveness = null;
    if (s.require_face) {
      const prof = await env.DB.prepare('SELECT embedding, model_id FROM face_profiles WHERE student_id = ?').bind(user.id).first();
      if (!prof) throw new Reject(409, 'face_not_enrolled', 'Wajah Anda belum didaftarkan. Hubungi wali kelas.', log);
      const face = b.face || {};
      if (face.model_id !== prof.model_id) throw new Reject(400, 'model_mismatch', 'Versi aplikasi tidak sesuai. Muat ulang aplikasi lalu coba lagi.', log);
      const descriptors = Array.isArray(face.descriptors) ? face.descriptors.slice(0, 3).map(parseDescriptor) : [];
      if (descriptors.length < 2 || descriptors.some((d) => !d)) throw new Reject(400, 'bad_face', 'Data wajah tidak lengkap. Ulangi presensi.', log);
      const template = blobToDescriptor(prof.embedding);
      faceDist = Math.max(...descriptors.map((d) => distance(d, template)));
      log.face = Number(faceDist.toFixed(3));
      if (faceDist > cfg.face_threshold) throw new Reject(422, 'face_mismatch', 'Wajah tidak cocok dengan data pendaftaran. Pastikan wajah terlihat jelas lalu coba lagi.', log);
      if (s.require_liveness) {
        const expected = JSON.parse(used.challenges);
        const doneList = Array.isArray(face.liveness) ? face.liveness : [];
        liveness = expected.every((c) => doneList.includes(c)) ? 1 : 0;
        if (!liveness) throw new Reject(422, 'liveness_failed', 'Tantangan gerakan wajah belum selesai. Ulangi presensi.', log);
      }
    }

    // 9. Simpan; UNIQUE mencegah presensi ganda.
    const status = s.late_after && t.minutes > toMinutes(s.late_after) ? 'terlambat' : 'hadir';
    const res = await env.DB.prepare(
      `INSERT INTO attendance (schedule_id, session_date, student_id, server_time, status, source, lat, lng, accuracy_m,
                               distance_m, face_distance, liveness, from_school_ip)
       VALUES (?, ?, ?, ?, ?, 'app', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (schedule_id, session_date, student_id) DO NOTHING`,
    ).bind(s.id, date, user.id, now, status, lat, lng, accuracy, Math.round(dist), faceDist, liveness, onSchool ? 1 : 0).run();
    if (!res.meta.changes) throw new HttpError(409, 'already', 'Anda sudah tercatat presensi pada sesi ini.');

    return json({ status, server_time: now, schedule_title: s.title, distance_m: Math.round(dist) });
  } catch (e) {
    if (e instanceof Reject) await logAttempt(env, request, user, scheduleId, date, e);
    throw e;
  }
}

// ───────────────────────── Riwayat siswa ─────────────────────────
export async function myHistory(request, env) {
  const { user } = await requireUser(env, request, ['siswa']);
  const url = new URL(request.url);
  const t = jakarta();
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : t.date.slice(0, 7);
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 7) + '-01', -1);
  const [recs, scheds, hol] = await env.DB.batch([
    env.DB.prepare('SELECT schedule_id, session_date, status, server_time, source, note FROM attendance WHERE student_id = ? AND session_date BETWEEN ? AND ?')
      .bind(user.id, first, last),
    env.DB.prepare('SELECT * FROM schedules WHERE active = 1 AND start_date <= ? AND end_date >= ?').bind(last, first),
    env.DB.prepare('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?').bind(first, last),
  ]);
  const holidays = Object.fromEntries(hol.results.map((h) => [h.date, h.name]));
  const recMap = new Map(recs.results.map((r) => [`${r.session_date}|${r.schedule_id}`, r]));
  const mine = scheds.results.filter((s) => scheduleAppliesToClass(s, user.class_id));
  const items = [];
  for (let d = last; d >= first; d = addDays(d, -1)) {
    if (d > t.date || holidays[d]) continue;
    const wd = String(weekdayOf(d));
    for (const s of mine) {
      if (d < s.start_date || d > s.end_date || (s.days_of_week && !s.days_of_week.split(',').includes(wd))) continue;
      const r = recMap.get(`${d}|${s.id}`);
      let status = r?.status;
      if (!status) status = d < t.date || t.minutes > toMinutes(s.end_time) ? 'alfa' : 'belum';
      items.push({ date: d, title: s.title, kind: s.kind, start_time: s.start_time, status, time: r?.server_time ?? null, manual: r?.source === 'manual', note: r?.note ?? null });
    }
  }
  const summary = items.reduce((m, i) => ({ ...m, [i.status]: (m[i.status] || 0) + 1 }), {});
  return json({ month, items, summary });
}

// ───────────────────────── Staf: ringkasan & rekap ─────────────────────────
/** Siswa dalam cakupan staf dan jadwal. */
async function studentsFor(env, scope, schedule, classId) {
  const sched = schedule ? scheduleClassIds(schedule) : null;
  let ids = scope;
  if (sched) ids = ids ? ids.filter((c) => sched.includes(c)) : sched;
  if (classId) {
    if (ids && !ids.includes(classId)) return [];
    ids = [classId];
  }
  const cond = ["u.role = 'siswa'", 'u.active = 1'];
  if (ids) {
    if (!ids.length) return [];
    cond.push(`u.class_id IN (${placeholders(ids.length)})`);
  } else cond.push('u.class_id IS NOT NULL');
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.nis, u.name, u.class_id, c.name AS class_name FROM users u JOIN classes c ON c.id = u.class_id
      WHERE ${cond.join(' AND ')} ORDER BY c.name, u.name`,
  ).bind(...(ids ?? [])).all();
  return results;
}

export async function overview(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const url = new URL(request.url);
  const t = jakarta();
  const date = url.searchParams.get('date') || t.date;
  if (!isDate(date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  const scope = await scopeClassIds(env, user);
  const { holiday, schedules } = await schedulesOn(env, date);
  const students = await studentsFor(env, scope, null, null);
  const classIds = [...new Set(students.map((s) => s.class_id))];
  const classNames = Object.fromEntries(students.map((s) => [s.class_id, s.class_name]));

  const { results: counts } = await env.DB.prepare(
    `SELECT a.schedule_id, u.class_id, a.status, COUNT(*) AS n FROM attendance a JOIN users u ON u.id = a.student_id
      WHERE a.session_date = ? AND u.active = 1 GROUP BY a.schedule_id, u.class_id, a.status`,
  ).bind(date).all();
  const { results: recent } = await env.DB.prepare(
    `SELECT a.server_time, a.status, a.source, u.name, c.name AS class_name, s.title FROM attendance a
       JOIN users u ON u.id = a.student_id JOIN classes c ON c.id = u.class_id JOIN schedules s ON s.id = a.schedule_id
      WHERE a.session_date = ? ${scope ? `AND u.class_id IN (${placeholders(scope.length || 1)})` : ''}
      ORDER BY a.server_time DESC LIMIT 8`,
  ).bind(date, ...(scope ? (scope.length ? scope : ['-']) : [])).all();
  const attempts = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM attempt_logs l JOIN users u ON u.id = l.user_id
      WHERE l.session_date = ? ${scope ? `AND u.class_id IN (${placeholders(scope.length || 1)})` : ''}`,
  ).bind(date, ...(scope ? (scope.length ? scope : ['-']) : [])).first();

  const perClassTotal = students.reduce((m, s) => ({ ...m, [s.class_id]: (m[s.class_id] || 0) + 1 }), {});
  const sessions = schedules
    .filter((s) => classIds.some((c) => scheduleAppliesToClass(s, c)))
    .map((s) => {
      const applies = classIds.filter((c) => scheduleAppliesToClass(s, c));
      const classes = applies.map((cid) => {
        const row = { class_id: cid, class_name: classNames[cid], total: perClassTotal[cid] || 0, hadir: 0, terlambat: 0, izin: 0, sakit: 0, alfa: 0 };
        for (const c of counts) if (c.schedule_id === s.id && c.class_id === cid) row[c.status] = c.n;
        row.belum = row.total - row.hadir - row.terlambat - row.izin - row.sakit - row.alfa;
        return row;
      }).sort((a, b) => a.class_name.localeCompare(b.class_name, 'id', { numeric: true }));
      const totals = classes.reduce((m, c) => {
        for (const k of ['total', 'hadir', 'terlambat', 'izin', 'sakit', 'alfa', 'belum']) m[k] = (m[k] || 0) + c[k];
        return m;
      }, {});
      const state = date < t.date ? 'closed' : date > t.date ? 'upcoming' : sessionState(s, t.minutes);
      return { ...publicSchedule(s), state, totals, classes };
    });
  return json({ date, holiday, sessions, recent, attempts: attempts.n, server_time: Date.now() });
}

export async function recap(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || jakarta().date;
  const scheduleId = url.searchParams.get('schedule_id') || '';
  const classId = url.searchParams.get('class_id') || '';
  if (!isDate(date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  const schedule = await env.DB.prepare('SELECT * FROM schedules WHERE id = ?').bind(scheduleId).first();
  if (!schedule) throw new HttpError(404, 'not_found', 'Jadwal tidak ditemukan.');
  const scope = await scopeClassIds(env, user);
  if (scope && classId && !scope.includes(classId)) throw new HttpError(403, 'forbidden', 'Anda hanya dapat melihat kelas yang Anda ampu.');
  const students = await studentsFor(env, scope, schedule, classId);
  const { results: recs } = await env.DB.prepare(
    `SELECT a.student_id, a.status, a.server_time, a.source, a.distance_m, a.accuracy_m, a.face_distance, a.from_school_ip, a.note, m.name AS by_name
       FROM attendance a LEFT JOIN users m ON m.id = a.created_by WHERE a.schedule_id = ? AND a.session_date = ?`,
  ).bind(scheduleId, date).all();
  const byStudent = Object.fromEntries(recs.map((r) => [r.student_id, r]));
  const t = jakarta();
  const closed = date < t.date || (date === t.date && t.minutes > toMinutes(schedule.end_time));
  const rows = students.map((s) => ({ ...s, record: byStudent[s.id] || null }));
  return json({ date, schedule: publicSchedule(schedule), closed, rows });
}

export async function manual(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const b = await readJson(request);
  if (!isDate(b.date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  const allowed = ['hadir', 'terlambat', 'izin', 'sakit', 'alfa', 'hapus'];
  if (!allowed.includes(b.status)) throw new HttpError(400, 'invalid_status', 'Status tidak valid.');
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) : '';
  if (b.status !== 'hapus' && note.length < 3) throw new HttpError(400, 'note_required', 'Tuliskan alasan/keterangan (minimal 3 karakter).');
  if (b.date > jakarta().date) throw new HttpError(400, 'future_date', 'Tidak bisa mengisi presensi untuk tanggal yang akan datang.');
  const ids = Array.isArray(b.student_ids) ? [...new Set(b.student_ids.filter((x) => typeof x === 'string'))] : [];
  if (!ids.length || ids.length > 60) throw new HttpError(400, 'invalid_students', 'Pilih 1–60 siswa.');
  const schedule = await env.DB.prepare('SELECT * FROM schedules WHERE id = ?').bind(b.schedule_id || '').first();
  if (!schedule) throw new HttpError(404, 'not_found', 'Jadwal tidak ditemukan.');

  const scope = await scopeClassIds(env, user);
  const { results: studs } = await env.DB.prepare(`SELECT id, class_id FROM users WHERE role = 'siswa' AND id IN (${placeholders(ids.length)})`).bind(...ids).all();
  if (studs.length !== ids.length) throw new HttpError(404, 'not_found', 'Sebagian siswa tidak ditemukan.');
  if (studs.some((s) => (scope && !scope.includes(s.class_id)) || !scheduleAppliesToClass(schedule, s.class_id))) {
    throw new HttpError(403, 'forbidden', 'Sebagian siswa di luar kelas Anda atau tidak termasuk jadwal ini.');
  }
  const now = Date.now();
  const stmts = ids.map((sid) => (b.status === 'hapus'
    ? env.DB.prepare('DELETE FROM attendance WHERE schedule_id = ? AND session_date = ? AND student_id = ?').bind(schedule.id, b.date, sid)
    : env.DB.prepare(
      `INSERT INTO attendance (schedule_id, session_date, student_id, server_time, status, source, note, created_by)
       VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)
       ON CONFLICT (schedule_id, session_date, student_id) DO UPDATE SET status = excluded.status, source = 'manual',
         note = excluded.note, created_by = excluded.created_by, server_time = excluded.server_time`,
    ).bind(schedule.id, b.date, sid, now, b.status, note, user.id)));
  stmts.push(auditStmt(env, user.id, 'attendance_manual', schedule.id, { date: b.date, status: b.status, count: ids.length, note }));
  await env.DB.batch(stmts);
  return json({ updated: ids.length });
}

export async function attempts(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || jakarta().date;
  if (!isDate(date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  const scope = await scopeClassIds(env, user);
  const { results } = await env.DB.prepare(
    `SELECT l.ts, l.reason, l.message, l.distance_m, l.accuracy_m, l.face_distance, l.ip, u.name, u.nis, c.name AS class_name, s.title
       FROM attempt_logs l JOIN users u ON u.id = l.user_id LEFT JOIN classes c ON c.id = u.class_id LEFT JOIN schedules s ON s.id = l.schedule_id
      WHERE l.session_date = ? ${scope ? `AND u.class_id IN (${placeholders(scope.length || 1)})` : ''}
      ORDER BY l.ts DESC LIMIT 300`,
  ).bind(date, ...(scope ? (scope.length ? scope : ['-']) : [])).all();
  return json({ date, attempts: results });
}
