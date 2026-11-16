import { get, post } from '../api.js';
import { $, html, raw, mount, icon, toast, modal, confirmDialog, statusChip, relTime } from '../ui.js';
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
        <button class="btn btn-primary" id="batch">${icon('face', 'i-sm')} Daftarkan yang belum</button>
      </div>
      <div id="list"><div class="loading">Memuat…</div></div>
    </div>
    <div class="card card-pad mt-4">
      <h2 class="mb-2">Agar hasilnya akurat</h2>
      <ul class="small muted">
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
          <td>${s.face_enrolled_at ? html`${statusChip('hadir', 'Terdaftar')} <span class="small muted">${relTime(s.face_enrolled_at)}</span>` : statusChip('belum', 'Belum')}</td>
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
    if (b.id === 'batch') {
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
