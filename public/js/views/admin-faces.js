import { get, post } from '../api.js';
import { $, html, raw, mount, icon, toast, modal, confirmDialog, statusChip, relTime, downloadText } from '../ui.js';
import { toCsv } from '../csv.js';
import { pageHead } from './admin.js';

const SAMPLES = 5;

export default async function pageFaces(el) {
  const { classes } = await get('/api/admin/classes');
  if (!classes.length) {
    mount(el, html`${pageHead('Data wajah', '')}<div class="card"><div class="empty">${icon('face', 'i-lg')}<b>Belum ada kelas yang bisa dikelola</b></div></div>`);
    return;
  }
  let classId = sessionStorage.getItem('wajahClass') || classes[0].id;
  sessionStorage.removeItem('wajahClass');
  if (!classes.some((c) => c.id === classId)) classId = classes[0].id;
  let rows = [];

  mount(el, html`
    ${pageHead('Data wajah', 'Daftarkan wajah setiap siswa di depan wali kelas atau operator. Yang disimpan hanya 128 angka per siswa, bukan foto.')}
    <div class="card">
      <div class="toolbar mt-4">
        <select id="f-class" aria-label="Kelas">${classes.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
        <span class="muted small" id="count"></span><span class="spacer"></span>
        <button class="btn" id="photos">${icon('upload', 'i-sm')} Impor dari foto</button>
        <button class="btn btn-primary" id="batch">${icon('camera', 'i-sm')} Daftarkan dengan kamera</button>
      </div>
      <div id="list"><div class="loading">Memuat…</div></div>
    </div>
    <div class="card card-pad mt-4">
      <h2 class="mb-2">Agar hasilnya akurat</h2>
      <ul class="small muted">
        <li><b>Dari foto kartu pelajar:</b> cepat untuk satu sekolah. Foto hanya dibaca di browser ini dan tidak dikirim. Hasilnya bergantung pada kualitas dan umur foto. Siswa yang sering ditolak saat presensi sebaiknya didaftarkan ulang dengan kamera.</li>
        <li>Lakukan di ruangan terang, cahaya dari depan wajah siswa, bukan dari belakang.</li>
        <li>Siswa melepas masker, topi, dan kacamata hitam. Jilbab tidak perlu dilepas.</li>
        <li>Pastikan nama di layar sama dengan siswa yang duduk di depan kamera. Kesalahan di sini membuat presensi siswa itu terus gagal.</li>
      </ul>
    </div>`);
  const sel = $('#f-class', el);
  sel.value = classId;

  const draw = () => {
    const done = rows.filter((s) => s.face_enrolled_at).length;
    $('#count', el).textContent = `${done} dari ${rows.length} siswa terdaftar`;
    $('#batch', el).disabled = done === rows.length;
    mount($('#list', el), rows.length === 0 ? html`<div class="empty"><span>Belum ada siswa di kelas ini.</span></div>` : html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Siswa</th><th>Status wajah</th><th></th></tr></thead>
        <tbody>${rows.map((s) => html`<tr>
          <td class="strong">${s.name}<span class="sub num">NIS ${s.nis}</span></td>
          <td>${s.face_enrolled_at ? html`${statusChip('hadir', s.face_source === 'photo' ? 'Dari foto' : 'Dari kamera')} <span class="small muted">${relTime(s.face_enrolled_at)}</span>` : statusChip('belum', 'Belum')}</td>
          <td class="act"><button class="btn btn-sm" data-enroll="${s.id}">${s.face_enrolled_at ? 'Daftar ulang' : 'Daftarkan'}</button>
            ${s.face_enrolled_at ? html`<button class="btn btn-sm btn-quiet" data-del="${s.id}" aria-label="Hapus data wajah ${s.name}">${icon('trash', 'i-sm')}</button>` : ''}</td>
        </tr>`)}</tbody></table></div>`);
  };
  const load = async () => {
    const r = await get(`/api/admin/students?class_id=${sel.value}`);
    rows = r.students.filter((s) => s.active);
    draw();
  };
  sel.addEventListener('change', load);

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'photos') {
      photoImport(load);
    } else if (b.id === 'batch') {
      const queue = rows.filter((s) => !s.face_enrolled_at);
      if (queue.length) enrollQueue(queue, load);
    } else if (b.dataset.enroll) {
      enrollQueue([rows.find((s) => s.id === b.dataset.enroll)], load);
    } else if (b.dataset.del) {
      const s = rows.find((x) => x.id === b.dataset.del);
      if (!(await confirmDialog({ title: `Hapus data wajah ${s.name}?`, message: 'Siswa tidak bisa presensi berwajah sampai didaftarkan ulang.', confirmText: 'Hapus', danger: true }))) return;
      try { await post(`/api/admin/face/${s.id}/delete`); toast('Data wajah dihapus.', 'success'); load(); } catch (ex) { toast(ex.message, 'error'); }
    }
  });
  await load();
}

/** Mendaftarkan beberapa siswa berurutan dengan satu kamera yang tetap menyala. */
async function enrollQueue(queue, onChange) {
  const face = await import('../face.js');
  let idx = 0;
  let facing = 'user';
  let video = null;
  let alive = true;
  let changed = false;

  const dlg = modal({
    wide: true,
    title: 'Pendaftaran wajah',
    body: html`
      <div class="row-2">
        <div>
          <div class="cam" id="cam"><video id="v" playsinline muted></video>${raw(face.ovalOverlay)}
            <div class="cam-loading" id="load"><span>Menyiapkan pengenal wajah</span><progress id="lp" max="1" value="0"></progress></div>
            <div class="cam-hint" id="hint"></div></div>
        </div>
        <div>
          <p class="small muted" id="pos"></p>
          <h3 class="mt-1" id="who"></h3>
          <p class="small muted" id="nis"></p>
          <div class="alert alert-info mt-3">Pastikan siswa di depan kamera adalah orang ini.</div>
          <div class="prompt mt-3"><h3 id="pt">Menyiapkan kamera</h3><p id="pd"></p></div>
          <div class="enroll-shots" id="shots">${Array.from({ length: SAMPLES }, () => html`<span></span>`)}</div>
          <div class="alert alert-error mt-3" id="err" hidden></div>
          <div class="btn-row mt-4"><button class="btn btn-sm" type="button" id="flip">${icon('camera', 'i-sm')} Ganti kamera</button>
            <button class="btn btn-sm" type="button" id="skip">Lewati siswa ini</button></div>
        </div>
      </div>`,
    actions: html`<button class="btn" data-close>Selesai</button>`,
  });
  dlg.addEventListener('close', () => { alive = false; if (video) face.stopCamera(video); if (changed) onChange(); });
  const q = (id) => dlg.querySelector(id);
  const setPrompt = (t, d = '') => { q('#pt').textContent = t; q('#pd').textContent = d; };
  video = q('#v');

  try {
    await face.loadFaceEngine((p) => { q('#lp').value = p; });
    await face.startCamera(video, facing);
    q('#load').hidden = true;
  } catch (ex) {
    setPrompt('Kamera belum siap', ex.message);
    return;
  }

  q('#flip').addEventListener('click', async () => {
    facing = facing === 'user' ? 'environment' : 'user';
    face.stopCamera(video);
    video = q('#v');
    try { await face.startCamera(video, facing); q('#cam').classList.toggle('rear', facing === 'environment'); } catch (ex) { toast(ex.message, 'error'); }
  });
  let skip = false;
  q('#skip').addEventListener('click', () => { skip = true; });

  while (alive && idx < queue.length) {
    const s = queue[idx];
    q('#pos').textContent = queue.length > 1 ? `Siswa ${idx + 1} dari ${queue.length}` : '';
    q('#who').textContent = s.name;
    q('#nis').textContent = `NIS ${s.nis}`;
    q('#err').hidden = true;
    const samples = [];
    const dots = [...q('#shots').children];
    dots.forEach((d) => d.classList.remove('ok'));
    let last = 0;
    skip = false;
    setPrompt('Hadapkan wajah lurus ke kamera', 'Sampel diambil otomatis.');

    while (alive && !skip && samples.length < SAMPLES) {
      let r;
      try { r = await face.analyze(video, { withDescriptor: true }); } catch { await new Promise((res) => setTimeout(res, 300)); continue; }
      if (!alive) return;
      q('#hint').textContent = r.hint || '';
      q('#cam').classList.toggle('ready', !!r.ok);
      if (r.ok && r.descriptor && face.frontal(r.metrics) && Date.now() - last > 450) {
        samples.push(r.descriptor);
        dots[samples.length - 1].classList.add('ok');
        last = Date.now();
        setPrompt('Bagus, tahan sebentar', samples.length === 3 ? 'Boleh sedikit mengangguk agar sampel bervariasi.' : '');
      }
      await new Promise((res) => setTimeout(res, 120));
    }
    if (!alive) return;
    if (skip) { idx++; continue; }

    setPrompt('Menyimpan…');
    try {
      const res = await post('/api/admin/face/enroll', { student_id: s.id, model_id: face.MODEL_ID, samples });
      changed = true;
      s.face_enrolled_at = res.enrolled_at;
      toast(`Wajah ${s.name} tersimpan.`, 'success');
      idx++;
    } catch (ex) {
      q('#err').textContent = ex.message;
      q('#err').hidden = false;
      setPrompt('Ulangi pengambilan', 'Sampel diambil ulang otomatis.');
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  if (alive) {
    face.stopCamera(video);
    video = null;
    mount(q('.modal-body'), html`<div class="result"><div class="result-mark ok">${icon('check')}</div><h2>Pendaftaran selesai</h2><p>${queue.filter((s) => s.face_enrolled_at).length} dari ${queue.length} siswa terdaftar.</p></div>`);
  }
}

/** Impor massal dari foto kartu pelajar: file diberi nama NIS, diproses satu per satu di browser. */
async function photoImport(onChange) {
  const { students } = await get('/api/admin/students');
  const byNis = new Map(students.filter((s) => s.active).map((s) => [s.nis, s]));
  let files = [];
  let cancelled = false;
  let running = false;

  const dlg = modal({
    wide: true,
    title: 'Impor data wajah dari foto',
    subtitle: 'Foto dibaca di browser ini saja. Yang dikirim ke server hanya angka hasil olahan wajah.',
    body: html`
      <ol class="small setup-steps">
        <li>Kumpulkan foto siswa (misalnya foto kartu pelajar) dalam satu folder.</li>
        <li>Beri nama file sesuai <b>NIS</b>, misalnya <b>2425001.jpg</b>. Nama seperti <b>2425001 - Ahmad.jpg</b> juga dikenali.</li>
        <li>Satu foto satu siswa, wajah menghadap depan, format JPG atau PNG.</li>
      </ol>
      <div class="btn-row mt-4">
        <label class="btn file-btn">${icon('upload', 'i-sm')} Pilih folder foto<input type="file" id="pf-dir" webkitdirectory multiple></label>
        <label class="btn file-btn">Pilih beberapa file<input type="file" id="pf-files" accept="image/jpeg,image/png,image/webp" multiple></label>
      </div>
      <div id="pf-sum" class="mt-4"></div>
      <label class="check"><input type="checkbox" id="pf-skip" checked><div><b>Lewati siswa yang sudah punya data wajah</b><small>Hilangkan centang untuk mengganti data lama dengan foto.</small></div></label>
      <div class="progress mt-3" id="pf-prog" hidden><progress max="1" value="0"></progress><span class="small muted nowrap"></span></div>
      <div id="pf-res" class="mt-3"></div>`,
    actions: html`<button class="btn" data-close>Tutup</button><button class="btn btn-primary" data-save disabled>Mulai impor</button>`,
  });
  const q = (sel) => dlg.querySelector(sel);
  const start = q('[data-save]');

  const pick = (list) => {
    files = [...list].filter((f) => /\.(jpe?g|png|webp|bmp)$/i.test(f.name));
    const matched = files.map((f) => ({ file: f, nis: nisFromFilename(f.name) })).filter((x) => x.nis);
    const unmatched = files.filter((f) => !nisFromFilename(f.name));
    const already = matched.filter((x) => byNis.get(x.nis).face_enrolled_at).length;
    mount(q('#pf-sum'), html`
      <p><b>${files.length} foto</b> dipilih: <b>${matched.length}</b> cocok dengan NIS siswa${already ? html`, ${already} di antaranya sudah punya data wajah` : ''}.</p>
      ${unmatched.length ? html`<details class="mt-2"><summary class="small">${unmatched.length} file tidak cocok dengan NIS mana pun</summary><ul class="small muted">${unmatched.slice(0, 50).map((f) => html`<li>${f.name}</li>`)}</ul></details>` : ''}`);
    start.disabled = matched.length === 0;
  };
  const nisFromFilename = (name) => faceMod.nisFromFilename(name, new Set(byNis.keys()));
  const faceMod = await import('../face.js');
  q('#pf-dir').addEventListener('change', (e) => pick(e.target.files));
  q('#pf-files').addEventListener('change', (e) => pick(e.target.files));
  dlg.addEventListener('close', () => { cancelled = true; if (running) onChange(); });

  start.addEventListener('click', async (e) => {
    e.preventDefault();
    if (running) { cancelled = true; start.textContent = 'Menghentikan…'; return; }
    const skip = q('#pf-skip').checked;
    const jobs = [];
    const seen = new Set();
    for (const f of files) {
      const nis = nisFromFilename(f.name);
      if (!nis || seen.has(nis)) continue;
      seen.add(nis);
      const st = byNis.get(nis);
      if (skip && st.face_enrolled_at) continue;
      jobs.push({ file: f, student: st });
    }
    if (!jobs.length) { toast('Tidak ada foto yang perlu diproses.'); return; }
    running = true;
    cancelled = false;
    start.textContent = 'Hentikan';
    start.classList.replace('btn-primary', 'btn-danger');
    const prog = q('#pf-prog');
    prog.hidden = false;
    const bar = prog.querySelector('progress');
    const label = prog.querySelector('span');
    bar.max = jobs.length;
    const results = [];
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* opsional */ }
    try {
      label.textContent = 'Menyiapkan pengenal wajah…';
      await faceMod.loadFaceEngine();
      const t0 = Date.now();
      for (let i = 0; i < jobs.length && !cancelled; i++) {
        const { file, student } = jobs[i];
        let r = await faceMod.descriptorsFromPhoto(file);
        if (!r.error) {
          try {
            await post('/api/admin/face/enroll', { student_id: student.id, model_id: faceMod.MODEL_ID, samples: r.samples, source: 'photo' });
            student.face_enrolled_at = Date.now();
            r = { ok: true };
          } catch (ex) {
            r = { error: ex.code || 'server', message: ex.message };
          }
        }
        results.push({ file: file.name, nis: student.nis, name: student.name, cls: student.class_name, ...r });
        bar.value = i + 1;
        const per = (Date.now() - t0) / (i + 1);
        const left = Math.round((per * (jobs.length - i - 1)) / 60000);
        label.textContent = `${i + 1} dari ${jobs.length}${left > 0 ? `, sisa ±${left} menit` : ''}`;
      }
    } finally {
      try { await wake?.release(); } catch { /* abaikan */ }
      running = false;
      start.textContent = 'Mulai impor';
      start.classList.replace('btn-danger', 'btn-primary');
    }
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    mount(q('#pf-res'), html`
      <div class="alert ${bad.length ? 'alert-warn' : 'alert-ok'}"><b>${ok.length} siswa berhasil</b>${bad.length ? html`, ${bad.length} gagal` : ''}${cancelled ? ' (dihentikan)' : ''}.</div>
      ${bad.length ? html`
        <div class="table-wrap"><table class="table"><thead><tr><th>Siswa</th><th>File</th><th>Alasan</th></tr></thead>
          <tbody>${bad.slice(0, 200).map((r) => html`<tr><td class="strong">${r.name}<span class="sub">${r.nis}, ${r.cls || '—'}</span></td><td class="small">${r.file}</td><td class="small">${r.message}</td></tr>`)}</tbody></table></div>
        <div class="btn-row mt-3"><button class="btn btn-sm" type="button" id="pf-csv">${icon('download', 'i-sm')} Unduh daftar gagal</button></div>
        <p class="small muted mt-2">Siswa yang gagal bisa didaftarkan dengan kamera, atau ganti fotonya lalu impor lagi.</p>` : ''}`);
    q('#pf-csv')?.addEventListener('click', () => downloadText('wajah-gagal.csv', toCsv([['nis', 'nama', 'kelas', 'file', 'alasan'], ...bad.map((r) => [r.nis, r.name, r.cls, r.file, r.message])])));
    onChange();
  });
}
