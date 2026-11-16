import { get, post } from '../api.js';
import { $, html, raw, mount, icon, toast, modal, busy, confirmDialog, statusChip, relTime } from '../ui.js';
import { printCards } from '../print.js';
import { state } from '../app.js';
import { pageHead, isAdmin } from './admin.js';

export default async function pageStudents(el) {
  const { classes } = await get('/api/admin/classes');
  const admin = isAdmin();
  if (!admin && !classes.length) {
    mount(el, html`${pageHead('Siswa', '')}<div class="card"><div class="empty">${icon('users', 'i-lg')}<b>Anda belum menjadi wali kelas mana pun</b><span>Minta admin sekolah menetapkan kelas Anda.</span></div></div>`);
    return;
  }
  let classId = sessionStorage.getItem('siswaClass') || (admin ? '' : classes[0].id);
  let rows = [];
  let now = Date.now();
  let filter = 'semua';

  mount(el, html`
    ${pageHead(admin ? 'Siswa' : 'Siswa kelas saya', 'Username siswa adalah huruf s diikuti NIS. Reset password mengembalikannya ke NIS.',
      admin ? html`<a class="btn" href="#/admin/impor">${icon('upload', 'i-sm')} Impor siswa</a>` : '')}
    <div class="card">
      <div class="toolbar mt-4">
        <select id="f-class" aria-label="Kelas">${admin ? html`<option value="">Semua kelas</option><option value="_none">Tanpa kelas</option>` : ''}${classes.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
        <input type="search" id="f-q" placeholder="Cari nama atau NIS" aria-label="Cari siswa">
        <div class="session-tabs" id="f-st"></div>
        <button class="btn btn-sm" id="cards" title="Cetak kartu login untuk siswa yang ditampilkan">${icon('print', 'i-sm')} Kartu login</button>
      </div>
      <div id="list"><div class="loading">Memuat…</div></div>
    </div>`);
  const sel = $('#f-class', el);
  sel.value = classId;
  if (sel.value !== classId) sel.value = sel.options[0].value;

  const status = (s) => {
    if (!s.active) return 'nonaktif';
    if (s.locked_until && s.locked_until > now) return 'terkunci';
    return s.is_default_password ? 'default' : 'aktif';
  };
  const chip = (k) => ({
    nonaktif: statusChip('belum', 'Nonaktif'), terkunci: statusChip('alfa', 'Terkunci'),
    default: statusChip('terlambat', 'Password NIS'), aktif: statusChip('hadir', 'Aktif'),
  })[k];

  const visible = () => {
    const q = $('#f-q', el).value.trim().toLowerCase();
    return rows.filter((s) => (!q || s.name.toLowerCase().includes(q) || s.nis.includes(q))
      && (filter === 'semua' || (filter === 'wajah' ? !s.face_enrolled_at : status(s) === filter)));
  };

  const draw = () => {
    const n = (k) => rows.filter((s) => (k === 'wajah' ? !s.face_enrolled_at : status(s) === k)).length;
    mount($('#f-st', el), html`${[['semua', 'Semua', rows.length], ['default', 'Password NIS', n('default')], ['wajah', 'Wajah belum', n('wajah')], ['terkunci', 'Terkunci', n('terkunci')]]
      .map(([k, l, c]) => html`<button data-filter="${k}" aria-pressed="${filter === k}">${l}<small>${c}</small></button>`)}`);
    const show = visible();
    mount($('#list', el), show.length === 0 ? html`<div class="empty"><span>Tidak ada siswa yang cocok.</span></div>` : html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Siswa</th><th>Username</th><th>Kelas</th><th>Akun</th><th>Wajah</th><th>Login terakhir</th><th></th></tr></thead>
        <tbody>${show.slice(0, 600).map((s) => html`<tr>
          <td class="strong">${s.name}<span class="sub num">NIS ${s.nis}</span></td>
          <td class="num">${s.username}</td>
          <td>${s.class_name || html`<span class="muted">—</span>`}</td>
          <td>${chip(status(s))}</td>
          <td>${s.face_enrolled_at ? statusChip('hadir', 'Terdaftar') : html`<a class="st st-belum" href="#/admin/wajah" data-face="${s.class_id || ''}">Belum</a>`}</td>
          <td class="muted small">${relTime(s.last_login_at)}</td>
          <td class="act">
            ${status(s) === 'terkunci' ? html`<button class="btn btn-sm" data-unlock="${s.id}">Buka kunci</button>` : ''}
            <button class="btn btn-sm" data-reset="${s.id}">Reset ke NIS</button>
            ${admin ? html`<button class="btn btn-sm btn-quiet" data-edit="${s.id}" aria-label="Ubah ${s.name}">${icon('edit', 'i-sm')}</button>` : ''}
          </td></tr>`)}</tbody></table></div>
      <div class="table-foot">${show.length} siswa${show.length > 600 ? ', menampilkan 600 pertama. Gunakan filter kelas.' : '.'}</div>`);
  };

  const load = async () => {
    mount($('#list', el), html`<div class="loading">Memuat…</div>`);
    const r = await get(`/api/admin/students?class_id=${encodeURIComponent(sel.value)}`);
    rows = r.students;
    now = r.server_time;
    sessionStorage.setItem('siswaClass', sel.value);
    draw();
  };
  sel.addEventListener('change', load);
  $('#f-q', el).addEventListener('input', draw);

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button, a[data-face]');
    if (!b) return;
    const find = (id) => rows.find((s) => s.id === id);
    if (b.dataset.filter) { filter = b.dataset.filter; draw(); }
    else if (b.dataset.face !== undefined) sessionStorage.setItem('wajahClass', b.dataset.face);
    else if (b.id === 'cards') {
      const show = visible();
      if (!show.length) return;
      if (!(await confirmDialog({ title: `Cetak ${show.length} kartu login?`, message: 'Kartu berisi username dan password awal (NIS). Siswa yang sudah mengganti password tetap bisa memakai kartunya untuk username.', confirmText: 'Cetak' }))) return;
      printCards(show.map((s) => ({ name: s.name, username: s.username, nis: s.nis, class_name: s.class_name })), state.me.school.name);
    } else if (b.dataset.reset) {
      const s = find(b.dataset.reset);
      if (!(await confirmDialog({ title: 'Kembalikan password ke NIS?', message: `Password ${s.name} menjadi ${s.nis}. Semua perangkat yang sedang masuk akan keluar.`, confirmText: 'Reset ke NIS' }))) return;
      try { await post(`/api/admin/users/${s.id}/reset-password`); toast(`Password ${s.name} kembali ke NIS.`, 'success'); load(); } catch (ex) { toast(ex.message, 'error'); }
    } else if (b.dataset.unlock) {
      try { await post(`/api/admin/users/${b.dataset.unlock}/unlock`); toast('Akun dibuka.', 'success'); load(); } catch (ex) { toast(ex.message, 'error'); }
    } else if (b.dataset.edit) {
      const s = find(b.dataset.edit);
      const dlg = modal({
        title: s.name,
        subtitle: `NIS ${s.nis}, username ${s.username}`,
        body: html`
          <label class="field"><span>Nama</span><input name="name" value="${s.name}" maxlength="100"></label>
          <label class="field"><span>Kelas</span><select name="class"><option value="">Tanpa kelas</option>${classes.map((c) => html`<option value="${c.id}" ${c.id === s.class_id ? raw('selected') : ''}>${c.name}</option>`)}</select></label>
          <label class="check"><input type="checkbox" name="active" ${s.active ? raw('checked') : ''}><div><b>Akun aktif</b><small>Siswa yang pindah sekolah cukup dinonaktifkan agar riwayatnya tetap ada.</small></div></label>
          <div class="alert alert-error" hidden></div>`,
        actions: html`<button class="btn" data-close>Batal</button><button class="btn btn-primary" data-save>Simpan</button>`,
      });
      dlg.querySelector('[data-save]').addEventListener('click', (ev) => {
        ev.preventDefault();
        busy(ev.currentTarget, async () => {
          try {
            await post(`/api/admin/students/${s.id}`, { name: dlg.querySelector('[name=name]').value, class_id: dlg.querySelector('[name=class]').value || null });
            const act = dlg.querySelector('[name=active]').checked;
            if (act !== !!s.active) await post(`/api/admin/users/${s.id}/active`, { active: act });
            dlg.close();
            toast('Data siswa disimpan.', 'success');
            load();
          } catch (ex) { const a = dlg.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
        });
      });
    }
  });
  await load();
}
