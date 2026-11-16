import { post } from '../api.js';
import { $, html, mount, busy, toast, serverNow, fmtTime, fmtDate } from '../ui.js';
import { state, loadMe, go } from '../app.js';

const mark = (sub) => html`
  <div class="mark"><img src="/icons/icon.svg" alt="" width="40" height="40">
    <div><b>${state.me?.school?.name || state.school?.name || 'Presensi Siswa'}</b><span>${sub}</span></div></div>`;

function clockMarkup(now) {
  const [hm, s] = [fmtTime(now).slice(0, 5), fmtTime(now).slice(6, 8)];
  return html`${hm}<span class="sec">:${s}</span>`;
}

export function renderLogin(root) {
  mount(root, html`
  <main class="login">
    <section class="login-time" aria-label="Waktu sekolah">
      ${mark('Presensi siswa')}
      <div>
        <div class="big-clock" id="clock" aria-live="off">${clockMarkup(serverNow())}</div>
        <p class="login-date" id="date">${fmtDate(serverNow())}, WIB</p>
      </div>
      <p class="login-foot">Waktu presensi dicatat menurut jam server sekolah, bukan jam di HP.</p>
    </section>
    <section class="login-form">
      <h1>Masuk</h1>
      <p>Siswa: username huruf s diikuti NIS, misalnya <b>s1234</b>. Password awal sama dengan NIS.</p>
      <form id="f" novalidate>
        <label class="field"><span>Username</span>
          <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="40" placeholder="s1234" required></label>
        <label class="field"><span>Password</span>
          <div class="input-pass"><input name="password" type="password" autocomplete="current-password" maxlength="64" required>
          <button type="button" id="peek">Lihat</button></div></label>
        <div class="alert alert-error" id="err" role="alert" hidden></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Masuk</button>
      </form>
      <p class="login-help">Lupa password? Minta wali kelas mengembalikannya ke NIS.</p>
    </section>
  </main>`);

  const f = $('#f');
  const err = $('#err');
  const timer = setInterval(() => {
    mount($('#clock'), clockMarkup(serverNow()));
  }, 1000);
  $('#peek').addEventListener('click', (e) => {
    const p = f.password;
    p.type = p.type === 'password' ? 'text' : 'password';
    e.currentTarget.textContent = p.type === 'password' ? 'Lihat' : 'Tutup';
  });
  f.username.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const username = f.username.value.trim();
    const password = f.password.value;
    if (!username || !password) {
      err.textContent = 'Isi username dan password terlebih dahulu.';
      err.hidden = false;
      return;
    }
    if (/^\d+$/.test(username)) {
      err.textContent = `Username siswa diawali huruf s. Coba s${username}.`;
      err.hidden = false;
      return;
    }
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await post('/api/auth/login', { username, password });
        await loadMe();
        go(state.me.must_change_password ? '#/password' : '#/');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        f.password.value = '';
        f.password.focus();
      }
    });
  });
  return () => clearInterval(timer);
}

function isWeak(pw) {
  if (/^(\d)\1+$/.test(pw)) return true;
  if ('01234567890123456789'.includes(pw) || '98765432109876543210'.includes(pw)) return true;
  return ['123123', '112233', '121212', '010101'].includes(pw);
}

export function renderPassword(root) {
  const u = state.me.user;
  const forced = state.me.must_change_password;
  const staff = u.role !== 'siswa';
  const min = staff ? 8 : 6;
  const backHash = staff ? '#/admin/hari-ini' : '#/akun';
  mount(root, html`
  <main class="solo">
    <section class="solo-card">
      ${mark(forced ? 'Aktivasi akun' : 'Keamanan akun')}
      <h1>${forced ? 'Buat password pribadi' : 'Ganti password'}</h1>
      <p>${forced
        ? (staff ? 'Password dari admin hanya sementara. Buat password yang hanya Anda ketahui.' : 'Password Anda masih NIS, yang mudah diketahui teman. Buat password yang hanya Anda ketahui.')
        : 'Masukkan password lama, lalu password baru.'}</p>
      <form id="f" novalidate>
        <label class="field"><span>Password ${forced ? (staff ? 'sementara' : 'saat ini (NIS)') : 'lama'}</span>
          <input name="current" type="password" autocomplete="current-password" maxlength="64"></label>
        <label class="field"><span>Password baru</span>
          <input name="next" type="password" autocomplete="new-password" maxlength="64"></label>
        <label class="field"><span>Ulangi password baru</span>
          <input name="again" type="password" autocomplete="new-password" maxlength="64"></label>
        <ul class="rules">
          <li data-r="len">Minimal ${min} karakter</li>
          <li data-r="nis">Tidak sama dengan ${staff ? 'username' : 'NIS'}</li>
          <li data-r="weak">Bukan pola mudah seperti 123456</li>
          <li data-r="same">Kedua isian password baru sama</li>
        </ul>
        <div class="alert alert-error" id="err" role="alert" hidden></div>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Simpan password</button>
        ${forced
          ? html`<button class="btn btn-quiet btn-block mt-2" type="button" id="out">Keluar</button>`
          : html`<a class="btn btn-quiet btn-block mt-2" href="${backHash}">Batal</a>`}
      </form>
    </section>
  </main>`);

  const f = $('#f');
  const err = $('#err');
  const check = () => {
    const n = f.next.value;
    const r = {
      len: n.length >= min,
      nis: n.length > 0 && n.toLowerCase() !== u.username && n !== u.nis,
      weak: n.length > 0 && !(/^\d+$/.test(n) && isWeak(n)),
      same: n.length > 0 && n === f.again.value,
    };
    for (const [k, ok] of Object.entries(r)) $(`[data-r=${k}]`).classList.toggle('ok', ok);
    return Object.values(r).every(Boolean);
  };
  f.addEventListener('input', check);
  $('#out')?.addEventListener('click', async () => {
    await post('/api/auth/logout').catch(() => {});
    state.me = null;
    go('#/masuk');
  });
  f.current.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (!check()) {
      err.textContent = 'Password baru belum memenuhi semua syarat di atas.';
      err.hidden = false;
      return;
    }
    await busy(f.querySelector('[type=submit]'), async () => {
      try {
        await post('/api/auth/change-password', { current_password: f.current.value, new_password: f.next.value });
        toast('Password tersimpan.', 'success');
        await loadMe();
        go('#/');
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      }
    });
  });
}
