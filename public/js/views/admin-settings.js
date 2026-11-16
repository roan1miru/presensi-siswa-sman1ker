import { get, post } from '../api.js';
import { $, html, raw, mount, icon, toast, busy, modal, confirmDialog, statusChip, downloadText } from '../ui.js';
import { get as apiGet } from '../api.js';
import { state } from '../app.js';
import { pageHead } from './admin.js';

export default async function pageSettings(el) {
  const { settings: s, my_ip: myIp, export_enabled: exportEnabled } = await get('/api/admin/settings');
  const superadmin = state.me.user.role === 'superadmin';
  const welcome = sessionStorage.getItem('justInstalled') === '1';
  sessionStorage.removeItem('justInstalled');

  mount(el, html`
    ${pageHead('Pengaturan', 'Nilai bawaan untuk jadwal baru dan aturan akun siswa.')}
    ${welcome ? html`<div class="alert alert-ok mb-4"><b>Instalasi selesai.</b> Mulai dengan mengisi titik lokasi sekolah di bawah, lalu impor data siswa dan buat jadwal. Daftar langkahnya ada di halaman Hari ini.</div>` : ''}
    <div class="grid-main">
      <form class="stack" id="f">
        <section class="card card-pad">
          <h2 class="mb-4">Sekolah</h2>
          <label class="field"><span>Nama sekolah</span><input name="school_name" value="${s.school_name}" maxlength="80"></label>
          <div class="row-2">
            <label class="field"><span>Lintang (latitude)</span><input name="lat" inputmode="decimal" value="${s.default_lat ?? ''}" placeholder="-7.556200"></label>
            <label class="field"><span>Bujur (longitude)</span><input name="lng" inputmode="decimal" value="${s.default_lng ?? ''}" placeholder="110.864700"></label>
          </div>
          <div class="btn-row mb-4"><button class="btn btn-sm" type="button" id="here">${icon('pin', 'i-sm')} Isi dengan lokasi saya sekarang</button></div>
          <div class="row-2">
            <label class="field"><span>Radius bawaan (meter)</span><input name="radius" type="number" min="20" max="2000" value="${s.default_radius_m}"></label>
            <label class="field"><span>Batas akurasi GPS bawaan (meter)</span><input name="acc" type="number" min="10" max="200" value="${s.default_max_accuracy_m}"></label>
          </div>
        </section>

        <section class="card card-pad">
          <h2 class="mb-2">Wi-Fi sekolah</h2>
          <p class="small muted mb-4">Jadwal yang mewajibkan Wi-Fi sekolah hanya menerima presensi dari alamat IP di bawah ini. Satu baris satu alamat. Format: IP persis, CIDR seperti 103.10.20.0/24, atau awalan IPv6 diakhiri tanda bintang.</p>
          <label class="field"><span>Daftar IP</span><textarea name="ips" rows="4" spellcheck="false">${s.school_ips.join('\n')}</textarea></label>
          <div class="flex wrap"><span class="small muted">IP perangkat ini: <b class="num">${myIp}</b></span><button class="btn btn-sm" type="button" id="add-ip">${icon('plus', 'i-sm')} Tambahkan</button></div>
          <p class="small muted mt-2">Tekan tombol itu saat terhubung ke Wi-Fi sekolah. Periksa ulang bila penyedia internet sekolah berganti.</p>
        </section>

        <section class="card card-pad">
          <h2 class="mb-4">Akun siswa dan wajah</h2>
          <label class="check"><input type="checkbox" name="force" ${s.force_password_change ? raw('checked') : ''}>
            <div><b>Wajibkan siswa mengganti password NIS saat masuk pertama</b><small>Disarankan aktif. Bila dimatikan, siswa tetap bisa mengganti password dari menu Akun.</small></div></label>
          <label class="field mt-3"><span>Ambang kecocokan wajah: <b class="num" id="thr-v">${s.face_threshold.toFixed(2)}</b></span>
            <input type="range" name="thr" min="0.35" max="0.6" step="0.01" value="${s.face_threshold}">
            <small>Jarak descriptor maksimum. Lebih kecil = lebih ketat (lebih sedikit salah terima, lebih banyak salah tolak). Mulai di 0,50, lalu sesuaikan dari data pilot.</small></label>
        </section>

        <div class="alert alert-error" id="err" hidden></div>
        <div><button class="btn btn-primary btn-lg" type="submit">Simpan pengaturan</button></div>
      </form>
      <div class="stack">
        <section class="card card-pad">
          <h2 class="mb-2">Ekspor otomatis ke Google Sheets</h2>
          <p class="small muted">Opsional. Google Apps Script menarik rekap harian dan backup memakai kunci ekspor. Aplikasi tetap berjalan normal tanpa fitur ini.</p>
          <p class="mt-3">${exportEnabled ? statusChip('hadir', 'Aktif') : statusChip('belum', 'Belum aktif')}</p>
          <div class="btn-row mt-3">
            <button class="btn btn-sm ${exportEnabled ? '' : 'btn-primary'}" type="button" id="ek-new">${exportEnabled ? 'Buat kunci baru' : 'Aktifkan dan buat kunci'}</button>
            ${exportEnabled ? html`<button class="btn btn-sm btn-quiet" type="button" id="ek-off">Matikan</button>` : ''}
          </div>
        </section>
        ${superadmin ? html`
        <section class="card card-pad">
          <h2 class="mb-2">Backup dan pemulihan</h2>
          <p class="small muted">Unduh seluruh data (siswa, jadwal, wajah, presensi) sebagai satu file. Simpan di tempat yang tidak dibagikan karena berisi data biometrik.</p>
          <div class="btn-row mt-3"><button class="btn btn-sm" type="button" id="bk">${icon('download', 'i-sm')} Unduh backup sekarang</button></div>
          <div class="progress mt-3" id="bk-prog" hidden><progress id="bk-bar" max="1" value="0"></progress><span class="small muted nowrap" id="bk-text"></span></div>
          <hr class="sep">
          <p class="small muted">Memulihkan akan <b>mengganti seluruh data saat ini</b> dengan isi file backup. Akun Anda tetap dipakai.</p>
          <label class="btn btn-sm btn-danger mt-3 file-btn">${icon('upload', 'i-sm')} Pulihkan dari file backup<input type="file" id="rs-file" accept=".json,application/json"></label>
          <div id="rs-area"></div>
        </section>` : ''}
        <section class="card card-pad">
          <h2 class="mb-2">Password siswa</h2>
          <p class="small muted">Setelah pemulihan ke instalasi baru, password lama tidak bisa dipakai. Tombol ini mengembalikan password siswa tersebut ke NIS. Akun guru direset satu per satu di menu Akun guru.</p>
          <div class="btn-row mt-3"><button class="btn btn-sm" type="button" id="rst">Reset password siswa ke NIS</button></div>
          <p class="small muted mt-2" id="rst-text"></p>
        </section>
      </div>
    </div>`);

  const f = $('#f', el);
  f.thr.addEventListener('input', () => { $('#thr-v', el).textContent = Number(f.thr.value).toFixed(2); });
  $('#add-ip', el).addEventListener('click', () => {
    const list = f.ips.value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!list.includes(myIp)) list.push(myIp);
    f.ips.value = list.join('\n');
    toast('IP ditambahkan. Jangan lupa simpan.');
  });
  $('#here', el).addEventListener('click', (e) => busy(e.currentTarget, () => new Promise((res) => navigator.geolocation.getCurrentPosition(
    (p) => { f.lat.value = p.coords.latitude.toFixed(6); f.lng.value = p.coords.longitude.toFixed(6); toast(`Lokasi terbaca, akurasi ±${Math.round(p.coords.accuracy)} m.`); res(); },
    () => { toast('Lokasi tidak dapat dibaca. Izinkan lokasi di browser.', 'error'); res(); },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }))));

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#err', el);
    err.hidden = true;
    const lat = f.lat.value.trim() === '' ? null : Number(f.lat.value.replace(',', '.'));
    const lng = f.lng.value.trim() === '' ? null : Number(f.lng.value.replace(',', '.'));
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await post('/api/admin/settings', {
          school_name: f.school_name.value, default_lat: lat, default_lng: lng,
          default_radius_m: Number(f.radius.value), default_max_accuracy_m: Number(f.acc.value),
          school_ips: f.ips.value.split('\n').map((x) => x.trim()).filter(Boolean),
          face_threshold: Number(f.thr.value), force_password_change: f.force.checked,
        });
        state.me.school.name = f.school_name.value;
        toast('Pengaturan disimpan.', 'success');
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    });
  });

  // ── Kunci ekspor ──
  $('#ek-new', el).addEventListener('click', async () => {
    if (exportEnabled && !(await confirmDialog({ title: 'Buat kunci ekspor baru?', message: 'Kunci lama langsung tidak berlaku. Perbarui EXPORT_KEY di Google Apps Script.', confirmText: 'Buat kunci baru' }))) return;
    try {
      const r = await post('/api/admin/export-key', { enable: true });
      modal({
        title: 'Kunci ekspor',
        subtitle: 'Hanya ditampilkan sekali.',
        body: html`<div class="secret small-secret">${r.key}</div>
          <dl class="kv"><dt>BASE_URL</dt><dd class="small">${location.origin}</dd><dt>EXPORT_KEY</dt><dd class="small">kunci di atas</dd></dl>
          <p class="small muted mt-3">Isi keduanya di Script properties Google Apps Script (lihat PANDUAN_DEPLOY.md bagian Google Sheets).</p>`,
      });
      pageSettings(el);
    } catch (ex) { toast(ex.message, 'error'); }
  });
  $('#ek-off', el)?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Matikan ekspor otomatis?', message: 'Google Apps Script tidak bisa menarik data lagi sampai kunci baru dibuat.', confirmText: 'Matikan', danger: true }))) return;
    try { await post('/api/admin/export-key', { enable: false }); toast('Ekspor otomatis dimatikan.'); pageSettings(el); } catch (ex) { toast(ex.message, 'error'); }
  });

  // ── Reset password siswa ke NIS (bertahap 20 siswa) ──
  $('#rst', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    let after = '';
    let total = 0;
    try {
      for (;;) {
        const r = await post('/api/admin/students/reset-all', { after, only_broken: true });
        total += r.count;
        $('#rst-text', el).textContent = `${total} siswa diproses…`;
        if (r.done) break;
        after = r.after;
      }
      $('#rst-text', el).textContent = total ? `${total} siswa sekarang memakai password NIS.` : 'Tidak ada password siswa yang perlu direset.';
    } catch (ex) { toast(ex.message, 'error'); }
  }));

  if (!superadmin) return;

  // ── Backup ──
  $('#bk', el).addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const prog = $('#bk-prog', el);
    prog.hidden = false;
    try {
      const meta = await apiGet('/api/admin/backup');
      const out = { format: meta.format, created_at: new Date().toISOString(), school: state.me.school.name, key_check: meta.key_check, tables: {} };
      let i = 0;
      for (const t of meta.tables) {
        out.tables[t] = [];
        let after = '';
        for (;;) {
          const page = await apiGet(`/api/admin/backup?table=${t}&after=${encodeURIComponent(after)}`);
          out.tables[t].push(...page.rows);
          $('#bk-text', el).textContent = `${t}: ${out.tables[t].length} baris`;
          if (page.done) break;
          after = page.next;
        }
        $('#bk-bar', el).value = ++i / meta.tables.length;
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      downloadText(`backup-presensi-${stamp}.json`, JSON.stringify(out), 'application/json');
      $('#bk-text', el).textContent = 'Backup terunduh.';
    } catch (ex) { toast(ex.message, 'error'); }
  }));

  // ── Pemulihan ──
  $('#rs-file', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('File tidak bisa dibaca sebagai backup.', 'error'); return; }
    if (data.format !== 'presensi-backup-v1' || !data.tables) { toast('File bukan backup aplikasi presensi ini.', 'error'); return; }
    const order = ['app_config', 'holidays', 'classes', 'users', 'schedules', 'face_profiles', 'attendance', 'attempt_logs', 'audit_logs'].filter((t) => Array.isArray(data.tables[t]));
    const counts = order.map((t) => [t, data.tables[t].length]);
    const totalRows = counts.reduce((a, [, n]) => a + n, 0);
    const existing = (await apiGet('/api/admin/restore')).restore;
    const resume = existing && (await confirmDialog({ title: 'Lanjutkan pemulihan sebelumnya?', message: 'Ada pemulihan yang terhenti. Pastikan file yang Anda pilih sama dengan sebelumnya.', confirmText: 'Lanjutkan' }));
    const dlg = modal({
      title: resume ? 'Lanjutkan pemulihan' : 'Pulihkan dari backup',
      subtitle: `${data.school || ''} ${data.created_at ? `, dibuat ${new Date(data.created_at).toLocaleString('id-ID')}` : ''}`,
      body: html`
        <ul class="small">${counts.map(([t, n]) => html`<li>${t}: ${n} baris</li>`)}</ul>
        ${totalRows > 80000 ? html`<div class="alert alert-warn mt-3">File berisi ${totalRows} baris. Paket gratis membatasi 100.000 baris ditulis per hari, jadi pemulihan mungkin harus dilanjutkan besok. Progres tersimpan otomatis.</div>` : ''}
        ${resume ? '' : html`<div class="alert alert-error mt-3">Seluruh data saat ini akan diganti. Tindakan ini tidak bisa dibatalkan dari aplikasi.</div>
        <label class="field mt-3"><span>Ketik PULIHKAN untuk melanjutkan</span><input name="confirm" autocomplete="off"></label>`}
        <div class="progress mt-3" hidden><progress max="${totalRows}" value="0"></progress><span class="small muted nowrap"></span></div>
        <div class="alert alert-error mt-3" data-err hidden></div>`,
      actions: html`<button class="btn" data-close>Batal</button><button class="btn btn-danger-solid" data-save>${resume ? 'Lanjutkan' : 'Pulihkan'}</button>`,
    });
    dlg.querySelector('[data-save]').addEventListener('click', (ev) => {
      ev.preventDefault();
      const errBox = dlg.querySelector('[data-err]');
      busy(ev.currentTarget, async () => {
        try {
          const selfOld = (data.tables.users || []).find((u) => u.username === state.me.user.username)?.id || null;
          let done = {};
          if (resume) done = existing.progress.done || {};
          else await post('/api/admin/restore/begin', { format: data.format, key_check: data.key_check, confirm: dlg.querySelector('[name=confirm]').value, self_old_id: selfOld });
          const bar = dlg.querySelector('.progress');
          bar.hidden = false;
          let written = Object.values(done).reduce((a, n) => a + n, 0);
          const send = async (table, rows) => {
            for (let i = done[table] || 0; i < rows.length; i += 200) {
              await post('/api/admin/restore/chunk', { table, rows: rows.slice(i, i + 200) });
              written += Math.min(200, rows.length - i);
              bar.querySelector('progress').value = written;
              bar.querySelector('span').textContent = `${table}: ${Math.min(i + 200, rows.length)} / ${rows.length}`;
            }
          };
          for (const t of order) await send(t, data.tables[t]);
          await send('classes_homeroom', (data.tables.classes || []).filter((c) => c.homeroom_user_id).map((c) => ({ id: c.id, homeroom_user_id: c.homeroom_user_id })));
          const fin = await post('/api/admin/restore/finish');
          dlg.close();
          if (!fin.same_key) {
            toast('Data dipulihkan. Kunci sistem berbeda: password siswa sedang dikembalikan ke NIS…');
            $('#rst', el).click();
          } else toast('Data berhasil dipulihkan.', 'success');
        } catch (ex) {
          errBox.textContent = `${ex.message} Progres tersimpan; pilih file yang sama lagi untuk melanjutkan.`;
          errBox.hidden = false;
        }
      });
    });
  });
}
