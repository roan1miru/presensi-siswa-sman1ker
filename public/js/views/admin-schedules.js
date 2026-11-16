import { get, post } from '../api.js';
import { $, $$, html, raw, mount, icon, toast, modal, busy, confirmDialog, fmtDay, todayWib, DAY_NAMES, DAY_SHORT } from '../ui.js';
import { pageHead } from './admin.js';

const KIND = { masuk: 'Masuk', pulang: 'Pulang', kegiatan: 'Kegiatan' };

function daysText(s) {
  if (s.start_date === s.end_date) return fmtDay(s.start_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const d = s.days;
  let pattern = 'Setiap hari';
  if (d.length && d.length < 7) {
    const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    pattern = run && d.length > 2 ? `${DAY_NAMES[d[0] - 1]}–${DAY_NAMES[d.at(-1) - 1]}` : d.map((x) => DAY_NAMES[x - 1]).join(', ');
  }
  return `${pattern}, ${fmtDay(s.start_date, { day: 'numeric', month: 'short', year: 'numeric' })} sampai ${fmtDay(s.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export default async function pageSchedules(el) {
  let [{ schedules }, { classes }, { settings }, { holidays }] = await Promise.all([
    get('/api/admin/schedules'), get('/api/admin/classes'), get('/api/admin/settings'), get('/api/admin/holidays'),
  ]);
  const className = Object.fromEntries(classes.map((c) => [c.id, c.name]));
  const today = todayWib();

  const draw = () => {
    const active = schedules.filter((s) => s.active && s.end_date >= today);
    const past = schedules.filter((s) => !(s.active && s.end_date >= today));
    const item = (s) => html`<div class="sched ${s.active ? '' : 'off'}">
      <div class="sched-time"><b>${s.start_time}</b><span>sampai ${s.end_time}</span></div>
      <div>
        <h3>${s.title} <span class="tag">${KIND[s.kind]}</span>${!s.active ? html`<span class="tag">Nonaktif</span>` : ''}</h3>
        <p>${daysText(s)}</p>
        <p>${s.class_ids.length ? s.class_ids.map((id) => className[id] || '?').join(', ') : 'Semua kelas'}${s.late_after ? `. Terlambat setelah ${s.late_after}.` : '.'}</p>
        <div class="tags">
          <span class="tag">Radius ${s.radius_m} m</span><span class="tag">GPS maks. ±${s.max_accuracy_m} m</span>
          ${s.require_face ? html`<span class="tag">Wajah</span>` : ''}${s.require_face && s.require_liveness ? html`<span class="tag">Gerakan acak</span>` : ''}
          ${s.require_school_ip ? html`<span class="tag">Wi-Fi sekolah</span>` : ''}
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-sm" data-edit="${s.id}">${icon('edit', 'i-sm')} Ubah</button>
        <button class="btn btn-sm btn-quiet" data-del="${s.id}" aria-label="Hapus ${s.title}">${icon('trash', 'i-sm')}</button></div>
    </div>`;
    mount(el, html`
      ${pageHead('Jadwal presensi', 'Satu jadwal rutin cukup untuk setiap hari sekolah. Hari libur otomatis dilewati.',
        html`<button class="btn btn-primary" id="add">${icon('plus', 'i-sm')} Buat jadwal</button>`)}
      ${settings.default_lat == null ? html`<div class="alert alert-warn">Titik lokasi sekolah belum diatur. <a href="#/admin/pengaturan">Atur di Pengaturan</a> atau pilih langsung di peta saat membuat jadwal.</div>` : ''}
      <div class="card">
        <div class="card-head"><h2>Berlaku</h2><p>${active.length} jadwal</p></div>
        ${active.length ? active.map(item) : html`<div class="empty">${icon('calendar', 'i-lg')}<b>Belum ada jadwal berlaku</b><span>Contoh: Masuk 06.00–07.30 (terlambat setelah 07.00) dan Pulang 14.00–16.00, Senin–Jumat.</span></div>`}
      </div>
      ${past.length ? html`<details class="card mt-4"><summary class="card-head"><h2>Selesai atau nonaktif</h2><p>${past.length} jadwal</p></summary>${past.map(item)}</details>` : ''}
      <div class="card mt-4">
        <div class="card-head"><h2>Hari libur</h2><p>Jadwal rutin tidak berlaku pada tanggal ini.</p></div>
        <form class="toolbar" id="hol-form"><input type="date" name="date" min="${today.slice(0, 4)}-01-01" required aria-label="Tanggal libur">
          <input name="name" maxlength="80" placeholder="Keterangan, misalnya Maulid Nabi" required aria-label="Keterangan">
          <button class="btn" type="submit">${icon('plus', 'i-sm')} Tambah</button></form>
        ${holidays.length ? html`<ul class="list">${holidays.map((h) => html`<li><div class="grow"><b>${h.name}</b><small>${fmtDay(h.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</small></div>
          <button class="btn btn-sm btn-quiet" data-hdel="${h.date}" aria-label="Hapus libur ${h.name}">${icon('trash', 'i-sm')}</button></li>`)}</ul>` : html`<div class="empty"><span>Belum ada hari libur tahun ini.</span></div>`}
      </div>`);
  };

  const reload = async () => {
    [{ schedules }, { holidays }] = await Promise.all([get('/api/admin/schedules'), get('/api/admin/holidays')]);
    draw();
  };

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'add') openForm();
    else if (b.dataset.edit) openForm(schedules.find((s) => s.id === b.dataset.edit));
    else if (b.dataset.del) {
      const s = schedules.find((x) => x.id === b.dataset.del);
      if (!(await confirmDialog({ title: `Hapus jadwal ${s.title}?`, message: s.records ? 'Jadwal ini sudah punya data presensi, jadi akan dinonaktifkan agar rekap tetap utuh.' : 'Jadwal belum punya data presensi dan akan dihapus.', confirmText: s.records ? 'Nonaktifkan' : 'Hapus', danger: true }))) return;
      try { const r = await post(`/api/admin/schedules/${s.id}/delete`); toast(r.deactivated ? 'Jadwal dinonaktifkan.' : 'Jadwal dihapus.', 'success'); reload(); } catch (ex) { toast(ex.message, 'error'); }
    } else if (b.dataset.hdel) {
      try { await post('/api/admin/holidays/delete', { date: b.dataset.hdel }); reload(); } catch (ex) { toast(ex.message, 'error'); }
    }
  });
  el.addEventListener('submit', async (e) => {
    if (e.target.id !== 'hol-form') return;
    e.preventDefault();
    const f = e.target;
    try { await post('/api/admin/holidays', { date: f.date.value, name: f.name.value }); toast('Hari libur ditambahkan.', 'success'); reload(); } catch (ex) { toast(ex.message, 'error'); }
  });

  function openForm(s = null) {
    const end = new Date(Date.parse(today) + 180 * 864e5).toISOString().slice(0, 10);
    const v = s || {
      title: '', kind: 'masuk', start_date: today, end_date: end, days: [1, 2, 3, 4, 5], start_time: '06:00', late_after: '07:00', end_time: '07:30',
      lat: settings.default_lat, lng: settings.default_lng, radius_m: settings.default_radius_m, max_accuracy_m: settings.default_max_accuracy_m,
      class_ids: [], require_face: true, require_liveness: true, require_school_ip: false, active: true,
    };
    const once = s ? s.start_date === s.end_date : false;
    const dlg = modal({
      wide: true,
      title: s ? `Ubah jadwal ${s.title}` : 'Buat jadwal presensi',
      body: html`
        <div class="row-2">
          <label class="field"><span>Nama jadwal</span><input name="title" value="${v.title}" maxlength="60" placeholder="Masuk pagi"></label>
          <div class="field"><span>Jenis</span><div class="seg">${Object.entries(KIND).map(([k, l]) => html`<label><input type="radio" name="kind" value="${k}" ${v.kind === k ? raw('checked') : ''}><span>${l}</span></label>`)}</div></div>
        </div>
        <div class="field"><span>Pola</span><div class="seg">
          <label><input type="radio" name="mode" value="rutin" ${once ? '' : raw('checked')}><span>Rutin mingguan</span></label>
          <label><input type="radio" name="mode" value="sekali" ${once ? raw('checked') : ''}><span>Sekali (satu tanggal)</span></label></div></div>
        <div id="m-rutin">
          <div class="field"><span>Hari</span><div class="seg">${DAY_SHORT.map((d, i) => html`<label><input type="checkbox" name="day" value="${i + 1}" ${!v.days.length || v.days.includes(i + 1) ? raw('checked') : ''}><span>${d}</span></label>`)}</div></div>
          <div class="row-2"><label class="field"><span>Berlaku mulai</span><input type="date" name="start_date" value="${v.start_date}"></label>
            <label class="field"><span>Sampai</span><input type="date" name="end_date" value="${v.end_date}"></label></div>
        </div>
        <label class="field" id="m-sekali"><span>Tanggal</span><input type="date" name="one_date" value="${v.start_date}"></label>
        <div class="row-3">
          <label class="field"><span>Dibuka</span><input type="time" name="start_time" value="${v.start_time}"></label>
          <label class="field"><span>Terlambat setelah</span><input type="time" name="late_after" value="${v.late_after || ''}"><small>Kosongkan bila tidak ada.</small></label>
          <label class="field"><span>Ditutup</span><input type="time" name="end_time" value="${v.end_time}"></label>
        </div>
        <div class="field"><span>Kelas peserta</span>
          <label class="check"><input type="checkbox" name="all_classes" ${v.class_ids.length ? '' : raw('checked')}><div><b>Semua kelas</b></div></label>
          <div class="seg" id="cls-pick">${classes.map((c) => html`<label><input type="checkbox" name="cls" value="${c.id}" ${v.class_ids.includes(c.id) ? raw('checked') : ''}><span>${c.name}</span></label>`)}</div></div>
        <div class="field"><span>Titik lokasi dan radius</span>
          <div class="map" id="map"></div>
          <div class="map-tools">
            <button class="btn btn-sm" type="button" id="use-me">${icon('pin', 'i-sm')} Pakai lokasi saya</button>
            ${settings.default_lat != null ? html`<button class="btn btn-sm" type="button" id="use-school">Pakai titik sekolah</button>` : ''}
            <span class="small muted num" id="coord"></span>
          </div>
          <small>Geser penanda ke titik tengah sekolah. Lingkaran biru adalah area presensi.</small></div>
        <div class="row-2">
          <label class="field"><span>Radius: <b id="rad-v" class="num">${v.radius_m}</b> m</span><input type="range" name="radius_m" min="20" max="500" step="5" value="${v.radius_m}"></label>
          <label class="field"><span>Batas akurasi GPS (meter)</span><input type="number" name="max_accuracy_m" min="10" max="200" value="${v.max_accuracy_m}"><small>Uji dulu di beberapa titik sekolah. Awal yang wajar 30–50 m.</small></label>
        </div>
        <div class="field"><span>Pemeriksaan</span>
          <label class="check"><input type="checkbox" name="require_face" ${v.require_face ? raw('checked') : ''}><div><b>Verifikasi wajah</b><small>Wajah dicocokkan dengan data pendaftaran.</small></div></label>
          <label class="check"><input type="checkbox" name="require_liveness" ${v.require_liveness ? raw('checked') : ''}><div><b>Gerakan acak</b><small>Siswa diminta berkedip atau menoleh, untuk menghalangi foto diam.</small></div></label>
          <label class="check"><input type="checkbox" name="require_school_ip" ${v.require_school_ip ? raw('checked') : ''}><div><b>Wajib Wi-Fi sekolah</b><small>Hanya diterima dari IP yang terdaftar di Pengaturan. Bukti hadir paling kuat.</small></div></label>
          <label class="check"><input type="checkbox" name="active" ${v.active ? raw('checked') : ''}><div><b>Aktif</b></div></label>
        </div>
        <div class="alert alert-error" hidden></div>`,
      actions: html`<button class="btn" data-close>Batal</button><button class="btn btn-primary" data-save>Simpan jadwal</button>`,
    });
    const q = (n) => dlg.querySelector(`[name=${n}]`);
    const syncMode = () => { const once2 = dlg.querySelector('[name=mode]:checked').value === 'sekali'; $('#m-rutin', dlg).hidden = once2; $('#m-sekali', dlg).hidden = !once2; };
    const syncCls = () => { $('#cls-pick', dlg).hidden = q('all_classes').checked; };
    const syncFace = () => { q('require_liveness').disabled = !q('require_face').checked; };
    dlg.addEventListener('change', () => { syncMode(); syncCls(); syncFace(); });
    syncMode(); syncCls(); syncFace();

    // Peta
    let point = v.lat != null ? { lat: v.lat, lng: v.lng } : null;
    let L = null, map = null, mk = null, circ = null;
    const setCoord = () => { $('#coord', dlg).textContent = point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : 'Titik belum dipilih'; };
    const place = (p, zoom) => {
      point = p;
      setCoord();
      if (!map) return;
      if (!mk) {
        mk = L.marker([p.lat, p.lng], { draggable: true, icon: L.divIcon({ className: 'pin-icon', iconSize: [18, 18] }) }).addTo(map);
        mk.on('drag', (ev) => { const ll = ev.target.getLatLng(); point = { lat: ll.lat, lng: ll.lng }; circ.setLatLng(ll); setCoord(); });
        circ = L.circle([p.lat, p.lng], { radius: Number(q('radius_m').value), color: '#2446c7', weight: 1.5, fillOpacity: 0.12 }).addTo(map);
      }
      mk.setLatLng([p.lat, p.lng]);
      circ.setLatLng([p.lat, p.lng]);
      map.setView([p.lat, p.lng], zoom || Math.max(map.getZoom(), 17));
    };
    setCoord();
    (async () => {
      if (!document.querySelector('link[data-leaflet]')) {
        document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/vendor/leaflet/leaflet.css' }));
        document.querySelector('link[href="/vendor/leaflet/leaflet.css"]').dataset.leaflet = '1';
      }
      L = await import('/vendor/leaflet/leaflet-src.esm.js');
      map = L.map($('#map', dlg), { zoomControl: true, attributionControl: true }).setView(point ? [point.lat, point.lng] : [-2.5, 118], point ? 17 : 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      map.on('click', (ev) => place({ lat: ev.latlng.lat, lng: ev.latlng.lng }));
      if (point) place(point, 17);
      setTimeout(() => map.invalidateSize(), 200);
    })().catch(() => { $('#map', dlg).textContent = 'Peta tidak dapat dimuat. Gunakan tombol "Pakai lokasi saya" atau isi titik di Pengaturan.'; });

    q('radius_m').addEventListener('input', () => { $('#rad-v', dlg).textContent = q('radius_m').value; circ?.setRadius(Number(q('radius_m').value)); });
    $('#use-school', dlg)?.addEventListener('click', () => place({ lat: settings.default_lat, lng: settings.default_lng }, 17));
    $('#use-me', dlg).addEventListener('click', (e) => {
      const btn = e.currentTarget;
      busy(btn, () => new Promise((res) => navigator.geolocation.getCurrentPosition(
        (p) => { place({ lat: p.coords.latitude, lng: p.coords.longitude }, 18); toast(`Lokasi terbaca, akurasi ±${Math.round(p.coords.accuracy)} m.`); res(); },
        () => { toast('Lokasi tidak dapat dibaca. Izinkan lokasi di browser.', 'error'); res(); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })));
    });

    dlg.querySelector('[data-save]').addEventListener('click', (e) => {
      e.preventDefault();
      const err = dlg.querySelector('.alert');
      const onceMode = dlg.querySelector('[name=mode]:checked').value === 'sekali';
      const body = {
        id: s?.id,
        title: q('title').value,
        kind: dlg.querySelector('[name=kind]:checked').value,
        start_date: onceMode ? q('one_date').value : q('start_date').value,
        end_date: onceMode ? q('one_date').value : q('end_date').value,
        days: onceMode ? [] : $$('[name=day]:checked', dlg).map((c) => Number(c.value)),
        start_time: q('start_time').value, late_after: q('late_after').value || null, end_time: q('end_time').value,
        lat: point?.lat ?? null, lng: point?.lng ?? null,
        radius_m: Number(q('radius_m').value), max_accuracy_m: Number(q('max_accuracy_m').value),
        class_ids: q('all_classes').checked ? [] : $$('[name=cls]:checked', dlg).map((c) => c.value),
        require_face: q('require_face').checked, require_liveness: q('require_face').checked && q('require_liveness').checked,
        require_school_ip: q('require_school_ip').checked, active: q('active').checked,
      };
      if (!onceMode && body.days.length === 0) { err.textContent = 'Pilih minimal satu hari.'; err.hidden = false; return; }
      if (!q('all_classes').checked && !body.class_ids.length) { err.textContent = 'Pilih kelas peserta atau centang Semua kelas.'; err.hidden = false; return; }
      if (body.lat == null) { err.textContent = 'Pilih titik lokasi di peta.'; err.hidden = false; return; }
      busy(e.currentTarget, async () => {
        try {
          await post('/api/admin/schedules', body);
          dlg.close();
          toast('Jadwal disimpan.', 'success');
          reload();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
      });
    });
  }

  draw();
}
