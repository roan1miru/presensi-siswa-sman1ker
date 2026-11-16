import { get, post } from '../api.js';
import { $, $$, html, raw, mount, icon, toast, modal, busy, statusChip, fmtClock, fmtDay, todayWib, downloadText, STATUS_LABEL } from '../ui.js';
import { toCsv } from '../csv.js';
import { pageHead } from './admin.js';

const REASON = {
  out_of_range: 'Di luar area', low_accuracy: 'GPS kurang akurat', stale_location: 'Lokasi kedaluwarsa', bad_location: 'Lokasi tidak valid',
  face_mismatch: 'Wajah tidak cocok', liveness_failed: 'Gerakan tidak lengkap', face_not_enrolled: 'Wajah belum terdaftar',
  not_school_network: 'Bukan Wi-Fi sekolah', token_expired: 'Waktu habis', bad_token: 'Sesi tidak valid', model_mismatch: 'Versi aplikasi lama',
  bad_face: 'Data wajah tidak lengkap', not_open: 'Belum dibuka', closed: 'Sudah ditutup', no_schedule: 'Jadwal tidak berlaku', holiday: 'Hari libur',
};

export default async function pageRecap(el) {
  const saved = JSON.parse(sessionStorage.getItem('rekap') || '{}');
  sessionStorage.removeItem('rekap');
  const today = todayWib();
  const st = { date: saved.date || today, schedule: saved.schedule_id || '', cls: saved.class_id || '', tab: saved.tab || 'siswa', filter: 'semua' };
  const { classes } = await get('/api/admin/classes');
  let schedules = [];
  let rows = [];
  let closed = false;
  const selected = new Set();

  mount(el, html`
    ${pageHead('Rekap presensi', 'Lihat status setiap siswa, isi izin/sakit, dan periksa percobaan yang ditolak.',
      html`<button class="btn" id="export">${icon('download', 'i-sm')} Unduh CSV</button>`)}
    <div class="card">
      <div class="toolbar mt-4">
        <input type="date" id="f-date" max="${today}" value="${st.date}" aria-label="Tanggal">
        <select id="f-sched" aria-label="Sesi"></select>
        <select id="f-class" aria-label="Kelas">${classes.length > 1 ? html`<option value="">Semua kelas</option>` : ''}${classes.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
        <span class="spacer"></span>
        <div class="session-tabs" role="tablist">
          <button role="tab" data-tab="siswa" aria-pressed="${st.tab === 'siswa'}">Daftar siswa</button>
          <button role="tab" data-tab="ditolak" aria-pressed="${st.tab === 'ditolak'}">Percobaan ditolak</button>
        </div>
      </div>
      <div id="content"><div class="loading">Memuat…</div></div>
    </div>`);
  const content = $('#content', el);
  const fClass = $('#f-class', el);
  fClass.value = st.cls;
  if (!fClass.value && classes.length === 1) fClass.value = classes[0].id;
  st.cls = fClass.value;

  async function loadSchedules() {
    const r = await get(`/api/admin/schedule-day?date=${st.date}`);
    schedules = r.schedules;
    const sel = $('#f-sched', el);
    if (r.holiday) mount(sel, html`<option value="">Libur: ${r.holiday}</option>`);
    else if (!schedules.length) mount(sel, html`<option value="">Tidak ada jadwal</option>`);
    else mount(sel, html`${schedules.map((s) => html`<option value="${s.id}">${s.title} (${s.start_time}–${s.end_time})</option>`)}`);
    if (!schedules.some((s) => s.id === st.schedule)) st.schedule = schedules.find((s) => s.state === 'open')?.id || schedules[0]?.id || '';
    sel.value = st.schedule;
    sel.disabled = !schedules.length;
  }

  async function loadRows() {
    if (st.tab === 'ditolak') return loadAttempts();
    if (!st.schedule) {
      mount(content, html`<div class="empty">${icon('calendar', 'i-lg')}<b>Tidak ada jadwal presensi pada ${fmtDay(st.date)}</b></div>`);
      return;
    }
    mount(content, html`<div class="loading">Memuat…</div>`);
    const r = await get(`/api/admin/recap?date=${st.date}&schedule_id=${st.schedule}&class_id=${st.cls}`);
    rows = r.rows;
    closed = r.closed;
    selected.clear();
    drawRows();
  }

  const statusOf = (row) => row.record?.status || (closed ? 'alfa' : 'belum');
  const counts = () => rows.reduce((m, r) => { const s = statusOf(r); m[s] = (m[s] || 0) + 1; return m; }, {});

  function drawRows() {
    const c = counts();
    const filters = [['semua', 'Semua', rows.length], ['belum', closed ? 'Tanpa keterangan' : 'Belum presensi', rows.filter((r) => !r.record).length],
      ['hadir', 'Hadir', c.hadir || 0], ['terlambat', 'Terlambat', c.terlambat || 0], ['izin', 'Izin/sakit', (c.izin || 0) + (c.sakit || 0)], ['alfa', 'Alfa', c.alfa || 0]];
    const show = rows.filter((r) => {
      const s = statusOf(r);
      if (st.filter === 'semua') return true;
      if (st.filter === 'belum') return !r.record;
      if (st.filter === 'izin') return s === 'izin' || s === 'sakit';
      return s === st.filter;
    });
    const detail = (rec) => {
      if (!rec) return '';
      if (rec.source === 'manual') return html`<span class="sub">Manual oleh ${rec.by_name || 'petugas'}${rec.note ? `: ${rec.note}` : ''}</span>`;
      const bits = [`${rec.distance_m} m`, `GPS ±${Math.round(rec.accuracy_m)} m`];
      if (rec.face_distance != null) bits.push(`wajah ${(1 - rec.face_distance).toFixed(2)}`);
      if (rec.from_school_ip) bits.push('Wi-Fi sekolah');
      return html`<span class="sub">${bits.join(', ')}</span>`;
    };
    mount(content, html`
      <div class="toolbar"><div class="session-tabs">${filters.map(([k, l, n]) => html`<button data-filter="${k}" aria-pressed="${st.filter === k}">${l}<small>${n}</small></button>`)}</div></div>
      ${show.length === 0 ? html`<div class="empty"><span>Tidak ada siswa pada filter ini.</span></div>` : html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th><input type="checkbox" id="all" aria-label="Pilih semua"></th><th>Siswa</th><th>Kelas</th><th>Status</th><th>Jam</th><th>Keterangan</th><th></th></tr></thead>
        <tbody>${show.map((r) => html`<tr class="${selected.has(r.id) ? 'sel' : ''}">
          <td><input type="checkbox" data-pick="${r.id}" ${selected.has(r.id) ? raw('checked') : ''} aria-label="Pilih ${r.name}"></td>
          <td class="strong">${r.name}<span class="sub num">${r.nis}</span></td>
          <td>${r.class_name}</td>
          <td>${statusChip(statusOf(r), !r.record && closed ? 'Alfa (otomatis)' : undefined)}</td>
          <td class="num">${r.record ? fmtClock(r.record.server_time) : '—'}</td>
          <td>${detail(r.record)}</td>
          <td class="act"><button class="btn btn-sm" data-one="${r.id}">Ubah</button></td>
        </tr>`)}</tbody></table></div>`}
      <div class="bulkbar" id="bulk" hidden><b id="bulk-n"></b>
        <button class="btn btn-sm" data-bulk="hadir">Hadir</button><button class="btn btn-sm" data-bulk="izin">Izin</button>
        <button class="btn btn-sm" data-bulk="sakit">Sakit</button><button class="btn btn-sm" data-bulk="alfa">Alfa</button>
        <button class="btn btn-sm" data-bulk="hapus">Hapus catatan</button></div>`);
    syncBulk();
  }

  function syncBulk() {
    const bar = $('#bulk', el);
    if (!bar) return;
    bar.hidden = selected.size === 0;
    $('#bulk-n', el).textContent = `${selected.size} siswa dipilih`;
  }

  function editStatus(ids, preset) {
    const names = rows.filter((r) => ids.includes(r.id)).map((r) => r.name);
    const dlg = modal({
      title: ids.length === 1 ? `Ubah presensi ${names[0]}` : `Ubah presensi ${ids.length} siswa`,
      subtitle: `${schedules.find((s) => s.id === st.schedule)?.title}, ${fmtDay(st.date)}`,
      body: html`
        <div class="field"><span>Status</span><div class="seg" role="radiogroup">${['hadir', 'terlambat', 'izin', 'sakit', 'alfa', 'hapus'].map((s) => html`
          <label><input type="radio" name="status" value="${s}" ${s === (preset || 'izin') ? raw('checked') : ''}><span>${s === 'hapus' ? 'Hapus catatan' : STATUS_LABEL[s]}</span></label>`)}</div></div>
        <label class="field"><span>Keterangan</span><textarea name="note" maxlength="200" placeholder="Contoh: surat izin orang tua, lomba OSN, HP rusak saat presensi"></textarea>
          <small>Wajib diisi kecuali menghapus catatan. Tersimpan di log audit.</small></label>
        <div class="alert alert-error" hidden></div>`,
      actions: html`<button class="btn" data-close>Batal</button><button class="btn btn-primary" data-save>Simpan</button>`,
    });
    dlg.querySelector('[data-save]').addEventListener('click', (e) => {
      e.preventDefault();
      busy(e.currentTarget, async () => {
        try {
          const status = dlg.querySelector('[name=status]:checked').value;
          await post('/api/admin/attendance/manual', { schedule_id: st.schedule, date: st.date, student_ids: ids, status, note: dlg.querySelector('[name=note]').value });
          dlg.close();
          toast(status === 'hapus' ? 'Catatan dihapus.' : `Status ${ids.length} siswa disimpan.`, 'success');
          loadRows();
        } catch (ex) { const a = dlg.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
      });
    });
  }

  async function loadAttempts() {
    mount(content, html`<div class="loading">Memuat…</div>`);
    const r = await get(`/api/admin/attempts?date=${st.date}`);
    const list = st.cls ? r.attempts.filter((a) => classes.find((c) => c.id === st.cls)?.name === a.class_name) : r.attempts;
    mount(content, list.length === 0 ? html`<div class="empty">${icon('shield', 'i-lg')}<b>Tidak ada percobaan ditolak</b><span>${fmtDay(st.date)}</span></div>` : html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Jam</th><th>Siswa</th><th>Sesi</th><th>Alasan</th><th>Data</th></tr></thead>
        <tbody>${list.map((a) => html`<tr>
          <td class="num">${fmtClock(a.ts, true)}</td>
          <td class="strong">${a.name}<span class="sub">${a.class_name || '—'}</span></td>
          <td>${a.title || '—'}</td>
          <td>${statusChip('ditolak', REASON[a.reason] || a.reason)}<span class="sub">${a.message}</span></td>
          <td class="small muted">${[a.distance_m != null ? `${a.distance_m} m` : '', a.accuracy_m != null ? `±${a.accuracy_m} m` : '', a.face_distance != null ? `wajah ${(1 - a.face_distance).toFixed(2)}` : '', a.ip || ''].filter(Boolean).join(', ')}</td>
        </tr>`)}</tbody></table></div>
      <div class="table-foot">${list.length} percobaan. Pola berulang dari siswa yang sama layak diperiksa langsung.</div>`);
  }

  el.addEventListener('change', async (e) => {
    if (e.target.id === 'f-date') { st.date = e.target.value || today; await loadSchedules(); loadRows(); }
    else if (e.target.id === 'f-sched') { st.schedule = e.target.value; loadRows(); }
    else if (e.target.id === 'f-class') { st.cls = e.target.value; loadRows(); }
    else if (e.target.id === 'all') {
      $$('[data-pick]', el).forEach((c) => { c.checked = e.target.checked; c.closest('tr').classList.toggle('sel', c.checked); if (c.checked) selected.add(c.dataset.pick); else selected.delete(c.dataset.pick); });
      syncBulk();
    } else if (e.target.dataset.pick) {
      if (e.target.checked) selected.add(e.target.dataset.pick); else selected.delete(e.target.dataset.pick);
      e.target.closest('tr').classList.toggle('sel', e.target.checked);
      syncBulk();
    }
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) { st.tab = t.dataset.tab; $$('[data-tab]', el).forEach((b) => b.setAttribute('aria-pressed', String(b === t))); loadRows(); }
    else if (t.dataset.filter) { st.filter = t.dataset.filter; drawRows(); }
    else if (t.dataset.one) editStatus([t.dataset.one]);
    else if (t.dataset.bulk) editStatus([...selected], t.dataset.bulk);
    else if (t.id === 'export') openExport();
  });

  function openExport() {
    const weekAgo = new Date(Date.parse(today) - 6 * 864e5).toISOString().slice(0, 10);
    const dlg = modal({
      title: 'Unduh rekap CSV',
      subtitle: 'Bisa dibuka di Excel atau Google Sheets.',
      body: html`
        <div class="row-2"><label class="field"><span>Dari</span><input type="date" name="from" value="${weekAgo}" max="${today}"></label>
          <label class="field"><span>Sampai</span><input type="date" name="to" value="${today}" max="${today}"></label></div>
        <label class="field"><span>Kelas</span><select name="cls">${classes.length > 1 ? html`<option value="">Semua kelas (maks. 7 hari)</option>` : ''}${classes.map((c) => html`<option value="${c.id}">${c.name} (maks. 62 hari)</option>`)}</select></label>
        <div class="alert alert-error" hidden></div>`,
      actions: html`<button class="btn" data-close>Batal</button><button class="btn btn-primary" data-save>${icon('download', 'i-sm')} Unduh</button>`,
    });
    const q = (n) => dlg.querySelector(`[name=${n}]`);
    if (st.cls) q('cls').value = st.cls;
    dlg.querySelector('[data-save]').addEventListener('click', (e) => {
      e.preventDefault();
      busy(e.currentTarget, async () => {
        try {
          const r = await get(`/api/admin/export?from=${q('from').value}&to=${q('to').value}&class_id=${q('cls').value}`);
          const name = q('cls').value ? classes.find((c) => c.id === q('cls').value).name.replace(/\s+/g, '-') : 'semua-kelas';
          downloadText(`presensi-${name}-${q('from').value}_${q('to').value}.csv`, toCsv([r.header, ...r.rows]));
          dlg.close();
          toast(`${r.rows.length} baris diunduh.`, 'success');
        } catch (ex) { const a = dlg.querySelector('.alert'); a.textContent = ex.message; a.hidden = false; }
      });
    });
  }

  await loadSchedules();
  if (saved.schedule_id) { st.schedule = saved.schedule_id; $('#f-sched', el).value = st.schedule; }
  loadRows();
}
