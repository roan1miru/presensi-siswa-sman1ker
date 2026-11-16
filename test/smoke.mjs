#!/usr/bin/env node
// Uji end-to-end seluruh API terhadap server yang berjalan (wrangler dev / staging). JANGAN dijalankan di produksi.
//   BASE=http://localhost:8787 node test/smoke.mjs   (SETUP_CODE dibaca dari .dev.vars)
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8787';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'KepalaTU-Kerjo-2026';
let SETUP_CODE = process.env.SETUP_CODE;
if (!SETUP_CODE && existsSync('.dev.vars')) SETUP_CODE = readFileSync('.dev.vars', 'utf8').match(/^SETUP_CODE="?([^"\n]+)/m)?.[1];
let EXPORT_KEY = null;

let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exit(1); }
}
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { ...data, status: res.status, body_status: data.status };
  };
}

// Descriptor wajah sintetis: dua "orang" berbeda + derau kecil antar-sampel.
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }
function gaussVec(r, scale) { return Array.from({ length: 128 }, () => scale * Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r())); }
const add = (a, b) => a.map((x, i) => x + b[i]);
const rA = rng(7), rB = rng(99);
const faceA = gaussVec(rA, 0.09);
const faceB = gaussVec(rB, 0.09);
const sampleOf = (base, r) => add(base, gaussVec(r, 0.006));

const SCHOOL = { lat: -7.5562, lng: 110.8647 };
const near = { lat: SCHOOL.lat + 0.0002, lng: SCHOOL.lng, accuracy: 12 };   // ±22 m dari pusat
const far = { lat: SCHOOL.lat + 0.01, lng: SCHOOL.lng, accuracy: 12 };      // ±1,1 km
const loc = (p, extra = {}) => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, gps_time: Date.now(), ...extra });

const tag = Date.now().toString(36).slice(-4).toUpperCase();
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
console.log(`Uji API ke ${BASE} (tag ${tag}, tanggal ${today})`);

const admin = client();
await step('Instalasi: kode salah ditolak, dua permintaan serentak hanya satu yang menang', async () => {
  const pub = await client()('GET', '/api/public/config');
  if (pub.setup_needed) {
    assert.ok(SETUP_CODE, 'SETUP_CODE perlu ada di .dev.vars');
    const bad = await client()('POST', '/api/setup', { code: 'salah-kode-123', name: 'X', username: 'penyusup', password: 'Penyusup-2026!' });
    assert.equal(bad.code, 'bad_setup_code');
    const other = client();
    const [a, b, c] = await Promise.all([
      admin('POST', '/api/setup', { code: SETUP_CODE, name: 'Admin Sekolah', username: ADMIN_USER, password: ADMIN_PASS }),
      other('POST', '/api/setup', { code: SETUP_CODE, name: 'Admin Sekolah', username: ADMIN_USER, password: ADMIN_PASS }),
      client()('POST', '/api/setup', { code: SETUP_CODE, name: 'Penyusup', username: 'penyusup', password: 'Rahasia-Kuat-99' }),
    ]);
    const all = [a, b, c];
    assert.equal(all.filter((x) => x.status === 200).length, 1, JSON.stringify(all.map((x) => x.message)));
  }
  assert.equal((await client()('GET', '/api/public/config')).setup_needed, false);
  assert.equal((await client()('POST', '/api/setup', { code: SETUP_CODE, name: 'X', username: 'lagi', password: 'LagiLagi-2026!' })).code, 'already_installed');
});

await step('Admin login', async () => {
  let r = await admin('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  if (r.status !== 200) throw new Error('Penyusup menang balapan instalasi (mungkin terjadi, ulangi pada DB bersih): ' + r.message);
  r = await admin('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
  assert.equal(r.status, 200, r.message);
  assert.equal((await admin('GET', '/api/me')).user.role, 'superadmin');
});

await step('Kunci ekspor dibuat dari aplikasi (opsional, tidak wajib untuk aplikasi utama)', async () => {
  const anon = client();
  assert.equal((await anon('GET', '/api/export/daily')).code, 'export_disabled');
  const r = await admin('POST', '/api/admin/export-key', { enable: true });
  assert.ok(r.key && r.key.length >= 40);
  EXPORT_KEY = r.key;
});

await step('CSRF: origin asing & non-JSON ditolak', async () => {
  assert.equal((await admin('POST', '/api/admin/classes', { name: 'X' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await admin('POST', '/api/admin/classes', 'name=X', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
});

await step('Pengaturan: lokasi sekolah, radius, ambang wajah', async () => {
  const r = await admin('POST', '/api/admin/settings', { default_lat: SCHOOL.lat, default_lng: SCHOOL.lng, default_radius_m: 100, default_max_accuracy_m: 50, face_threshold: 0.5, force_password_change: true, school_ips: [] });
  assert.equal(r.status, 200, r.message);
  assert.equal((await admin('POST', '/api/admin/settings', { face_threshold: 0.9 })).status, 400);
});

const classA = `UJI-${tag}-A`, classB = `UJI-${tag}-B`;
const nisBase = 70000 + Math.floor(Math.random() * 20000);
const students = Array.from({ length: 45 }, (_, i) => ({ nis: String(nisBase * 100 + i), name: `Siswa Uji ${i + 1}`, class_name: i < 30 ? classA : classB }));
await step('Impor 45 siswa (3 chunk) → username s<NIS>', async () => {
  for (let i = 0; i < students.length; i += 20) {
    const r = await admin('POST', '/api/admin/students/import', { rows: students.slice(i, i + 20) });
    assert.equal(r.status, 200, r.message);
    assert.ok(r.results.every((x) => x.status === 'created' && x.username === 's' + x.nis));
  }
  assert.equal((await admin('POST', '/api/admin/students/import', { rows: students.slice(0, 21) })).status, 400);
});

await step('Impor ulang serentak tidak menggandakan', async () => {
  const all = await Promise.all([1, 2, 3].map(() => admin('POST', '/api/admin/students/import', { rows: students.slice(0, 20) })));
  assert.ok(all.every((r) => r.status === 200 && r.results.every((x) => x.status === 'updated')));
});

let classAId, classBId, ids = {};
await step('Daftar kelas & siswa', async () => {
  const c = await admin('GET', '/api/admin/classes');
  classAId = c.classes.find((x) => x.name === classA).id;
  classBId = c.classes.find((x) => x.name === classB).id;
  const s = await admin('GET', `/api/admin/students?class_id=${classAId}`);
  assert.equal(s.students.length, 30);
  for (const st of (await admin('GET', '/api/admin/students')).students) ids[st.nis] = st.id;
});

let wali;
await step('Buat wali kelas A; username s+angka ditolak', async () => {
  assert.equal((await admin('POST', '/api/admin/staff', { username: 's123', name: 'X', role: 'wali' })).status, 400);
  const r = await admin('POST', '/api/admin/staff', { username: `wali.${tag.toLowerCase()}`, name: 'Bu Wali Uji', role: 'wali', class_id: classAId });
  assert.equal(r.status, 201, r.message);
  wali = r;
});

const s0 = students[0], s1 = students[1], s40 = students[40];
const sis0 = client();
await step('Siswa login s<NIS> + password NIS, wajib ganti, password lemah ditolak', async () => {
  assert.equal((await sis0('POST', '/api/auth/login', { username: s0.nis, password: s0.nis })).status, 401, 'NIS tanpa s ditolak');
  const r = await sis0('POST', '/api/auth/login', { username: 'S' + s0.nis, password: s0.nis });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.must_change_password, true);
  assert.equal((await sis0('GET', '/api/me/today')).code, 'must_change_password');
  assert.equal((await sis0('POST', '/api/auth/change-password', { current_password: s0.nis, new_password: s0.nis })).status, 400);
  assert.equal((await sis0('POST', '/api/auth/change-password', { current_password: s0.nis, new_password: '123456' })).status, 400);
  assert.equal((await sis0('POST', '/api/auth/change-password', { current_password: s0.nis, new_password: 'kopi-pagi-81' })).status, 200);
  const me = await sis0('GET', '/api/me');
  assert.equal(me.user.class_name, classA);
  assert.equal(me.user.is_default_password, false);
});

await step('Opsi "tidak wajib ganti": siswa langsung masuk dengan NIS', async () => {
  await admin('POST', '/api/admin/settings', { force_password_change: false });
  const extra = { nis: String(nisBase * 100 + 99), name: 'Siswa Bebas', class_name: classB };
  await admin('POST', '/api/admin/students/import', { rows: [extra] });
  const c = client();
  const r = await c('POST', '/api/auth/login', { username: 's' + extra.nis, password: extra.nis });
  assert.equal(r.must_change_password, false);
  assert.equal((await c('GET', '/api/me')).user.is_default_password, true);
  await admin('POST', '/api/admin/settings', { force_password_change: true });
});

const waliC = client();
await step('Wali: hanya kelasnya; reset password siswa kembali ke NIS', async () => {
  let r = await waliC('POST', '/api/auth/login', { username: wali.username, password: wali.password });
  assert.equal(r.must_change_password, true);
  await waliC('POST', '/api/auth/change-password', { current_password: wali.password, new_password: 'WaliBaru-2026!' });
  assert.equal((await waliC('GET', '/api/admin/students')).students.length, 30);
  assert.equal((await waliC('GET', `/api/admin/students?class_id=${classBId}`)).status, 403);
  assert.equal((await waliC('POST', `/api/admin/users/${ids[s40.nis]}/reset-password`, {})).status, 403);
  r = await waliC('POST', `/api/admin/users/${ids[s1.nis]}/reset-password`, {});
  assert.equal(r.reset_to, 'nis');
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { username: 's' + s1.nis, password: s1.nis })).status, 200);
});

await step('Pendaftaran wajah: sampel tidak konsisten ditolak, wali kelas lain ditolak', async () => {
  const bad = [sampleOf(faceA, rA), sampleOf(faceA, rA), sampleOf(faceB, rB)];
  assert.equal((await admin('POST', '/api/admin/face/enroll', { student_id: ids[s0.nis], model_id: 'faceapi-resnet128-v1', samples: bad })).code, 'inconsistent_samples');
  assert.equal((await waliC('POST', '/api/admin/face/enroll', { student_id: ids[s40.nis], model_id: 'faceapi-resnet128-v1', samples: [faceB, faceB, faceB] })).status, 403);
  const ok = await waliC('POST', '/api/admin/face/enroll', { student_id: ids[s0.nis], model_id: 'faceapi-resnet128-v1', samples: [0, 1, 2, 3].map(() => sampleOf(faceA, rA)) });
  assert.equal(ok.status, 200, ok.message);
  const clash = await admin('POST', '/api/admin/face/enroll', { student_id: ids[s1.nis], model_id: 'faceapi-resnet128-v1', samples: [0, 1, 2].map(() => sampleOf(faceA, rA)) });
  assert.equal(clash.code, 'face_clash', 'wajah sama untuk siswa lain sekelas ditolak');
});

let schedFace, schedPlain;
await step('Jadwal: validasi + jadwal rutin hari ini (wajah) dan tanpa wajah', async () => {
  assert.equal((await admin('POST', '/api/admin/schedules', { title: 'Salah', kind: 'masuk', start_date: today, end_date: today, start_time: '08:00', end_time: '07:00' })).status, 400);
  let r = await admin('POST', '/api/admin/schedules', {
    title: `Masuk ${tag}`, kind: 'masuk', start_date: today, end_date: today, days: [1, 2, 3, 4, 5, 6, 7],
    start_time: '00:00', late_after: '00:01', end_time: '23:59', class_ids: [classAId], require_face: true, require_liveness: true,
  });
  assert.equal(r.status, 201, r.message);
  schedFace = r.id;
  r = await admin('POST', '/api/admin/schedules', { title: `Kegiatan ${tag}`, kind: 'kegiatan', start_date: today, end_date: today, start_time: '00:00', end_time: '23:59', require_face: false, require_liveness: false, radius_m: 150 });
  assert.equal(r.status, 201, r.message);
  schedPlain = r.id;
});

await step('Siswa melihat jadwal hari ini sesuai kelasnya', async () => {
  const t = await sis0('GET', '/api/me/today');
  assert.ok(t.sessions.some((s) => s.id === schedFace && s.state === 'open'));
  assert.equal(t.face_enrolled, true);
  const c40 = client();
  await c40('POST', '/api/auth/login', { username: 's' + s40.nis, password: s40.nis });
  await c40('POST', '/api/auth/change-password', { current_password: s40.nis, new_password: 'teh-manis-40' });
  const t40 = await c40('GET', '/api/me/today');
  assert.ok(!t40.sessions.some((s) => s.id === schedFace), 'kelas B tidak ikut jadwal kelas A');
  assert.equal((await c40('POST', '/api/attendance/token', { schedule_id: schedFace })).code, 'no_schedule');
});

const token = async (c, id) => { const r = await c('POST', '/api/attendance/token', { schedule_id: id }); assert.equal(r.status, 200, r.message); return r; };
const faceBody = (tk, base, r, extra = {}) => ({ model_id: 'faceapi-resnet128-v1', descriptors: [sampleOf(base, r), sampleOf(base, r)], liveness: tk.challenges, ...extra });

await step('Penolakan: di luar radius, akurasi buruk, GPS basi, token dipakai ulang', async () => {
  let tk = await token(sis0, schedFace);
  assert.equal(tk.challenges.length, 2);
  let r = await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(far), face: faceBody(tk, faceA, rA) });
  assert.equal(r.code, 'out_of_range');
  r = await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near), face: faceBody(tk, faceA, rA) });
  assert.equal(r.code, 'token_expired', 'token sekali pakai');
  tk = await token(sis0, schedFace);
  assert.equal((await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc({ ...near, accuracy: 80 }), face: faceBody(tk, faceA, rA) })).code, 'low_accuracy');
  tk = await token(sis0, schedFace);
  assert.equal((await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near, { gps_time: Date.now() - 600000 }), face: faceBody(tk, faceA, rA) })).code, 'stale_location');
});

await step('Penolakan: wajah orang lain, liveness tidak lengkap, model berbeda', async () => {
  let tk = await token(sis0, schedFace);
  assert.equal((await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near), face: faceBody(tk, faceB, rB) })).code, 'face_mismatch');
  tk = await token(sis0, schedFace);
  assert.equal((await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near), face: faceBody(tk, faceA, rA, { liveness: [tk.challenges[0]] }) })).code, 'liveness_failed');
  tk = await token(sis0, schedFace);
  assert.equal((await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near), face: faceBody(tk, faceA, rA, { model_id: 'lain' }) })).code, 'model_mismatch');
});

await step('Presensi sah tercatat "terlambat"; submit serentak hanya satu yang masuk', async () => {
  const [t1, t2] = [await token(sis0, schedFace), await token(sis0, schedFace)];
  const [a, b] = await Promise.all([t1, t2].map((tk) => sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near), face: faceBody(tk, faceA, rA) })));
  const ok = [a, b].filter((x) => x.status === 200);
  assert.equal(ok.length, 1, JSON.stringify([a, b]));
  assert.equal(ok[0].body_status, 'terlambat');
  assert.equal([a, b].find((x) => x.status !== 200).code, 'already');
  assert.equal((await sis0('POST', '/api/attendance/token', { schedule_id: schedFace })).code, 'already');
});

await step('Siswa tanpa data wajah tidak bisa memulai presensi berwajah', async () => {
  const c = client();
  await c('POST', '/api/auth/login', { username: 's' + students[2].nis, password: students[2].nis });
  await c('POST', '/api/auth/change-password', { current_password: students[2].nis, new_password: 'nasi-goreng-2' });
  assert.equal((await c('POST', '/api/attendance/token', { schedule_id: schedFace })).code, 'face_not_enrolled');
  const tk = await token(c, schedPlain);
  assert.deepEqual(tk.challenges, []);
  const r = await c('POST', '/api/attendance/submit', { token: tk.token, location: loc(near) });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.status === 200 && r.distance_m < 40, true);
});

await step('Wajib Wi-Fi sekolah: IP lain ditolak, IP terdaftar diterima', async () => {
  await admin('POST', '/api/admin/schedules', { id: schedPlain, title: `Kegiatan ${tag}`, kind: 'kegiatan', start_date: today, end_date: today, start_time: '00:00', end_time: '23:59', require_face: false, require_liveness: false, require_school_ip: true });
  await admin('POST', '/api/admin/settings', { school_ips: ['10.9.9.0/24'] });
  let tk = await token(sis0, schedPlain);
  assert.equal((await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near) })).code, 'not_school_network');
  const st = await admin('GET', '/api/admin/settings');
  await admin('POST', '/api/admin/settings', { school_ips: ['10.9.9.0/24', st.my_ip] });
  tk = await token(sis0, schedPlain);
  assert.equal((await sis0('POST', '/api/attendance/submit', { token: tk.token, location: loc(near) })).status, 200);
});

await step('Presensi manual: wajib keterangan, batas kelas wali, izin tercatat', async () => {
  const targets = [students[3], students[4], students[5]].map((s) => ids[s.nis]);
  assert.equal((await waliC('POST', '/api/admin/attendance/manual', { schedule_id: schedFace, date: today, student_ids: targets, status: 'izin', note: '' })).code, 'note_required');
  assert.equal((await waliC('POST', '/api/admin/attendance/manual', { schedule_id: schedFace, date: today, student_ids: [ids[s40.nis]], status: 'izin', note: 'surat' })).status, 403);
  const r = await waliC('POST', '/api/admin/attendance/manual', { schedule_id: schedFace, date: today, student_ids: targets, status: 'izin', note: 'Lomba OSN kabupaten' });
  assert.equal(r.updated, 3);
});

await step('Ringkasan, rekap, dan percobaan ditolak', async () => {
  const o = await waliC('GET', `/api/admin/overview?date=${today}`);
  const sess = o.sessions.find((s) => s.id === schedFace);
  assert.equal(sess.totals.total, 30);
  assert.equal(sess.totals.terlambat, 1);
  assert.equal(sess.totals.izin, 3);
  assert.equal(sess.totals.belum, 26);
  const rc = await admin('GET', `/api/admin/recap?date=${today}&schedule_id=${schedFace}&class_id=${classAId}`);
  assert.equal(rc.rows.length, 30);
  assert.equal(rc.rows.find((x) => x.nis === s0.nis).record.status, 'terlambat');
  const at = await waliC('GET', `/api/admin/attempts?date=${today}`);
  const codes = new Set(at.attempts.map((a) => a.reason));
  for (const c of ['out_of_range', 'low_accuracy', 'face_mismatch', 'liveness_failed']) assert.ok(codes.has(c), c);
});

await step('Riwayat siswa bulan ini', async () => {
  const h = await sis0('GET', '/api/me/history');
  assert.ok(h.items.some((i) => i.status === 'terlambat'));
});

await step('Ekspor staf (batas rentang) & ekspor GAS dengan kunci', async () => {
  assert.equal((await admin('GET', `/api/admin/export?from=2026-01-01&to=2026-02-01`)).code, 'range_too_long');
  const e = await admin('GET', `/api/admin/export?from=${today}&to=${today}&class_id=${classAId}`);
  assert.ok(e.rows.length >= 30);
  const anon = client();
  assert.equal((await anon('GET', `/api/export/daily?date=${today}`, undefined, { 'X-Export-Key': 'salah' })).status, 401);
  const d = await anon('GET', `/api/export/daily?date=${today}`, undefined, { 'X-Export-Key': EXPORT_KEY });
  assert.equal(d.status, 200, d.message);
  assert.ok(d.rows.some((r) => r[3] === s0.nis && r[5] === 'terlambat'));
  const bk = await anon('GET', '/api/export/backup?table=face_profiles&after=', undefined, { 'X-Export-Key': EXPORT_KEY });
  assert.ok(bk.rows.length >= 1 && typeof bk.rows[0].embedding === 'string');
});

await step('Hari libur menutup jadwal hari itu', async () => {
  await admin('POST', '/api/admin/holidays', { date: today, name: 'Uji libur' });
  assert.equal((await sis0('GET', '/api/me/today')).holiday, 'Uji libur');
  await admin('POST', '/api/admin/holidays/delete', { date: today });
  assert.equal((await sis0('GET', '/api/me/today')).holiday, null);
});

await step('Menghapus jadwal yang punya data → dinonaktifkan', async () => {
  const r = await admin('POST', `/api/admin/schedules/${schedFace}/delete`, {});
  assert.equal(r.deactivated, true);
  await admin('POST', `/api/admin/schedules/${schedPlain}/delete`, {});
});

await step('5 password salah mengunci akun; admin bisa membuka', async () => {
  const c = client();
  const u = 's' + students[6].nis;
  let last;
  for (let i = 0; i < 5; i++) last = await c('POST', '/api/auth/login', { username: u, password: 'salah-salah' });
  assert.equal(last.status, 423);
  assert.equal((await c('POST', '/api/auth/login', { username: u, password: students[6].nis })).status, 423);
  await admin('POST', `/api/admin/users/${ids[students[6].nis]}/unlock`, {});
  assert.equal((await c('POST', '/api/auth/login', { username: u, password: students[6].nis })).status, 200);
});

await step('Logout menghapus sesi', async () => {
  await sis0('POST', '/api/auth/logout', {});
  assert.equal((await sis0('GET', '/api/me')).status, 401);
});

console.log(`\n${passed} kelompok pemeriksaan lulus.`);
