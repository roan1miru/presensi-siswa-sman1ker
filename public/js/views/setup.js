// Halaman instalasi awal: muncul otomatis selama aplikasi belum punya admin pertama.
import { get, post } from '../api.js';
import { $, html, mount, busy, icon } from '../ui.js';
import { state, loadMe, go } from '../app.js';

export async function renderSetup(root) {
  let st;
  try {
    st = await get('/api/setup/status');
  } catch (e) {
    mount(root, html`<main class="solo"><section class="solo-card"><h1>Aplikasi belum siap</h1><p>${e.message}</p></section></main>`);
    return;
  }
  if (!st.needed) { state.setup_needed = false; go('#/masuk'); return; }

  if (!st.has_code) {
    mount(root, html`
    <main class="solo"><section class="solo-card">
      <div class="mark"><img src="/icons/icon.svg" alt="" width="40" height="40"><div><b>Instalasi presensi</b><span>Satu langkah lagi</span></div></div>
      <h1>Kode instalasi belum diatur</h1>
      <p>Demi keamanan, akun admin pertama hanya bisa dibuat dengan kode instalasi yang Anda tentukan sendiri di Cloudflare. Kode contoh <b>GANTI-dengan-kata-rahasia-anda</b> sengaja ditolak karena terlihat publik di GitHub.</p>
      <ol class="setup-steps">
        <li>Buka <b>dash.cloudflare.com</b>, pilih <b>Workers &amp; Pages</b>, lalu klik aplikasi <b>presensi-siswa</b>.</li>
        <li>Buka tab <b>Settings</b>, bagian <b>Variables and Secrets</b>, klik <b>Add</b>.</li>
        <li>Pilih tipe <b>Secret</b>, isi nama <b>SETUP_CODE</b>, dan nilai berupa kata rahasia pilihan Anda (minimal 10 karakter). Klik <b>Deploy</b>. Bila SETUP_CODE sudah ada, klik ikon pensilnya untuk mengganti nilainya.</li>
        <li>Kembali ke halaman ini dan muat ulang.</li>
      </ol>
      <button class="btn btn-primary btn-block btn-lg mt-4" id="reload">${icon('refresh', 'i-sm')} Muat ulang</button>
    </section></main>`);
    $('#reload').addEventListener('click', () => location.reload());
    return;
  }

  mount(root, html`
  <main class="solo"><section class="solo-card">
    <div class="mark"><img src="/icons/icon.svg" alt="" width="40" height="40"><div><b>Instalasi presensi</b><span>${st.recovery ? 'Pemulihan kunci sistem' : 'Langkah terakhir'}</span></div></div>
    <h1>${st.recovery ? 'Pulihkan akses admin' : 'Buat akun admin pertama'}</h1>
    <p>${st.recovery
      ? 'Kunci sistem hilang sehingga password lama tidak bisa diperiksa. Buat ulang akun admin; password siswa nanti dikembalikan ke NIS dari menu Pengaturan.'
      : 'Halaman ini hanya muncul sekali. Setelah akun dibuat, halaman ini tertutup permanen.'}</p>
    <form id="f" novalidate>
      <label class="field"><span>Kode instalasi</span>
        <input name="code" type="password" autocomplete="off" maxlength="200">
        <small>Kata rahasia yang Anda isi di kolom SETUP_CODE saat deploy.</small></label>
      <label class="field"><span>Nama lengkap admin</span><input name="name" maxlength="100" autocomplete="name"></label>
      <label class="field"><span>Username</span><input name="username" maxlength="30" autocapitalize="none" spellcheck="false" autocomplete="username" placeholder="admin.sekolah">
        <small>Huruf kecil, angka, titik. Jangan diawali s+angka (khusus siswa).</small></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" maxlength="64">
        <small>Minimal 10 karakter. Simpan di tempat aman.</small></label>
      <label class="field"><span>Ulangi password</span><input name="again" type="password" autocomplete="new-password" maxlength="64"></label>
      <div class="alert alert-error" id="err" role="alert" hidden></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${st.recovery ? 'Pulihkan akses' : 'Buat akun dan mulai'}</button>
    </form>
  </section></main>`);

  const f = $('#f');
  const err = $('#err');
  f.code.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (f.password.value !== f.again.value) { err.textContent = 'Kedua isian password tidak sama.'; err.hidden = false; return; }
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await post('/api/setup', { code: f.code.value, name: f.name.value, username: f.username.value, password: f.password.value });
        state.setup_needed = false;
        sessionStorage.setItem('justInstalled', '1');
        await loadMe();
        go('#/admin/pengaturan');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  });
}
