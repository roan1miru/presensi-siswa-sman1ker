import { get } from '../api.js';
import { html, mount, icon, fmtDay, fmtClock, statusChip, todayWib, relTime } from '../ui.js';
import { pageHead, spread, applyWidths, isAdmin } from './admin.js';

const STATE_LABEL = { upcoming: 'Belum dibuka', open: 'Sedang dibuka', closed: 'Sudah ditutup' };

export default function pageToday(el) {
  let data = null;
  let selected = null;
  let timer = null;

  const draw = () => {
    const date = data.date;
    const head = pageHead('Hari ini', `${fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Diperbarui ${relTime(data.server_time)}.`,
      html`<a class="btn" href="#/admin/rekap">${icon('clipboard', 'i-sm')} Buka rekap</a>`);
    if (data.holiday) {
      mount(el, html`${head}<div class="card"><div class="empty">${icon('calendar', 'i-lg')}<b>Hari libur: ${data.holiday}</b><span>Tidak ada presensi hari ini.</span></div></div>`);
      return;
    }
    if (!data.sessions.length) {
      mount(el, html`${head}<div class="card"><div class="empty">${icon('calendar', 'i-lg')}<b>Belum ada jadwal presensi hari ini</b>
        <span>${isAdmin() ? 'Buat jadwal masuk dan pulang agar siswa bisa presensi.' : 'Admin sekolah belum membuat jadwal untuk hari ini.'}</span>
        ${isAdmin() ? html`<a class="btn btn-primary" href="#/admin/jadwal">${icon('plus', 'i-sm')} Buat jadwal</a>` : ''}</div></div>
        ${isAdmin() ? setupChecklist() : ''}`);
      return;
    }
    if (!selected || !data.sessions.some((s) => s.id === selected)) {
      const by = (st) => data.sessions.find((x) => x.state === st && x.kind === 'masuk') || data.sessions.find((x) => x.state === st);
      selected = (by('open') || by('upcoming') || data.sessions.at(-1)).id;
    }
    const s = data.sessions.find((x) => x.id === selected);
    const t = s.totals;
    const pct = (n) => (t.total ? Math.round((n / t.total) * 100) : 0);

    mount(el, html`
      ${head}
      <div class="session-tabs mb-4" role="group" aria-label="Pilih sesi">${data.sessions.map((x) => html`
        <button aria-pressed="${x.id === selected}" data-sel="${x.id}">${x.title}<small>${x.start_time}–${x.end_time}</small></button>`)}</div>
      <div class="grid-main">
        <div class="stack">
          <div class="card card-pad">
            <div class="flex between wrap mb-4"><div><b>${s.title}</b> <span class="muted small">${STATE_LABEL[s.state]}${s.late_after ? `, terlambat setelah ${s.late_after}` : ''}</span></div>
              <span class="muted small num">${t.total - t.belum} dari ${t.total} siswa tercatat</span></div>
            ${spread(t, 'spread-lg')}
          </div>
          <div class="figures">
            <div><b class="num">${t.hadir}</b><span class="f-hadir">Hadir ${pct(t.hadir)}%</span></div>
            <div><b class="num">${t.terlambat}</b><span class="f-telat">Terlambat</span></div>
            <div><b class="num">${t.izin + t.sakit}</b><span class="f-izin">Izin & sakit</span></div>
            <div><b class="num">${t.alfa}</b><span class="f-alfa">Alfa</span></div>
            <div><b class="num">${t.belum}</b><span>${s.state === 'closed' ? 'Tanpa keterangan' : 'Belum presensi'}</span></div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Per kelas</h2><p>Klik kelas untuk membuka rekap dan mengisi presensi manual.</p></div>
            <div class="table-wrap"><table class="table">
              <thead><tr><th>Kelas</th><th>Sebaran</th><th class="r">Hadir</th><th class="r">Terlambat</th><th class="r">Izin/sakit</th><th class="r">Alfa</th><th class="r">${s.state === 'closed' ? 'Tanpa ket.' : 'Belum'}</th></tr></thead>
              <tbody>${s.classes.map((c) => html`<tr>
                <td class="strong"><a href="#/admin/rekap" data-rekap="${c.class_id}">${c.class_name}</a><span class="sub">${c.total} siswa</span></td>
                <td>${spread(c)}</td>
                <td class="r">${c.hadir}</td><td class="r">${c.terlambat}</td><td class="r">${c.izin + c.sakit}</td><td class="r">${c.alfa}</td>
                <td class="r ${c.belum ? 'strong' : 'muted'}">${c.belum}</td></tr>`)}</tbody>
            </table></div>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Presensi terbaru</h2></div>
            ${data.recent.length ? html`<ul class="feed">${data.recent.map((r) => html`<li>
              <time>${fmtClock(r.server_time)}</time><div><b>${r.name}</b><small>${r.class_name}, ${r.title}</small></div>${statusChip(r.status)}</li>`)}</ul>`
              : html`<div class="empty"><span>Belum ada siswa yang presensi.</span></div>`}
          </div>
          <a class="card card-pad flex list-link" href="#/admin/rekap" data-attempts="1">
            <span class="grow"><b>${data.attempts} percobaan ditolak</b><span class="small muted">Di luar area, wajah tidak cocok, GPS lemah, dan lainnya.</span></span>${icon('chevron')}
          </a>
        </div>
      </div>`);
    applyWidths(el);
  };

  const setupChecklist = () => html`<div class="card mt-4"><div class="card-head"><h2>Langkah persiapan</h2></div><ol class="checklist">
    <li><a href="#/admin/pengaturan">Tentukan titik lokasi sekolah dan daftar IP Wi-Fi</a></li>
    <li><a href="#/admin/impor">Impor data siswa dari Excel/CSV</a></li>
    <li><a href="#/admin/akun">Buat akun wali kelas dan tetapkan kelasnya</a></li>
    <li><a href="#/admin/wajah">Daftarkan wajah siswa bersama wali kelas</a></li>
    <li><a href="#/admin/jadwal">Buat jadwal masuk dan pulang</a></li></ol></div>`;

  const load = async () => {
    try {
      data = await get(`/api/admin/overview?date=${todayWib()}`);
      draw();
    } catch (e) {
      mount(el, html`${pageHead('Hari ini', '')}<div class="card"><div class="empty">${icon('alert', 'i-lg')}<b>Data belum bisa dimuat</b><span>${e.message}</span></div></div>`);
    }
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sel]');
    if (b) { selected = b.dataset.sel; draw(); return; }
    const r = e.target.closest('[data-rekap]');
    if (r) sessionStorage.setItem('rekap', JSON.stringify({ class_id: r.dataset.rekap, schedule_id: selected, date: data.date }));
    if (e.target.closest('[data-attempts]')) sessionStorage.setItem('rekap', JSON.stringify({ tab: 'ditolak', date: data.date }));
  });

  load();
  // Pantau langsung: perbarui tiap 30 detik saat tab terlihat (hemat kuota saat tidak dilihat).
  timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
  const onVis = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
}

