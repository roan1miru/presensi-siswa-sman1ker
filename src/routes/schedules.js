import { HttpError, json, readJson, str } from '../lib/http.js';
import { requireUser, auditStmt } from '../lib/session.js';
import { ADMINS, STAFF, scheduleAppliesToClass, scopeClassIds } from '../lib/scope.js';
import { jakarta, isDate, isTime, toMinutes, weekdayOf } from '../lib/time.js';
import { validLat, validLng, ipMatches, clientIp } from '../lib/geo.js';
import { getConfig } from '../lib/config.js';

const KINDS = ['masuk', 'pulang', 'kegiatan'];

/** Jadwal aktif yang berlaku pada tanggal tertentu (sudah memperhitungkan hari dan libur). */
export async function schedulesOn(env, date) {
  const [holiday, list] = await env.DB.batch([
    env.DB.prepare('SELECT name FROM holidays WHERE date = ?').bind(date),
    env.DB.prepare('SELECT * FROM schedules WHERE active = 1 AND start_date <= ? AND end_date >= ? ORDER BY start_time').bind(date, date),
  ]);
  if (holiday.results[0]) return { holiday: holiday.results[0].name, schedules: [] };
  const wd = String(weekdayOf(date));
  const schedules = list.results.filter((s) => !s.days_of_week || s.days_of_week.split(',').includes(wd));
  return { holiday: null, schedules };
}

export function sessionState(schedule, nowMinutes) {
  if (nowMinutes < toMinutes(schedule.start_time)) return 'upcoming';
  if (nowMinutes > toMinutes(schedule.end_time)) return 'closed';
  return 'open';
}

export function publicSchedule(s) {
  return {
    id: s.id, title: s.title, kind: s.kind, start_date: s.start_date, end_date: s.end_date,
    days: s.days_of_week ? s.days_of_week.split(',').map(Number) : [],
    start_time: s.start_time, late_after: s.late_after, end_time: s.end_time,
    lat: s.lat, lng: s.lng, radius_m: s.radius_m, max_accuracy_m: s.max_accuracy_m,
    class_ids: s.class_ids ? JSON.parse(s.class_ids) : [],
    require_face: !!s.require_face, require_liveness: !!s.require_liveness, require_school_ip: !!s.require_school_ip,
    active: !!s.active,
  };
}

// ───────────────────────── Admin ─────────────────────────
export async function listSchedules(request, env) {
  await requireUser(env, request, STAFF);
  const { results } = await env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM attendance a WHERE a.schedule_id = s.id) AS records
       FROM schedules s ORDER BY s.active DESC, s.end_date DESC, s.start_time`,
  ).all();
  return json({ schedules: results.map((s) => ({ ...publicSchedule(s), records: s.records })) });
}

function validate(b, cfg) {
  const title = str(b.title, 'nama jadwal', { min: 3, max: 60 });
  if (!KINDS.includes(b.kind)) throw new HttpError(400, 'invalid_kind', 'Jenis jadwal tidak valid.');
  if (!isDate(b.start_date) || !isDate(b.end_date)) throw new HttpError(400, 'invalid_date', 'Tanggal mulai dan selesai wajib diisi.');
  if (b.end_date < b.start_date) throw new HttpError(400, 'invalid_date', 'Tanggal selesai tidak boleh sebelum tanggal mulai.');
  const days = Array.isArray(b.days) ? [...new Set(b.days.map(Number))].filter((d) => d >= 1 && d <= 7).sort() : [];
  if (!isTime(b.start_time) || !isTime(b.end_time)) throw new HttpError(400, 'invalid_time', 'Jam buka dan tutup wajib diisi (format JJ:MM).');
  if (toMinutes(b.end_time) <= toMinutes(b.start_time)) throw new HttpError(400, 'invalid_time', 'Jam tutup harus setelah jam buka.');
  const late = b.late_after ? b.late_after : null;
  if (late && (!isTime(late) || toMinutes(late) < toMinutes(b.start_time) || toMinutes(late) > toMinutes(b.end_time))) {
    throw new HttpError(400, 'invalid_time', 'Batas terlambat harus di antara jam buka dan jam tutup.');
  }
  const lat = b.lat ?? cfg.default_lat;
  const lng = b.lng ?? cfg.default_lng;
  if (!validLat(lat) || !validLng(lng)) throw new HttpError(400, 'invalid_location', 'Titik lokasi belum diatur. Pilih di peta atau isi di Pengaturan.');
  const radius = Number(b.radius_m ?? cfg.default_radius_m);
  const acc = Number(b.max_accuracy_m ?? cfg.default_max_accuracy_m);
  if (!(radius >= 20 && radius <= 2000)) throw new HttpError(400, 'invalid_radius', 'Radius harus 20–2000 meter.');
  if (!(acc >= 10 && acc <= 200)) throw new HttpError(400, 'invalid_accuracy', 'Batas akurasi harus 10–200 meter.');
  const classIds = Array.isArray(b.class_ids) ? b.class_ids.filter((x) => typeof x === 'string').slice(0, 200) : [];
  return {
    title, kind: b.kind, start_date: b.start_date, end_date: b.end_date,
    days_of_week: days.length && days.length < 7 ? days.join(',') : null,
    start_time: b.start_time, late_after: late, end_time: b.end_time,
    lat, lng, radius_m: Math.round(radius), max_accuracy_m: Math.round(acc),
    class_ids: classIds.length ? JSON.stringify(classIds) : null,
    require_face: b.require_face === false ? 0 : 1,
    require_liveness: b.require_liveness === false ? 0 : 1,
    require_school_ip: b.require_school_ip ? 1 : 0,
    active: b.active === false ? 0 : 1,
  };
}

export async function saveSchedule(request, env) {
  const { user } = await requireUser(env, request, ADMINS);
  const b = await readJson(request);
  const s = validate(b, await getConfig(env));
  const now = Date.now();
  const cols = Object.keys(s);
  if (b.id) {
    const res = await env.DB.prepare(`UPDATE schedules SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...cols.map((c) => s[c]), now, b.id).run();
    if (!res.meta.changes) throw new HttpError(404, 'not_found', 'Jadwal tidak ditemukan.');
    await env.DB.batch([auditStmt(env, user.id, 'schedule_update', b.id, { title: s.title })]);
    return json({ id: b.id });
  }
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO schedules (id, ${cols.join(', ')}, created_by, created_at, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`)
      .bind(id, ...cols.map((c) => s[c]), user.id, now, now),
    auditStmt(env, user.id, 'schedule_create', id, { title: s.title }),
  ]);
  return json({ id }, 201);
}

export async function deleteSchedule(request, env, { id }) {
  const { user } = await requireUser(env, request, ADMINS);
  await readJson(request);
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM attendance WHERE schedule_id = ?').bind(id).first();
  if (used.n > 0) {
    await env.DB.batch([
      env.DB.prepare('UPDATE schedules SET active = 0, updated_at = ? WHERE id = ?').bind(Date.now(), id),
      auditStmt(env, user.id, 'schedule_deactivate', id),
    ]);
    return json({ deactivated: true, message: 'Jadwal sudah punya data presensi, jadi dinonaktifkan (tidak dihapus) agar rekap tetap utuh.' });
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attendance_tokens WHERE schedule_id = ?').bind(id),
    env.DB.prepare('DELETE FROM schedules WHERE id = ?').bind(id),
    auditStmt(env, user.id, 'schedule_delete', id),
  ]);
  return json({ deleted: true });
}

// ───────────────────────── Siswa: jadwal hari ini ─────────────────────────
export async function myToday(request, env) {
  const { user } = await requireUser(env, request, ['siswa']);
  const now = Date.now();
  const t = jakarta(now);
  const [{ holiday, schedules }, cfg, face] = await Promise.all([
    schedulesOn(env, t.date),
    getConfig(env),
    env.DB.prepare('SELECT 1 FROM face_profiles WHERE student_id = ?').bind(user.id).first(),
  ]);
  const mine = schedules.filter((s) => scheduleAppliesToClass(s, user.class_id));
  const { results: records } = await env.DB.prepare(
    'SELECT schedule_id, status, server_time, source FROM attendance WHERE student_id = ? AND session_date = ?',
  ).bind(user.id, t.date).all();
  const byId = Object.fromEntries(records.map((r) => [r.schedule_id, r]));
  return json({
    date: t.date,
    holiday,
    server_time: now,
    face_enrolled: !!face,
    on_school_network: ipMatches(clientIp(request), cfg.school_ips),
    sessions: mine.map((s) => ({
      ...publicSchedule(s),
      class_ids: undefined,
      state: sessionState(s, t.minutes),
      record: byId[s.id] || null,
    })),
  });
}

/** Jadwal hari ini untuk staf (dipakai dasbor & rekap). */
export async function scheduleDay(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || jakarta().date;
  if (!isDate(date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  const { holiday, schedules } = await schedulesOn(env, date);
  const scope = await scopeClassIds(env, user);
  const visible = scope ? schedules.filter((s) => scope.some((c) => scheduleAppliesToClass(s, c))) : schedules;
  const t = jakarta();
  return json({
    date, holiday,
    schedules: visible.map((s) => ({ ...publicSchedule(s), state: date < t.date ? 'closed' : date > t.date ? 'upcoming' : sessionState(s, t.minutes) })),
  });
}
