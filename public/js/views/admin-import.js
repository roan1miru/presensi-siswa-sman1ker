import { post } from '../api.js';
import { $, html, mount, icon, toast, downloadText, statusChip } from '../ui.js';
import { parseStudents, toCsv } from '../csv.js';
import { printCards } from '../print.js';
import { state } from '../app.js';
import { pageHead } from './admin.js';

const CHUNK = 20;

export default function pageImport(el) {
  let parsed = null;
  let running = false;
  const guard = (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);

  mount(el, html`
    ${pageHead('Impor siswa', 'Siswa baru mendapat username s+NIS dengan password awal NIS. Siswa lama hanya diperbarui nama dan kelasnya.')}
    <div class="grid-main">
      <div class="stack">
        <div class="card card-pad">
          <label class="drop" id="drop">
            <input type="file" id="file" accept=".csv,text/csv,.txt" aria-label="Pilih file CSV">
            ${icon('upload', 'i-lg')}
            <b>Pilih atau seret file CSV</b>
            <span>Tiga kolom dengan judul nis, nama, kelas. Pemisah koma atau titik koma (format CSV Excel Indonesia) sama-sama diterima.</span>
          </label>
          <div id="preview"></div>
        </div>
        <div class="card" id="result-card" hidden><div id="result"></div></div>
      </div>
      <div class="card card-pad">
        <h2 class="mb-2">Menyiapkan file dari Excel</h2>
        <ol class="small muted">
          <li>Buat tiga kolom: <b>nis</b>, <b>nama</b>, <b>kelas</b>.</li>
          <li>Satu baris untuk satu siswa. Nama kelas ditulis sama persis untuk siswa sekelas, misalnya X TKJ 1.</li>
          <li>Pilih File, Simpan Sebagai, lalu format CSV.</li>
        </ol>
        <button class="btn btn-sm mt-3" id="tpl">${icon('download', 'i-sm')} Unduh contoh</button>
      </div>
    </div>`);

  $('#tpl', el).addEventListener('click', () => downloadText('contoh-impor-siswa.csv',
    toCsv([['nis', 'nama', 'kelas'], ['2425001', 'Ahmad Pratama', 'X TKJ 1'], ['2425002', 'Siti Nurhaliza', 'X TKJ 1'], ['2425037', 'Budi Santoso', 'X TKJ 2']])));

  const readFile = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('File terlalu besar (maks. 2 MB).', 'error'); return; }
    parsed = parseStudents(await file.text());
    const byClass = parsed.students.reduce((m, s) => m.set(s.class_name, (m.get(s.class_name) || 0) + 1), new Map());
    mount($('#preview', el), html`
      <div class="mt-4">
        <p><b>${parsed.students.length} siswa siap diimpor</b> dari ${file.name}.</p>
        ${parsed.problems.length ? html`<details class="mt-2"><summary class="small">${parsed.problems.length} baris dilewati karena bermasalah</summary>
          <ul class="small muted">${parsed.problems.slice(0, 60).map((p) => html`<li>${p}</li>`)}</ul></details>` : ''}
        <div class="chips mt-3">${[...byClass].map(([k, n]) => html`<span class="tag">${k}: ${n}</span>`)}</div>
        ${parsed.students.length ? html`
          <div class="table-wrap mt-4"><table class="table"><thead><tr><th>NIS</th><th>Username</th><th>Nama</th><th>Kelas</th></tr></thead>
            <tbody>${parsed.students.slice(0, 5).map((s) => html`<tr><td class="num">${s.nis}</td><td class="num">s${s.nis.toLowerCase()}</td><td>${s.name}</td><td>${s.class_name}</td></tr>`)}</tbody></table></div>
          ${parsed.students.length > 5 ? html`<p class="small muted mt-2">Dan ${parsed.students.length - 5} siswa lainnya.</p>` : ''}
          <div class="progress mt-4" id="prog" hidden><progress id="bar" max="${parsed.students.length}" value="0"></progress><span class="small muted num nowrap" id="ptext"></span></div>
          <button class="btn btn-primary btn-lg mt-4" id="go">Impor ${parsed.students.length} siswa</button>` : ''}
      </div>`);
    $('#go', el)?.addEventListener('click', run);
  };
  $('#file', el).addEventListener('change', (e) => readFile(e.target.files[0]));
  const drop = $('#drop', el);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); });

  async function run(e) {
    e.currentTarget.disabled = true;
    const list = parsed.students;
    const results = [];
    running = true;
    $('#prog', el).hidden = false;
    try {
      for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK).map(({ nis, name, class_name }) => ({ nis, name, class_name }));
        for (let attempt = 1; ; attempt++) {
          try {
            results.push(...(await post('/api/admin/students/import', { rows: chunk })).results);
            break;
          } catch (ex) {
            if (attempt >= 3 || [400, 403].includes(ex.status)) { chunk.forEach((c) => results.push({ ...c, status: 'error', message: ex.message })); break; }
            await new Promise((r) => setTimeout(r, 600 * attempt + Math.random() * 400));
          }
        }
        const done = Math.min(i + CHUNK, list.length);
        $('#bar', el).value = done;
        $('#ptext', el).textContent = `${done} dari ${list.length}`;
      }
    } finally {
      running = false;
    }
    showResult(results);
  }

  function showResult(results) {
    const created = results.filter((r) => r.status === 'created');
    const updated = results.filter((r) => r.status === 'updated');
    const failed = results.filter((r) => r.status === 'error');
    $('#result-card', el).hidden = false;
    mount($('#result', el), html`
      <div class="card-head"><h2>Hasil impor</h2></div>
      <div class="figures">
        <div><b>${created.length}</b><span class="f-hadir">Akun baru</span></div>
        <div><b>${updated.length}</b><span>Diperbarui</span></div>
        <div><b>${failed.length}</b><span class="f-alfa">Gagal</span></div>
      </div>
      <div class="card-pad">
        ${failed.length ? html`<details open><summary class="small">${failed.length} baris gagal</summary><ul class="small">${failed.slice(0, 100).map((f) => html`<li>${f.nis} ${f.name}: ${f.message}</li>`)}</ul></details>` : ''}
        ${created.length ? html`<p class="small muted">Bagikan kartu login agar siswa tahu username-nya. Password awal = NIS.</p>
          <div class="btn-row mt-3"><button class="btn btn-primary" id="print">${icon('print', 'i-sm')} Cetak ${created.length} kartu login</button>
          <a class="btn" href="#/admin/siswa">Lihat daftar siswa</a></div>` : ''}
        ${!created.length && !failed.length ? html`<p>${statusChip('hadir', 'Semua data siswa sudah diperbarui')}</p>` : ''}
      </div>`);
    $('#print', el)?.addEventListener('click', () => {
      const sorted = [...created].sort((a, b) => a.class_name.localeCompare(b.class_name, 'id', { numeric: true }) || a.name.localeCompare(b.name, 'id'));
      printCards(sorted.map((r) => ({ name: r.name, username: r.username, nis: r.nis, class_name: r.class_name })), state.me.school.name);
    });
  }

  return () => window.removeEventListener('beforeunload', guard);
}
