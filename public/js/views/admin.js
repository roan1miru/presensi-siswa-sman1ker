import { post } from '../api.js';
import { $, html, raw, mount, icon, initials, ROLE_LABEL } from '../ui.js';
import { state, go } from '../app.js';

export const isAdmin = () => ['admin', 'superadmin'].includes(state.me.user.role);

const PAGES = {
  'hari-ini': { label: 'Hari ini', icon: 'home', group: 'Harian', load: () => import('./admin-today.js') },
  rekap: { label: 'Rekap presensi', icon: 'clipboard', group: 'Harian', load: () => import('./admin-recap.js') },
  jadwal: { label: 'Jadwal', icon: 'calendar', group: 'Data', admin: true, load: () => import('./admin-schedules.js') },
  siswa: { label: 'Siswa', icon: 'users', group: 'Data', load: () => import('./admin-students.js') },
  wajah: { label: 'Data wajah', icon: 'face', group: 'Data', load: () => import('./admin-faces.js') },
  kelas: { label: 'Kelas', icon: 'layers', group: 'Data', admin: true, load: () => import('./admin-classes.js') },
  impor: { label: 'Impor siswa', icon: 'upload', group: 'Data', admin: true, load: () => import('./admin-import.js') },
  akun: { label: 'Akun guru', icon: 'id', group: 'Sekolah', admin: true, load: () => import('./admin-staff.js') },
  pengaturan: { label: 'Pengaturan', icon: 'settings', group: 'Sekolah', admin: true, load: () => import('./admin-settings.js') },
};

export function renderAdmin(root, page) {
  const { user, school } = state.me;
  const visible = Object.entries(PAGES).filter(([, p]) => !p.admin || isAdmin());
  const current = PAGES[page];
  if (!current || (current.admin && !isAdmin())) { go('#/admin/hari-ini'); return null; }
  const groups = [...new Set(visible.map(([, p]) => p.group))];

  mount(root, html`
  <div class="shell">
    <aside class="side" id="side" aria-label="Navigasi">
      <div class="mark"><img src="/icons/icon.svg" alt="" width="40" height="40"><div><b>${school.name}</b><span>Presensi siswa</span></div></div>
      <nav>${groups.map((g) => html`<p>${g}</p>${visible.filter(([, p]) => p.group === g).map(([k, p]) =>
        html`<a href="#/admin/${k}" ${k === page ? raw('aria-current="page"') : ''}>${icon(p.icon)}<span>${p.label}</span></a>`)}`)}</nav>
      <div class="side-foot">
        <div class="who"><span class="avatar">${initials(user.name)}</span><div><b>${user.name}</b><span>${ROLE_LABEL[user.role]}${user.role === 'wali' && user.homeroom_classes.length ? `, ${user.homeroom_classes.map((c) => c.name).join(', ')}` : ''}</span></div></div>
        <a class="btn btn-quiet btn-sm" href="#/password">${icon('key', 'i-sm')} Ganti password</a>
        <button class="btn btn-quiet btn-sm" id="logout">${icon('logout', 'i-sm')} Keluar</button>
      </div>
    </aside>
    <div class="scrim" id="scrim" hidden></div>
    <div class="main">
      <header class="main-top"><button class="icon-btn menu-btn" id="menu" aria-label="Buka menu">${icon('menu')}</button><b>${current.label}</b></header>
      <div class="page" id="page"><div class="loading">Memuat…</div></div>
    </div>
  </div>`);

  const side = $('#side');
  const scrim = $('#scrim');
  const toggle = (open) => { side.classList.toggle('open', open); scrim.hidden = !open; };
  $('#menu').addEventListener('click', () => toggle(true));
  scrim.addEventListener('click', () => toggle(false));
  $('#logout').addEventListener('click', async () => {
    await post('/api/auth/logout').catch(() => {});
    state.me = null;
    go('#/masuk');
  });

  const el = $('#page');
  let pageCleanup = null;
  let gone = false;
  current.load()
    .then((m) => (gone ? null : m.default(el)))
    .then((c) => { pageCleanup = c; if (gone) c?.(); })
    .catch((e) => mount(el, html`<div class="card"><div class="empty">${icon('alert', 'i-lg')}<b>Halaman belum bisa dimuat</b><span>${e.message}</span></div></div>`));
  return () => { gone = true; pageCleanup?.(); };
}

/** Kepala halaman standar. */
export const pageHead = (title, sub, actions = '') => html`
  <div class="page-head"><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ''}</div>${actions ? html`<div class="btn-row">${actions}</div>` : ''}</div>`;

/** Batang proporsi status. */
export function spread(t, cls = '') {
  const total = t.total || 0;
  if (!total) return html`<div class="spread ${cls}"></div>`;
  const seg = (k) => (t[k] ? html`<i class="c-${k}" data-w="${(t[k] / total) * 100}"></i>` : '');
  return html`<div class="spread ${cls}" role="img" aria-label="Hadir ${t.hadir}, terlambat ${t.terlambat}, izin ${t.izin}, sakit ${t.sakit}, alfa ${t.alfa}, belum ${t.belum} dari ${total}">${seg('hadir')}${seg('terlambat')}${seg('izin')}${seg('sakit')}${seg('alfa')}</div>`;
}
/** Lebar segmen diterapkan lewat CSSOM (CSP melarang style inline). */
export function applyWidths(root) {
  root.querySelectorAll('[data-w]').forEach((i) => { i.style.width = `${i.dataset.w}%`; });
}
