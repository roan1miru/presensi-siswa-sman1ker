// Titik masuk PWA: memuat sesi, memilih tampilan sesuai peran, router berbasis hash.
import { get, setUnauthenticatedHandler } from './api.js';
import { $, html, mount, syncServerTime, toast } from './ui.js';

export const state = { me: null, school: null, setup_needed: false };
const app = $('#app');
let cleanup = null;
let routeSeq = 0;

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

export async function loadMe() {
  try {
    const me = await get('/api/me');
    syncServerTime(me.server_time);
    state.me = me;
    state.school = me.school;
  } catch (e) {
    state.me = null;
    if (e.status !== 401) throw e;
  }
  return state.me;
}

const home = (role) => (role === 'siswa' ? '#/beranda' : '#/admin/hari-ini');

async function route() {
  const seq = ++routeSeq;
  if (cleanup) { try { cleanup(); } catch { /* abaikan */ } cleanup = null; }
  const hash = location.hash || '#/';
  const me = state.me;
  let view;

  if (!me && state.setup_needed) {
    if (hash !== '#/instalasi') return go('#/instalasi');
    view = (await import('./views/setup.js')).renderSetup;
  } else if (!me) {
    if (hash !== '#/masuk') return go('#/masuk');
    view = (await import('./views/login.js')).renderLogin;
  } else if (me.must_change_password && hash !== '#/password') {
    return go('#/password');
  } else if (hash === '#/password') {
    view = (await import('./views/login.js')).renderPassword;
  } else if (hash === '#/masuk' || hash === '#/' || hash === '') {
    return go(home(me.user.role));
  } else if (me.user.role === 'siswa') {
    const page = hash.replace('#/', '');
    if (!['beranda', 'riwayat', 'akun'].includes(page)) return go('#/beranda');
    const mod = await import('./views/student.js');
    if (seq !== routeSeq) return;
    cleanup = mod.renderStudent(app, page) || null;
    return;
  } else {
    if (!hash.startsWith('#/admin/')) return go('#/admin/hari-ini');
    const mod = await import('./views/admin.js');
    if (seq !== routeSeq) return;
    cleanup = mod.renderAdmin(app, hash.slice('#/admin/'.length)) || null;
    return;
  }
  if (seq !== routeSeq) return;
  cleanup = view(app) || null;
}

setUnauthenticatedHandler(() => {
  if (!state.me) return;
  toast('Sesi Anda berakhir. Silakan masuk kembali.');
  state.me = null;
  go('#/masuk');
});

window.addEventListener('hashchange', route);

(async () => {
  try {
    await loadMe();
    if (!state.me) {
      const pc = await get('/api/public/config');
      state.school = pc.school;
      state.setup_needed = pc.setup_needed;
    }
  } catch (e) {
    mount(app, html`<div class="fatal"><h1>Aplikasi belum bisa dimuat</h1><p class="muted">${e.message}</p><button class="btn btn-primary" id="reload">Muat ulang</button></div>`);
    $('#reload').addEventListener('click', () => location.reload());
    return;
  }
  route();
})();

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
