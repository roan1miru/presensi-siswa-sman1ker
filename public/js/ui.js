// Helper DOM kecil: template HTML aman, toast, modal, format waktu Asia/Jakarta.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s);

/** Tagged template: semua interpolasi di-escape, kecuali Raw atau array berisi Raw. */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return raw(out);
}
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === false || v == null) return '';
  return esc(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function mount(el, content) {
  el.innerHTML = String(content);
}

// ───── Waktu (selalu Asia/Jakarta, apa pun zona waktu HP) ─────
const TZ = 'Asia/Jakarta';
let serverOffset = 0;
export function syncServerTime(serverMs) {
  if (typeof serverMs === 'number') serverOffset = serverMs - Date.now();
}
export const serverNow = () => new Date(Date.now() + serverOffset);
export const fmtTime = (d) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d).replace(/\./g, ':');
export const fmtDate = (d) => new Intl.DateTimeFormat('id-ID', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
export function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms)).replace(/\./g, ':');
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

// ───── Toast ─────
export function toast(message, type = 'info') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4200);
}

// ───── Modal ─────
/** Menampilkan dialog. `body` berupa html``; tombol dengan data-close menutup dialog. Mengembalikan elemen dialog. */
export function modal({ title, subtitle = '', body, actions = html`<button class="btn" data-close>Tutup</button>`, wide = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' modal-wide' : '');
  mount(dlg, html`
    <form method="dialog" class="modal-in">
      <header class="modal-head"><div><h2>${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div><button class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button></header>
      <div class="modal-body">${body}</div>
      <footer class="modal-foot">${actions}</footer>
    </form>`);
  document.body.append(dlg);
  // Enter di dalam isian menjalankan tombol utama, bukan tombol tutup.
  dlg.querySelectorAll('[data-close]').forEach((b) => { if (b.tagName === 'BUTTON') b.type = 'button'; });
  dlg.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    dlg.querySelector('[data-save], [data-ok]')?.click();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { e.preventDefault(); dlg.close(); }
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, message, confirmText = 'Lanjutkan', danger = false }) {
  return new Promise((resolve) => {
    const dlg = modal({
      title,
      body: html`<p>${message}</p>`,
      actions: html`<button class="btn" data-close>Batal</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-ok>${confirmText}</button>`,
    });
    let ok = false;
    dlg.querySelector('[data-ok]').addEventListener('click', (e) => { e.preventDefault(); ok = true; dlg.close(); });
    dlg.addEventListener('close', () => resolve(ok));
  });
}

/** Mengunci tombol selama proses async berjalan. */
export async function busy(button, fn) {
  if (!button) return fn();
  const label = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.innerHTML = label;
  }
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const ROLE_LABEL = { superadmin: 'Superadmin', admin: 'Admin Sekolah', wali: 'Wali Kelas', siswa: 'Siswa' };

// ───── Ikon garis (24×24, stroke) ─────
const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5V8h3.5"/><path d="M12 8v4.2l2.8 1.8"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.9-3.6 3.7-5.4 7-5.4s6.1 1.8 7 5.4"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.2 14.6c2.5.2 4.2 1.8 4.8 4.9"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="2.5"/><path d="M9 4.5h6V7H9zM9 12h6M9 16h4"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="9.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".6" fill="currentColor"/><path d="M9.5 15c1.4 1 3.6 1 5 0"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  id: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><circle cx="9" cy="11" r="2"/><path d="M6 15.5c.5-1.3 1.6-2 3-2s2.5.7 3 2M14.5 10h3M14.5 13h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4.4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-.9a7 7 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  logout: '<path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
  key: '<circle cx="8" cy="15" r="3.5"/><path d="m10.5 12.5 8-8M15.5 7.5l2 2M13.5 9.5l1.5 1.5"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  wifi: '<path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.4a4 4 0 0 1 6 0"/><circle cx="12" cy="19.3" r=".8" fill="currentColor"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3L9.5 4.5h5L16.2 7h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7"/>',
  edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2"/><rect x="7" y="14" width="10" height="6" rx="1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};
export const icon = (name, cls = '') => raw(`<svg viewBox="0 0 24 24" class="i ${cls}" aria-hidden="true">${ICONS[name] || ''}</svg>`);

export const STATUS_LABEL = { hadir: 'Hadir', terlambat: 'Terlambat', izin: 'Izin', sakit: 'Sakit', alfa: 'Alfa', belum: 'Belum presensi' };
export const statusChip = (s, label) => html`<span class="st st-${s}">${label || STATUS_LABEL[s] || s}</span>`;

export const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export const DAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

/** Tanggal hari ini (WIB, mengikuti jam server). */
export const todayWib = () => new Date(serverNow().getTime() + 7 * 3600e3).toISOString().slice(0, 10);
export function fmtDay(date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', ...opts }).format(new Date(date + 'T00:00:00Z'));
}
export function fmtClock(ms, seconds = false) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false })
    .format(new Date(ms)).replace(/\./g, ':');
}
export function relTime(ms) {
  if (!ms) return '—';
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return fmtDateTime(ms);
}
