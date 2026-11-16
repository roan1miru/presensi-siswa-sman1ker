// Worker utama: /api/* ditangani di sini, selain itu dilayani static assets (folder public/).
import { HttpError, errorResponse } from './lib/http.js';
import * as auth from './routes/auth.js';
import * as admin from './routes/admin.js';
import * as sched from './routes/schedules.js';
import * as face from './routes/face.js';
import * as att from './routes/attendance.js';
import * as exp from './routes/export.js';
import * as setup from './routes/setup.js';
import * as mnt from './routes/maintenance.js';
import { ensureSchema } from './lib/migrate.js';

const routes = [
  // Akun
  ['POST', '/api/auth/login', auth.login],
  ['POST', '/api/auth/logout', auth.logout],
  ['POST', '/api/auth/change-password', auth.changePassword],
  ['GET', '/api/me', auth.me],
  ['GET', '/api/public/config', auth.publicConfig],

  // Instalasi awal (hanya berfungsi sebelum ada admin pertama)
  ['GET', '/api/setup/status', setup.status],
  ['POST', '/api/setup', setup.install],

  // Siswa
  ['GET', '/api/me/today', sched.myToday],
  ['GET', '/api/me/history', att.myHistory],
  ['POST', '/api/attendance/token', att.issueToken],
  ['POST', '/api/attendance/submit', att.submit],

  // Staf: data induk
  ['GET', '/api/admin/classes', admin.listClasses],
  ['POST', '/api/admin/classes', admin.saveClass],
  ['POST', '/api/admin/classes/:id/delete', admin.deleteClass],
  ['GET', '/api/admin/students', admin.listStudents],
  ['POST', '/api/admin/students/import', admin.importStudents],
  ['POST', '/api/admin/students/:id', admin.updateStudent],
  ['POST', '/api/admin/users/:id/reset-password', admin.resetPassword],
  ['POST', '/api/admin/users/:id/unlock', admin.unlockUser],
  ['POST', '/api/admin/users/:id/active', admin.setActive],
  ['GET', '/api/admin/staff', admin.listStaff],
  ['POST', '/api/admin/staff', admin.createStaff],
  ['POST', '/api/admin/staff/:id', admin.updateStaff],
  ['GET', '/api/admin/settings', admin.getSettings],
  ['POST', '/api/admin/settings', admin.saveSettings],
  ['GET', '/api/admin/holidays', admin.listHolidays],
  ['POST', '/api/admin/holidays', admin.saveHoliday],
  ['POST', '/api/admin/holidays/delete', admin.deleteHoliday],

  // Staf: jadwal, wajah, presensi
  ['GET', '/api/admin/schedules', sched.listSchedules],
  ['POST', '/api/admin/schedules', sched.saveSchedule],
  ['POST', '/api/admin/schedules/:id/delete', sched.deleteSchedule],
  ['GET', '/api/admin/schedule-day', sched.scheduleDay],
  ['POST', '/api/admin/face/enroll', face.enroll],
  ['POST', '/api/admin/face/:id/delete', face.remove],
  ['GET', '/api/admin/overview', att.overview],
  ['GET', '/api/admin/recap', att.recap],
  ['POST', '/api/admin/attendance/manual', att.manual],
  ['GET', '/api/admin/attempts', att.attempts],
  ['GET', '/api/admin/export', exp.staffExport],

  // Pemeliharaan (backup, pemulihan, kunci ekspor)
  ['POST', '/api/admin/export-key', mnt.exportKey],
  ['GET', '/api/admin/backup', mnt.adminBackup],
  ['GET', '/api/admin/restore', mnt.restoreStatus],
  ['POST', '/api/admin/restore/begin', mnt.restoreBegin],
  ['POST', '/api/admin/restore/chunk', mnt.restoreChunk],
  ['POST', '/api/admin/restore/finish', mnt.restoreFinish],
  ['POST', '/api/admin/students/reset-all', mnt.resetAllStudents],

  // Google Apps Script (header X-Export-Key)
  ['GET', '/api/export/daily', exp.dailyExport],
  ['GET', '/api/export/backup', exp.backup],
];

const compiled = routes.map(([method, path, handler]) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([0-9a-f-]{36})')) + '$');
  return { method, re, keys, handler };
});

function match(method, pathname) {
  let pathMatched = false;
  for (const r of compiled) {
    const m = r.re.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) };
  }
  if (pathMatched) throw new HttpError(405, 'method_not_allowed', 'Metode tidak diizinkan.');
  throw new HttpError(404, 'not_found', 'Endpoint tidak ditemukan.');
}

/** sw.js diberi nomor versi deploy otomatis → cache HP siswa diperbarui tiap deploy tanpa edit manual. */
async function serviceWorker(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!res.ok) return res;
  const version = env.CF_VERSION_METADATA?.id || 'dev';
  const body = (await res.text()).replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
  return new Response(body, {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/sw.js') return serviceWorker(request, env);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      await ensureSchema(env);
      const { handler, params } = match(request.method, url.pathname);
      return await handler(request, env, params);
    } catch (err) {
      return errorResponse(err);
    }
  },

  // Cron harian 00.00 WIB: bersihkan sesi/token kedaluwarsa dan log lama agar database tetap ramping.
  async scheduled(_event, env) {
    await ensureSchema(env);
    const now = Date.now();
    const DAY = 864e5;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM attendance_tokens WHERE expires_at < ?').bind(now - DAY),
      env.DB.prepare('DELETE FROM attempt_logs WHERE ts < ?').bind(now - 180 * DAY),
      env.DB.prepare('DELETE FROM audit_logs WHERE ts < ?').bind(now - 400 * DAY),
    ]);
  },
};
