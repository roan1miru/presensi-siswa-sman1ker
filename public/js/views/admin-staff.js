import { get, post } from '../api.js';
import { html, mount, icon, toast, modal, busy, confirmDialog, statusChip, relTime, ROLE_LABEL } from '../ui.js';
import { printCards } from '../print.js';
import { state } from '../app.js';
import { pageHead } from './admin.js';

function showSecret(name, username, password) {
  const dlg = modal({
    title: 'Sandi sementara',
    subtitle: `${name}, username ${username}`,
    body: html`<div class="secret">${password}</div><p class="small muted">Hanya ditampilkan sekali. Berikan langsung kepada pemilik akun. Sandi wajib diganti saat masuk pertama.</p>`,
    actions: html`<button class="btn" data-print>${icon('print', 'i-sm')} Cetak kartu</button><button class="btn btn-primary" data-close>Selesai</button>`,
  });
  dlg.querySelector('[data-print]').addEventListener('click', (e) => {
    e.preventDefault();
    printCards([{ name, username, password }], state.me.school.name, { staff: true });
  });
}

export default async function pageStaff(el) {
  const [{ staff, server_time: now }, { classes }] = await Promise.all([get('/api/admin/staff'), get('/api/admin/classes')]);
  const me = state.me.user;
  const superadmin = me.role === 'superadmin';

  mount(el, html`
    ${pageHead('Akun guru', 'Wali kelas melihat dan mengelola siswa kelasnya sendiri. Admin mengelola seluruh sekolah.',
      html`<button class="btn btn-primary" id="add">${icon('plus', 'i-sm')} Tambah akun</button>`)}
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Kelas diampu</th><th>Status</th><th>Login terakhir</th><th></th></tr></thead>
      <tbody>${staff.map((s) => {
        const editable = s.id !== me.id && (superadmin || s.role === 'wali');
        const locked = s.locked_until && s.locked_until > now;
        return html`<tr>
          <td class="strong">${s.name}</td><td class="num">${s.username}</td><td>${ROLE_LABEL[s.role]}</td>
          <td>${s.classes || html`<span class="muted">—</span>`}</td>
          <td>${!s.active ? statusChip('belum', 'Nonaktif') : locked ? statusChip('alfa', 'Terkunci') : s.is_default_password ? statusChip('terlambat', 'Belum aktivasi') : statusChip('hadir', 'Aktif')}</td>
          <td class="muted small">${relTime(s.last_login_at)}</td>
          <td class="act">${editable ? html`
            ${locked ? html`<button class="btn btn-sm" data-unlock="${s.id}">Buka kunci</button>` : ''}
            <button class="btn btn-sm" data-reset="${s.id}">Reset sandi</button>
            <button class="btn btn-sm btn-quiet" data-toggle="${s.id}">${s.active ? 'Nonaktifkan' : 'Aktifkan'}</button>` : ''}</td>
        </tr>`;
      })}</tbody></table></div></div>`);

  el.querySelector('#add').addEventListener('click', () => {
    const free = classes.filter((c) => !c.homeroom_user_id);
    const dlg = modal({
      title: 'Tambah akun',
      body: html`
        <label class="field"><span>Nama lengkap</span><input name="name" maxlength="100" placeholder="Dra. Sri Wahyuni"></label>
        <label class="field"><span>Username</span><input name="username" maxlength="30" autocapitalize="none" spellcheck="false" placeholder="sri.wahyuni">
          <small>Huruf kecil, angka, titik. Awalan s+angka khusus siswa.</small></label>
        <div class="field"><span>Peran</span><div class="seg">
          <label><input type="radio" name="role" value="wali" checked><span>Wali kelas</span></label>
          ${superadmin ? html`<label><input type="radio" name="role" value="admin"><span>Admin sekolah</span></label>
          <label><input type="radio" name="role" value="superadmin"><span>Superadmin cadangan</span></label>` : ''}</div></div>
        <label class="field" id="cls"><span>Kelas yang diampu</span><select name="class"><option value="">Pilih nanti</option>${free.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></label>
        <div class="alert alert-error" hidden></div>`,
      actions: html`<button class="btn" data-close>Batal</button><button class="btn btn-primary" data-save>Buat akun</button>`,
    });
    dlg.addEventListener('change', () => { dlg.querySelector('#cls').hidden = dlg.querySelector('[name=role]:checked').value !== 'wali'; });
    dlg.querySelector('[data-save]').addEventListener('click', (e) => {
      e.preventDefault();
      busy(e.currentTarget, async () => {
        try {
          const r = await post('/api/admin/staff', {
            name: dlg.querySelector('[name=name]').value, username: dlg.querySelector('[name=username]').value,
            role: dlg.querySelector('[name=role]:checked').value, class_id: dlg.querySelector('[name=class]').value || null,
          });
          dlg.close();
          showSecret(r.name, r.username, r.password);
          pageStaff(el);
        } catch (ex) { const a = dlg.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
      });
    });
  });

  el.onclick = async (e) => {
    const b = e.target.closest('button[data-reset], button[data-toggle], button[data-unlock]');
    if (!b) return;
    const s = staff.find((x) => x.id === (b.dataset.reset || b.dataset.toggle || b.dataset.unlock));
    try {
      if (b.dataset.unlock) { await post(`/api/admin/users/${s.id}/unlock`); toast('Akun dibuka.', 'success'); }
      else if (b.dataset.reset) {
        if (!(await confirmDialog({ title: `Reset sandi ${s.name}?`, message: 'Sandi lama tidak berlaku lagi dan semua perangkatnya keluar.', confirmText: 'Reset sandi' }))) return;
        const r = await post(`/api/admin/users/${s.id}/reset-password`);
        showSecret(s.name, s.username, r.password);
      } else {
        if (!(await confirmDialog({ title: `${s.active ? 'Nonaktifkan' : 'Aktifkan'} ${s.name}?`, message: s.active ? 'Akun tidak bisa masuk sampai diaktifkan lagi.' : 'Akun bisa masuk kembali.', confirmText: s.active ? 'Nonaktifkan' : 'Aktifkan', danger: s.active }))) return;
        await post(`/api/admin/users/${s.id}/active`, { active: !s.active });
      }
      pageStaff(el);
    } catch (ex) { toast(ex.message, 'error'); }
  };
}
