// Data demo untuk mencoba aplikasi secara LOKAL (jangan di produksi). Menjalankan instalasi bila perlu.
//   npm run demo:local   → admin / KepalaTU-Kerjo-2026
// Mengisi data demo lewat API: pengaturan, 72 siswa, wali, jadwal, wajah sintetis, presensi pagi.
const BASE = 'http://localhost:8787';
const jar = () => { let c = ''; return async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { ...(b ? { 'Content-Type': 'application/json' } : {}), ...(c ? { Cookie: c } : {}) }, body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get('set-cookie'); if (s) c = s.split(';')[0]; return r.json(); }; };
const admin = jar();
import { readFileSync } from 'node:fs';
const PASS = 'KepalaTU-Kerjo-2026';
const code = readFileSync('.dev.vars', 'utf8').match(/^SETUP_CODE="?([^"\n]+)/m)?.[1];
const pub = await (await fetch(BASE + '/api/public/config')).json();
if (pub.setup_needed) await admin('POST', '/api/setup', { code, name: 'Admin Sekolah', username: 'admin', password: PASS });
await admin('POST', '/api/auth/login', { username: 'admin', password: PASS });
const S = { lat: -7.5562, lng: 110.8647 };
await admin('POST', '/api/admin/settings', { school_name: 'SMA Negeri 1 Kerjo', default_lat: S.lat, default_lng: S.lng, default_radius_m: 100, default_max_accuracy_m: 50, force_password_change: false });
const first = ['Ahmad', 'Siti', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hendra', 'Intan', 'Joko', 'Kartika', 'Lukman', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rizki'];
const last = ['Pratama', 'Nurhaliza', 'Santoso', 'Lestari', 'Anggraini', 'Saputra', 'Nugroho', 'Permata', 'Wijaya', 'Maharani', 'Susilo', 'Sari', 'Hakim', 'Rahmawati'];
const cls = ['X TKJ 1', 'X TKJ 2', 'XI TKJ 1', 'XI RPL 1'];
const rows = []; let k = 0;
for (const c of cls) for (let i = 0; i < 18; i++, k++) rows.push({ nis: String(2425001 + k), name: `${first[k % 18]} ${last[(k * 5) % 14]}`, class_name: c });
for (let i = 0; i < rows.length; i += 20) await admin('POST', '/api/admin/students/import', { rows: rows.slice(i, i + 20) });
const { classes } = await admin('GET', '/api/admin/classes');
const cid = Object.fromEntries(classes.map((c) => [c.name, c.id]));
const walis = [['sri.wahyuni', 'Dra. Sri Wahyuni', 'X TKJ 1'], ['bambang.s', 'Bambang Setiawan, S.Kom.', 'X TKJ 2'], ['rina.a', 'Rina Agustina, S.Pd.', 'XI TKJ 1']];
const waliPw = {};
for (const [u, n, c] of walis) { const w = await admin('POST', '/api/admin/staff', { username: u, name: n, role: 'wali', class_id: cid[c] }); waliPw[u] = w.password; }
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const end = new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
const m = await admin('POST', '/api/admin/schedules', { title: 'Masuk pagi', kind: 'masuk', start_date: today, end_date: end, days: [1, 2, 3, 4, 5, 6, 7], start_time: '00:00', late_after: '05:30', end_time: '23:58', require_face: true, require_liveness: true });
const g = await admin('POST', '/api/admin/schedules', { title: 'Apel kegiatan', kind: 'kegiatan', start_date: today, end_date: today, start_time: '00:00', end_time: '23:59', require_face: false, require_liveness: false, radius_m: 120 });
await admin('POST', '/api/admin/schedules', { title: 'Pulang', kind: 'pulang', start_date: today, end_date: end, days: [1, 2, 3, 4, 5], start_time: '23:59', end_time: '23:59', require_face: true, require_liveness: true });
await admin('POST', '/api/admin/holidays', { date: '2026-12-25', name: 'Hari Raya Natal' });
// Wajah sintetis untuk 40 siswa + presensi wajah via API untuk 38 siswa
let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gv = (sc) => Array.from({ length: 128 }, () => sc * Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()));
const { students } = await admin('GET', '/api/admin/students');
const byNis = Object.fromEntries(students.map((s) => [s.nis, s]));
let n = 0;
for (const row of rows.slice(0, 54)) {
  if (n >= 46) break;
  const base = gv(0.09); const s = byNis[row.nis];
  await admin('POST', '/api/admin/face/enroll', { student_id: s.id, model_id: 'faceapi-resnet128-v1', samples: [0, 1, 2].map(() => base.map((x) => x + 0.004 * (rnd() - 0.5))) });
  n++;
  if (n > 40 || row.nis === '2425001') continue; // sisakan siswa pertama untuk demo di HP
  const c = jar();
  await c('POST', '/api/auth/login', { username: 's' + row.nis, password: row.nis });
  const t = await c('POST', '/api/attendance/token', { schedule_id: m.id });
  if (!t.token) { console.log('token', t.message); continue; }
  await c('POST', '/api/attendance/submit', { token: t.token, location: { lat: S.lat + (rnd() - 0.5) * 0.0012, lng: S.lng + (rnd() - 0.5) * 0.0012, accuracy: 8 + rnd() * 20, gps_time: Date.now() }, face: { model_id: 'faceapi-resnet128-v1', descriptors: [base, base], liveness: t.challenges } });
}
// beberapa penolakan + manual
const bad = jar(); await bad('POST', '/api/auth/login', { username: 's2425060', password: '2425060' });
const tb = await bad('POST', '/api/attendance/token', { schedule_id: g.id });
await bad('POST', '/api/attendance/submit', { token: tb.token, location: { lat: S.lat + 0.006, lng: S.lng, accuracy: 15, gps_time: Date.now() } });
const ids = ['2425043', '2425044', '2425050'].map((x) => byNis[x].id);
await admin('POST', '/api/admin/attendance/manual', { schedule_id: m.id, date: today, student_ids: ids.slice(0, 2), status: 'izin', note: 'Lomba OSN tingkat kabupaten' });
await admin('POST', '/api/admin/attendance/manual', { schedule_id: m.id, date: today, student_ids: [ids[2]], status: 'sakit', note: 'Surat dokter' });
console.log(JSON.stringify({ wali: waliPw, masuk: m.id, kegiatan: g.id }));
