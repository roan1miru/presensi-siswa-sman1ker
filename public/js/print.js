// Kartu login siswa (A4, 8 kartu per halaman). Elemen cetak hanya hidup selama dialog cetak terbuka.
import { html, mount } from './ui.js';

export function printCards(cards, schoolName, { staff = false } = {}) {
  const area = document.createElement('div');
  area.id = 'print-area';
  const host = location.host;
  mount(area, html`${cards.map((c) => html`
    <article class="pcard">
      <header><img src="/icons/icon.svg" alt=""><div><b>${schoolName}</b><span>Kartu login presensi</span></div></header>
      <dl>
        <dt>Nama</dt><dd>${c.name}</dd>
        ${c.class_name ? html`<dt>Kelas</dt><dd>${c.class_name}</dd>` : ''}
        <dt>Username</dt><dd class="big">${c.username}</dd>
        <dt>Password awal</dt><dd class="big">${staff ? c.password : c.nis}</dd>
      </dl>
      <ol>
        <li>Buka <b>${host}</b> di browser HP.</li>
        <li>Masuk dengan username dan password awal di atas.</li>
        <li>Ganti password agar akun tidak dipakai orang lain.</li>
      </ol>
      <footer>${staff ? 'Sandi awal hanya berlaku sampai diganti.' : 'Password awal sama dengan NIS. Lupa password? Minta wali kelas mereset ke NIS.'}</footer>
    </article>`)}`);
  document.body.append(area);
  document.body.classList.add('printing');
  const done = () => {
    area.remove();
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 150);
}
