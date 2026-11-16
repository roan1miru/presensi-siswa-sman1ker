import { get, post } from '../api.js';
import { $$, html, raw, mount, icon, toast, modal, busy, confirmDialog, statusChip } from '../ui.js';
import { pageHead } from './admin.js';

export default async function pageClasses(el) {
  const [{ classes }, { staff }] = await Promise.all([get('/api/admin/classes'), get('/api/admin/staff')]);
  const walis = staff.filter((s) => s.role === 'wali' && s.active);
  const sorted = [...classes].sort((a, b) => a.name.localeCompare(b.name, 'id', { numeric: true }));

  mount(el, html`
    ${pageHead('Kelas', `${classes.length} kelas. Kelas juga dibuat otomatis saat impor siswa.`,
      html`<button class="btn btn-primary" id="add">${icon('plus', 'i-sm')} Tambah kelas</button>`)}
    <div class="card">${sorted.length === 0 ? html`<div class="empty">${icon('layers', 'i-lg')}<b>Belum ada kelas</b><a class="btn" href="#/admin/impor">Impor siswa</a></div>` : html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Kelas</th><th>Wali kelas</th><th class="r">Siswa</th><th class="r">Wajah terdaftar</th><th></th></tr></thead>
        <tbody>${sorted.map((c) => html`<tr>
          <td class="strong">${c.name}</td>
          <td>${c.homeroom_name || statusChip('terlambat', 'Belum ada wali')}</td>
          <td class="r">${c.students}</td>
          <td class="r">${c.faces} <span class="muted">/ ${c.students}</span></td>
          <td class="act"><button class="btn btn-sm" data-edit="${c.id}">${icon('edit', 'i-sm')} Ubah</button>
            ${c.students === 0 ? html`<button class="btn btn-sm btn-quiet" data-del="${c.id}" aria-label="Hapus kelas ${c.name}">${icon('trash', 'i-sm')}</button>` : ''}</td>
        </tr>`)}</tbody></table></div>`}
    </div>`);

  const open = (c = {}) => {
    const dlg = modal({
      title: c.id ? `Ubah kelas ${c.name}` : 'Tambah kelas',
      body: html`
        <label class="field"><span>Nama kelas</span><input name="name" value="${c.name || ''}" maxlength="40" placeholder="X TKJ 1"></label>
        <label class="field"><span>Wali kelas</span><select name="homeroom"><option value="">Belum ditetapkan</option>
          ${walis.map((w) => html`<option value="${w.id}" ${w.id === c.homeroom_user_id ? raw('selected') : ''}>${w.name} (${w.username})</option>`)}</select>
          ${walis.length ? '' : html`<small>Belum ada akun wali. Buat di menu Akun guru.</small>`}</label>
        <div class="alert alert-error" hidden></div>`,
      actions: html`<button class="btn" data-close>Batal</button><button class="btn btn-primary" data-save>Simpan</button>`,
    });
    dlg.querySelector('[data-save]').addEventListener('click', (e) => {
      e.preventDefault();
      busy(e.currentTarget, async () => {
        try {
          await post('/api/admin/classes', { id: c.id, name: dlg.querySelector('[name=name]').value, homeroom_user_id: dlg.querySelector('[name=homeroom]').value || null });
          dlg.close();
          toast('Kelas disimpan.', 'success');
          pageClasses(el);
        } catch (ex) { const a = dlg.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
      });
    });
  };
  el.querySelector('#add').addEventListener('click', () => open());
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => open(classes.find((c) => c.id === b.dataset.edit))));
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    const c = classes.find((x) => x.id === b.dataset.del);
    if (!(await confirmDialog({ title: `Hapus kelas ${c.name}?`, message: 'Kelas kosong ini akan dihapus.', confirmText: 'Hapus', danger: true }))) return;
    try { await post(`/api/admin/classes/${c.id}/delete`); toast('Kelas dihapus.', 'success'); pageClasses(el); } catch (ex) { toast(ex.message, 'error'); }
  }));
}
