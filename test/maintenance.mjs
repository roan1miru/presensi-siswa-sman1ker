#!/usr/bin/env node
// Uji pemeliharaan: backup → pulihkan (kunci sama), pulihkan dengan kunci berbeda + reset ke NIS.
// Jalankan SETELAH test/smoke.mjs pada database lokal yang sama.
import assert from 'node:assert/strict';
const BASE = process.env.BASE || 'http://localhost:8787';
const ADMIN = { username: 'admin', password: process.env.ADMIN_PASS || 'KepalaTU-Kerjo-2026' };
let passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exit(1); } }
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({})); return { ...data, status: res.status };
  };
}
const admin = client();
await admin('POST', '/api/auth/login', ADMIN);

async function takeBackup() {
  const meta = await admin('GET', '/api/admin/backup');
  const out = { format: meta.format, key_check: meta.key_check, tables: {} };
  for (const t of meta.tables) {
    out.tables[t] = []; let after = '';
    for (;;) { const p = await admin('GET', `/api/admin/backup?table=${t}&after=${encodeURIComponent(after)}`); out.tables[t].push(...p.rows); if (p.done) break; after = p.next; }
  }
  return out;
}
async function restore(data, keyCheck) {
  const self = data.tables.users.find((u) => u.username === 'admin')?.id;
  const b = await admin('POST', '/api/admin/restore/begin', { format: data.format, key_check: keyCheck, confirm: 'PULIHKAN', self_old_id: self });
  assert.equal(b.status, 200, b.message);
  for (const t of Object.keys(data.tables)) {
    for (let i = 0; i < data.tables[t].length; i += 200) { const r = await admin('POST', '/api/admin/restore/chunk', { table: t, rows: data.tables[t].slice(i, i + 200) }); assert.equal(r.status, 200, `${t}: ${r.message}`); }
  }
  const hr = data.tables.classes.filter((c) => c.homeroom_user_id).map((c) => ({ id: c.id, homeroom_user_id: c.homeroom_user_id }));
  if (hr.length) await admin('POST', '/api/admin/restore/chunk', { table: 'classes_homeroom', rows: hr });
  return admin('POST', '/api/admin/restore/finish', {});
}
const count = (bk) => Object.fromEntries(Object.entries(bk.tables).map(([t, r]) => [t, r.length]));

let before;
await step('Backup dari aplikasi memuat semua tabel', async () => {
  before = await takeBackup();
  assert.ok(before.tables.users.length > 40 && before.tables.attendance.length > 0 && before.tables.face_profiles.length > 0);
  assert.ok(typeof before.key_check === 'string');
  assert.ok(!JSON.stringify(before).includes('system-pepper'), 'kunci sistem tidak ikut backup');
});
let student, studentPw;
await step('Menemukan siswa dengan password pribadi (dari uji sebelumnya)', async () => {
  for (const u of before.tables.users.filter((x) => x.role === 'siswa' && !x.is_default_password)) {
    for (const pw of ['kopi-pagi-81', 'teh-manis-40', 'nasi-goreng-2']) {
      if ((await client()('POST', '/api/auth/login', { username: u.username, password: pw })).status === 200) { student = u; studentPw = pw; break; }
    }
    if (student) break;
  }
  assert.ok(student);
});

await step('Pulihkan dengan kunci sama: jumlah baris sama, password siswa tetap berlaku', async () => {
  const fin = await restore(before, before.key_check);
  assert.equal(fin.same_key, true);
  const after = await takeBackup();
  const a = count(after), b = count(before);
  for (const t of ['users', 'classes', 'schedules', 'face_profiles', 'attendance', 'holidays']) assert.equal(a[t], b[t], t);
  const homeroomBefore = before.tables.classes.filter((c) => c.homeroom_user_id).length;
  assert.equal(after.tables.classes.filter((c) => c.homeroom_user_id).length, homeroomBefore, 'wali kelas terpasang ulang');
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { username: student.username, password: studentPw })).status, 200);
});

await step('Pulihkan dengan kunci berbeda: password ditandai reset, lalu dikembalikan ke NIS', async () => {
  const fin = await restore(before, 'kunci-lain');
  assert.equal(fin.same_key, false);
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { username: student.username, password: studentPw })).status, 401);
  let after = '', total = 0;
  for (;;) { const r = await admin('POST', '/api/admin/students/reset-all', { after, only_broken: true }); total += r.count; if (r.done) break; after = r.after; }
  assert.ok(total >= 40, `direset ${total}`);
  const r = await c('POST', '/api/auth/login', { username: student.username, password: student.nis });
  assert.equal(r.status, 200, r.message);
  assert.equal(r.must_change_password, true);
  assert.equal((await client()('POST', '/api/auth/login', ADMIN)).status, 200, 'admin yang memulihkan tetap bisa masuk');
});

console.log(`\n${passed} kelompok pemeriksaan lulus.`);
