// Ekspor: (1) staf mengunduh rekap rentang tanggal, (2) Google Apps Script menarik rekap harian & backup.
import { HttpError, json } from '../lib/http.js';
import { requireUser } from '../lib/session.js';
import { timingSafeEqualHex, sha256Hex } from '../lib/crypto.js';
import { STAFF, scopeClassIds, scheduleClassIds, placeholders } from '../lib/scope.js';
import { jakarta, isDate, addDays, weekdayOf, toMinutes } from '../lib/time.js';

/**
 * Baris rekap [tanggal, sesi, kelas, nis, nama, status, jam, jarak, sumber, keterangan] untuk rentang tanggal.
 * Siswa tanpa catatan pada sesi yang sudah ditutup = alfa; sesi yang belum ditutup = belum.
 */
async function buildRows(env, from, to, classIds) {
  const t = jakarta();
  const cond = ["u.role = 'siswa'", 'u.active = 1', 'u.class_id IS NOT NULL'];
  if (classIds) cond.push(`u.class_id IN (${placeholders(classIds.length || 1)})`);
  const classArgs = classIds ? (classIds.length ? classIds : ['-']) : [];
  const [studs, scheds, hols, recs] = await env.DB.batch([
    env.DB.prepare(`SELECT u.id, u.nis, u.name, u.class_id, c.name AS class_name FROM users u JOIN classes c ON c.id = u.class_id
                     WHERE ${cond.join(' AND ')} ORDER BY c.name, u.name`).bind(...classArgs),
    env.DB.prepare('SELECT * FROM schedules WHERE start_date <= ? AND end_date >= ? ORDER BY start_time').bind(to, from),
    env.DB.prepare('SELECT date FROM holidays WHERE date BETWEEN ? AND ?').bind(from, to),
    env.DB.prepare(`SELECT a.schedule_id, a.session_date, a.student_id, a.status, a.server_time, a.distance_m, a.source, a.note
                      FROM attendance a JOIN users u ON u.id = a.student_id
                     WHERE a.session_date BETWEEN ? AND ? AND ${cond.join(' AND ')}`).bind(from, to, ...classArgs),
  ]);
  const holidays = new Set(hols.results.map((h) => h.date));
  const rec = new Map(recs.results.map((r) => [`${r.session_date}|${r.schedule_id}|${r.student_id}`, r]));
  const appliesTo = new Map(scheds.results.map((s) => [s.id, scheduleClassIds(s)])); // parse sekali, bukan per siswa
  const fmt = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(11, 16);
  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (holidays.has(d) || d > t.date) continue;
    const wd = String(weekdayOf(d));
    for (const s of scheds.results) {
      // Jadwal nonaktif tetap diekspor bila punya catatan pada tanggal itu.
      if (d < s.start_date || d > s.end_date || (s.days_of_week && !s.days_of_week.split(',').includes(wd))) continue;
      const closed = d < t.date || t.minutes > toMinutes(s.end_time);
      for (const st of studs.results) {
        const only = appliesTo.get(s.id);
        if (only && !only.includes(st.class_id)) continue;
        const r = rec.get(`${d}|${s.id}|${st.id}`);
        if (!r && !s.active) continue;
        rows.push([d, s.title, st.class_name, st.nis, st.name, r ? r.status : closed ? 'alfa' : 'belum',
          r ? fmt(r.server_time) : '', r?.distance_m ?? '', r ? r.source : '', r?.note ?? '']);
      }
    }
  }
  return rows;
}

export const HEADER = ['tanggal', 'sesi', 'kelas', 'nis', 'nama', 'status', 'jam', 'jarak_m', 'sumber', 'keterangan'];

export async function staffExport(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const classId = url.searchParams.get('class_id') || '';
  if (!isDate(from) || !isDate(to) || to < from) throw new HttpError(400, 'invalid_date', 'Rentang tanggal tidak valid.');
  const days = (Date.parse(to) - Date.parse(from)) / 864e5 + 1;
  // Batas CPU paket gratis: seluruh sekolah maks. 7 hari, satu kelas maks. 62 hari.
  if (!classId && days > 7) throw new HttpError(400, 'range_too_long', 'Untuk semua kelas, rentang maksimal 7 hari. Pilih satu kelas untuk rentang hingga 2 bulan.');
  if (days > 62) throw new HttpError(400, 'range_too_long', 'Rentang maksimal 62 hari.');
  const scope = await scopeClassIds(env, user);
  if (scope && classId && !scope.includes(classId)) throw new HttpError(403, 'forbidden', 'Anda hanya dapat mengekspor kelas yang Anda ampu.');
  const classIds = classId ? [classId] : scope;
  return json({ header: HEADER, rows: await buildRows(env, from, to, classIds) });
}

/** Kunci ekspor: dibuat dari halaman Pengaturan (hash disimpan di D1) atau secret EXPORT_KEY lama. */
async function checkExportKey(request, env) {
  const given = await sha256Hex(request.headers.get('X-Export-Key') || '');
  const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'export_key_hash'").first();
  const stored = row?.value || (env.EXPORT_KEY && env.EXPORT_KEY.length >= 24 ? await sha256Hex(env.EXPORT_KEY) : null);
  if (!stored) throw new HttpError(503, 'export_disabled', 'Ekspor otomatis belum diaktifkan. Aktifkan di menu Pengaturan aplikasi.');
  if (!timingSafeEqualHex(given, stored)) throw new HttpError(401, 'bad_key', 'Kunci ekspor salah.');
}

// Urutan aman untuk dipulihkan (tabel induk lebih dulu).
export const BACKUP_TABLES = ['app_config', 'holidays', 'classes', 'users', 'schedules', 'face_profiles', 'attendance', 'attempt_logs', 'audit_logs'];
export const KEY_COLUMN = { app_config: 'key', holidays: 'date', face_profiles: 'student_id' };
const PAGE = 1000;

/**
 * Satu halaman backup. Paginasi kunci (WHERE kunci > after), bukan OFFSET, supaya baris yang dibaca
 * tidak berlipat ganda pada tabel besar (batas 5 juta baris dibaca/hari pada paket gratis).
 */
export async function backupPage(env, url) {
  const table = url.searchParams.get('table');
  if (!table) {
    const st = await env.DB.prepare('SELECT key_check FROM setup_state WHERE id = 1').first();
    return { format: 'presensi-backup-v1', tables: BACKUP_TABLES, page_size: PAGE, key_check: st?.key_check ?? null };
  }
  if (!BACKUP_TABLES.includes(table)) throw new HttpError(400, 'bad_table', 'Tabel tidak dikenal.');
  const col = KEY_COLUMN[table] || 'id';
  const after = url.searchParams.get('after');
  const numeric = ['attendance', 'attempt_logs', 'audit_logs'].includes(table);
  const { results } = after == null || after === ''
    ? await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${col} LIMIT ?`).bind(PAGE).all()
    : await env.DB.prepare(`SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} LIMIT ?`).bind(numeric ? Number(after) : after, PAGE).all();
  const rows = table === 'face_profiles'
    ? results.map((r) => {
      const bytes = Uint8Array.from(r.embedding);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return { ...r, embedding: btoa(bin) };
    })
    : results;
  return { table, rows, next: rows.length ? rows.at(-1)[col] : null, done: results.length < PAGE };
}

/** Dipanggil Google Apps Script (header X-Export-Key). */
export async function backup(request, env) {
  await checkExportKey(request, env);
  return json(await backupPage(env, new URL(request.url)));
}

/** Dipanggil Google Apps Script sekali sehari. */
export async function dailyExport(request, env) {
  await checkExportKey(request, env);
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || jakarta().date;
  if (!isDate(date)) throw new HttpError(400, 'invalid_date', 'Tanggal tidak valid.');
  return json({ date, header: HEADER, rows: await buildRows(env, date, date, null) });
}
