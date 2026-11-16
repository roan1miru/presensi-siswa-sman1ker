import { get, post } from '../api.js';
import {
  $, html, raw, mount, toast, busy, icon, statusChip, serverNow, fmtTime, fmtDate, fmtDay, fmtClock,
  initials, confirmDialog, STATUS_LABEL,
} from '../ui.js';
import { state, go, loadMe } from '../app.js';

const KIND_LABEL = { masuk: 'Masuk', pulang: 'Pulang', kegiatan: 'Kegiatan' };

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }).format(serverNow()));
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}

function shell(root, page, body) {
  const { user, school } = state.me;
  const tab = (key, label, ic) => html`<a href="#/${key}" ${page === key ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a>`;
  mount(root, html`
    <div class="app">
      <header class="app-top">
        <div class="mark"><img src="/icons/icon.svg" alt="" width="32" height="32"><div><b>${school.name}</b></div></div>
        <a href="#/akun" class="avatar" aria-label="Akun saya">${initials(user.name)}</a>
      </header>
      <main class="app-body" id="body">${body}</main>
    </div>
    <nav class="tabbar" aria-label="Menu utama">
      ${tab('beranda', 'Beranda', 'home')}${tab('riwayat', 'Riwayat', 'history')}${tab('akun', 'Akun', 'user')}
    </nav>`);
  return $('#body');
}

export function renderStudent(root, page) {
  if (page === 'riwayat') return renderHistory(root);
  if (page === 'akun') return renderAccount(root);
  return renderHome(root);
}

// ─────────────────────────────── Beranda ───────────────────────────────
function clockHtml() {
  const t = fmtTime(serverNow());
  return html`${t.slice(0, 5)}<span class="sec">${t.slice(6, 8)}</span>`;
}

function renderHome(root) {
  const { user } = state.me;
  const body = shell(root, 'beranda', html`
    <section class="hello">
      <p>${greeting()},</p>
      <h1>${user.name}</h1>
      <div class="meta"><span class="tag">${user.class_name ? `Kelas ${user.class_name}` : 'Belum masuk kelas'}</span><span class="tag">${user.username}</span></div>
    </section>
    <section class="clock-block" aria-label="Jam server sekolah">
      <div class="big-clock" id="clock">${clockHtml()}</div>
      <p id="date">${fmtDate(serverNow())}</p>
    </section>
    ${user.is_default_password ? html`
      <div class="alert alert-warn flex"><span class="grow">Password Anda masih NIS. Ganti agar akun tidak dipakai orang lain.</span>
      <a class="btn btn-sm" href="#/password">Ganti</a></div>` : ''}
    <section>
      <h2 class="section-title">Presensi hari ini</h2>
      <div class="panel" id="today"><div class="loading">Memuat jadwal…</div></div>
    </section>`);

  const today = $('#today', body);
  let data = null;

  const draw = () => {
    if (!data) return;
    if (data.holiday) {
      mount(today, html`<div class="empty">${icon('calendar', 'i-lg')}<b>Hari ini libur</b><span>${data.holiday}</span></div>`);
      return;
    }
    if (!data.sessions.length) {
      mount(today, html`<div class="empty">${icon('calendar', 'i-lg')}<b>Tidak ada jadwal presensi hari ini</b><span>Jadwal akan muncul di sini saat sekolah membukanya.</span></div>`);
      return;
    }
    const needsFace = data.sessions.some((s) => s.require_face && !s.record && s.state !== 'closed');
    mount(today, html`
      ${needsFace && !data.face_enrolled ? html`<div class="alert alert-warn mt-3 mb-2">Wajah Anda belum didaftarkan. Minta wali kelas mendaftarkannya sebelum presensi.</div>` : ''}
      <ol class="timeline">${data.sessions.map((s) => {
        let action;
        if (s.record) {
          action = html`<div class="flex wrap mt-1">${statusChip(s.record.status)}<span class="small muted num">${s.record.source === 'manual' ? 'dicatat petugas' : `pukul ${fmtClock(s.record.server_time, true)}`}</span></div>`;
        } else if (s.state === 'open') {
          action = html`<p>Tutup pukul ${s.end_time}${s.late_after ? `, terlambat setelah ${s.late_after}` : ''}.</p>
            <button class="btn btn-primary btn-block" data-go="${s.id}">${icon('pin')} Presensi ${KIND_LABEL[s.kind].toLowerCase()} sekarang</button>`;
        } else if (s.state === 'upcoming') {
          action = html`<p>Dibuka pukul ${s.start_time}.</p>`;
        } else {
          action = html`<div class="mt-1">${statusChip('alfa', 'Tidak presensi')}</div>`;
        }
        return html`<li>
          <div class="tl-time">${s.start_time}<small>${s.end_time}</small></div>
          <div class="tl-body"><h3>${s.title}</h3>${action}</div>
        </li>`;
      })}</ol>`);
  };

  const load = async () => {
    try {
      data = await get('/api/me/today');
      draw();
    } catch (e) {
      mount(today, html`<div class="empty">${icon('alert', 'i-lg')}<b>Jadwal belum bisa dimuat</b><span>${e.message}</span><button class="btn btn-sm" id="retry">Coba lagi</button></div>`);
      $('#retry', today)?.addEventListener('click', load);
    }
  };
  load();

  today.addEventListener('click', (e) => {
    const id = e.target.closest('[data-go]')?.dataset.go;
    if (!id) return;
    const s = data.sessions.find((x) => x.id === id);
    startFlow(s, { faceEnrolled: data.face_enrolled, onSchoolNet: data.on_school_network, onDone: load });
  });

  const tick = setInterval(() => {
    mount($('#clock'), clockHtml());
    $('#date').textContent = fmtDate(serverNow());
  }, 1000);
  const refresh = setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('.flow')) load(); }, 60_000);
  const onVis = () => { if (document.visibilityState === 'visible' && !document.querySelector('.flow')) load(); };
  document.addEventListener('visibilitychange', onVis);
  // Muat model wajah di latar belakang agar presensi pagi tidak menunggu unduhan.
  if ('requestIdleCallback' in window) requestIdleCallback(() => import('../face.js').then((m) => m.loadFaceEngine()).catch(() => {}));
  return () => { clearInterval(tick); clearInterval(refresh); document.removeEventListener('visibilitychange', onVis); };
}

// ─────────────────────────────── Alur presensi ───────────────────────────────
function metersOffset(lat0, lng0, lat, lng) {
  const dx = (lng - lng0) * Math.cos((lat0 * Math.PI) / 180) * 111320;
  const dy = (lat - lat0) * 110540;
  return { dx, dy, d: Math.hypot(dx, dy) };
}

function ringSvg(sess, pos) {
  const R = 130;
  if (!pos) {
    return html`<svg class="ring" viewBox="0 0 300 300" role="img" aria-label="Mencari lokasi">
      <circle class="zone-out" cx="150" cy="150" r="${R}"/><circle class="zone" cx="150" cy="150" r="${R / 2}"/>
      <circle class="center" cx="150" cy="150" r="5"/></svg>`;
  }
  const { dx, dy, d } = metersOffset(sess.lat, sess.lng, pos.lat, pos.lng);
  const span = Math.max(sess.radius_m * 2, d * 1.25, 60);
  const k = R / span;
  let x = dx * k, y = -dy * k;
  const len = Math.hypot(x, y);
  if (len > R - 8) { x = (x / len) * (R - 8); y = (y / len) * (R - 8); }
  const inside = d <= sess.radius_m;
  return html`<svg class="ring ${inside ? '' : 'out'}" viewBox="0 0 300 300" role="img" aria-label="${inside ? 'Di dalam area sekolah' : 'Di luar area sekolah'}">
    <circle class="zone-out" cx="150" cy="150" r="${R}"/>
    <circle class="zone" cx="150" cy="150" r="${sess.radius_m * k}"/>
    <circle class="center" cx="150" cy="150" r="5"/>
    <circle class="acc" cx="${150 + x}" cy="${150 + y}" r="${Math.min(pos.accuracy * k, R)}"/>
    <circle class="pulse" cx="${150 + x}" cy="${150 + y}" r="7"/>
    <circle class="me" cx="${150 + x}" cy="${150 + y}" r="8"/>
  </svg>`;
}

function startFlow(session, { faceEnrolled, onSchoolNet, onDone }) {
  const el = document.createElement('div');
  el.className = 'flow';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', `Presensi ${session.title}`);
  document.body.append(el);
  document.body.style.overflow = 'hidden';

  const steps = session.require_face ? 3 : 2;
  let video = null;
  let watchId = null;
  let alive = true;
  let token = null;
  let pos = null;

  const close = (refresh = false) => {
    alive = false;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (video) import('../face.js').then((m) => m.stopCamera(video));
    el.remove();
    document.body.style.overflow = '';
    if (refresh) onDone();
  };
  const frame = (stepIdx, title, bodyHtml, footHtml = '') => {
    mount(el, html`
      <div class="flow-top">
        <button class="icon-btn" id="x" aria-label="Tutup">${icon('x')}</button>
        <h2>${title}</h2>
      </div>
      <div class="steps" aria-hidden="true">${Array.from({ length: steps }, (_, i) => html`<span class="${i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''}"></span>`)}</div>
      <div class="flow-body">${bodyHtml}</div>
      <div class="flow-foot">${footHtml}</div>`);
    $('#x', el).addEventListener('click', async () => {
      if (stepIdx >= steps - 1 && !video) return close(true);
      if (await confirmDialog({ title: 'Batalkan presensi?', message: 'Presensi belum terkirim. Anda bisa mengulanginya selama jadwal masih dibuka.', confirmText: 'Batalkan', danger: true })) close();
    });
  };

  // ── Hasil ──
  const showResult = ({ ok, late, title, message, time, retry }) => {
    if (video) { import('../face.js').then((m) => m.stopCamera(video)); video = null; }
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    frame(steps - 1, session.title, html`
      <div class="result" aria-live="polite">
        <div class="result-mark ${ok ? (late ? 'late' : 'ok') : 'bad'}">${icon(ok ? 'check' : 'x')}</div>
        <h2>${title}</h2>
        ${time ? html`<div class="big-clock">${fmtClock(time, true)}</div>` : ''}
        <p>${message}</p>
      </div>`, html`
      ${retry ? html`<button class="btn btn-primary btn-lg btn-block" id="again">${icon('refresh')} Coba lagi</button>` : ''}
      <button class="btn ${retry ? '' : 'btn-ink'} btn-lg btn-block" id="done">Kembali ke beranda</button>`);
    $('#done', el).addEventListener('click', () => close(true));
    $('#again', el)?.addEventListener('click', () => { token = null; stepLocation(); });
  };

  const fail = (e, retry = true) => {
    const noRetry = ['already', 'closed', 'no_schedule', 'face_not_enrolled', 'too_many_attempts', 'holiday'].includes(e.code);
    showResult({ ok: false, title: e.code === 'already' ? 'Sudah tercatat' : 'Presensi belum berhasil', message: e.message, retry: retry && !noRetry });
  };

  // ── Langkah 1: lokasi ──
  function stepLocation() {
    const draw = () => {
      if (!alive) return;
      const s = session;
      let dist = null, inside = false, accOk = false;
      if (pos) {
        dist = metersOffset(s.lat, s.lng, pos.lat, pos.lng).d;
        inside = dist <= s.radius_m;
        accOk = pos.accuracy <= s.max_accuracy_m;
      }
      const ready = pos && inside && accOk && (!s.require_school_ip || onSchoolNet);
      let msg;
      if (!pos) msg = html`<p class="flow-lead">Mencari lokasi Anda. Pastikan GPS menyala dan izin lokasi diberikan.</p>`;
      else if (!accOk) msg = html`<div class="alert alert-warn">Sinyal GPS belum akurat (±${Math.round(pos.accuracy)} m, batasnya ${s.max_accuracy_m} m). Pindah ke area terbuka dan tunggu sebentar.</div>`;
      else if (!inside) msg = html`<div class="alert alert-error">Anda berada ${Math.round(dist - s.radius_m)} m di luar area presensi. Mendekatlah ke sekolah.</div>`;
      else if (s.require_school_ip && !onSchoolNet) msg = html`<div class="alert alert-warn">Sesi ini mewajibkan Wi-Fi sekolah. Sambungkan HP ke Wi-Fi sekolah lalu muat ulang halaman.</div>`;
      else msg = html`<div class="alert alert-ok">Anda berada di area sekolah.</div>`;
      frame(0, session.title, html`
        <h3 class="flow-title">Periksa lokasi</h3>
        <div class="ring-wrap">${ringSvg(s, pos)}</div>
        <div class="loc-stats">
          <div class="${pos ? (inside ? 'good' : 'bad') : ''}"><b>${pos ? `${Math.round(dist)} m` : '—'}</b><span>Jarak, batas ${s.radius_m} m</span></div>
          <div class="${pos ? (accOk ? 'good' : 'bad') : ''}"><b>${pos ? `±${Math.round(pos.accuracy)} m` : '—'}</b><span>Akurasi, batas ${s.max_accuracy_m} m</span></div>
        </div>
        <div class="mt-4">${msg}</div>`, html`
        <button class="btn btn-primary btn-lg btn-block" id="next" ${ready ? '' : raw('disabled')}>${s.require_face ? 'Lanjut ke verifikasi wajah' : 'Kirim presensi'}</button>`);
      $('#next', el).addEventListener('click', async (e) => {
        await busy(e.currentTarget, async () => {
          try {
            const t = await post('/api/attendance/token', { schedule_id: s.id });
            token = t;
            if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
            if (s.require_face) stepFace();
            else submit(null);
          } catch (ex) { fail(ex); }
        });
      });
    };
    if (!navigator.geolocation) return fail({ message: 'Browser ini tidak mendukung lokasi.' }, false);
    draw();
    if (watchId === null) {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          // gps_time memakai jam server (jam HP bisa salah).
          pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: serverNow().getTime() - Math.max(0, Date.now() - p.timestamp) };
          draw();
        },
        (err) => {
          if (!alive) return;
          const m = err.code === 1
            ? 'Izin lokasi ditolak. Buka pengaturan situs di browser, izinkan lokasi, lalu coba lagi.'
            : 'Lokasi belum bisa dibaca. Pastikan GPS menyala, lalu coba lagi.';
          fail({ message: m });
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
    }
  }

  // ── Langkah 2: wajah ──
  async function stepFace() {
    const face = await import('../face.js');
    const chal = token.challenges;
    frame(1, session.title, html`
      <div class="cam" id="cam">
        <video id="v" playsinline muted></video>
        ${raw(face.ovalOverlay)}
        <div class="cam-loading" id="load"><span>Menyiapkan pengenal wajah</span><progress id="lp" max="1" value="0"></progress>
          <small>Unduhan pertama sekitar 8 MB, berikutnya langsung dari HP.</small></div>
        <div class="cam-hint" id="hint" aria-live="polite"></div>
      </div>
      <div class="prompt" aria-live="polite"><h3 id="pt">Arahkan wajah ke dalam bingkai</h3><p id="pd">Lepas masker atau kacamata hitam, pastikan cahaya cukup.</p></div>
      ${chal.length ? html`<div class="chal" id="chal">${chal.map((c, i) => html`<span data-i="${i}">${face.CHALLENGE_SHORT[c]}</span>`)}</div>` : ''}
      <p class="small muted center mt-4">Gambar kamera diproses di HP ini dan tidak dikirim ke mana pun.</p>`);
    video = $('#v', el);
    const hint = $('#hint', el);
    const cam = $('#cam', el);
    const setPrompt = (t, d) => { $('#pt', el).textContent = t; $('#pd', el).textContent = d; };
    try {
      await face.loadFaceEngine((p) => { const lp = $('#lp', el); if (lp) lp.value = p; });
      if (!alive) return;
      await face.startCamera(video);
      $('#load', el).hidden = true;
    } catch (e) {
      return fail({ message: e.message || 'Pengenal wajah gagal dimuat. Periksa koneksi lalu coba lagi.' });
    }

    const descriptors = [];
    const done = [];
    let phase = 'align';
    let stable = 0;
    let ci = 0;
    let tracker = null;
    let phaseStart = Date.now();
    const deadline = Date.now() + (token.expires_in - 15) * 1000;

    const markChal = () => {
      el.querySelectorAll('#chal span').forEach((s, i) => {
        s.className = i < ci ? 'ok' : i === ci && phase === 'challenge' ? 'now' : '';
      });
    };

    while (alive && video) {
      if (Date.now() > deadline) return fail({ code: 'timeout', message: 'Waktu verifikasi habis. Ulangi presensi.' });
      let r;
      try {
        r = await face.analyze(video, { withDescriptor: phase === 'capture' || phase === 'final' });
      } catch {
        await new Promise((res) => setTimeout(res, 300));
        continue;
      }
      if (!alive || !video) return;
      hint.textContent = r.hint || '';
      cam.classList.toggle('ready', !!r.ok);

      if (phase === 'align') {
        stable = r.ok && face.frontal(r.metrics) ? stable + 1 : 0;
        if (!r.ok) setPrompt('Arahkan wajah ke dalam bingkai', 'Lepas masker atau kacamata hitam, pastikan cahaya cukup.');
        else if (!face.frontal(r.metrics)) setPrompt('Hadapkan wajah lurus ke kamera', 'Tahan sebentar.');
        else setPrompt('Tahan posisi', 'Sedang membaca wajah…');
        if (stable >= 3) phase = 'capture';
      } else if (phase === 'capture') {
        if (r.ok && r.descriptor && face.frontal(r.metrics)) {
          descriptors.push(r.descriptor);
          if (chal.length) {
            phase = 'challenge';
            tracker = face.challengeTracker(chal[ci]);
            phaseStart = Date.now();
            setPrompt(face.CHALLENGE_TEXT[chal[ci]].title, face.CHALLENGE_TEXT[chal[ci]].hint);
          } else {
            phase = 'final';
          }
          markChal();
        } else phase = 'align';
      } else if (phase === 'challenge') {
        if (r.faces === 1 && r.metrics && tracker.update(r.metrics)) {
          done.push(chal[ci]);
          ci++;
          if (ci < chal.length) {
            tracker = face.challengeTracker(chal[ci]);
            phaseStart = Date.now();
            setPrompt(face.CHALLENGE_TEXT[chal[ci]].title, face.CHALLENGE_TEXT[chal[ci]].hint);
          } else {
            phase = 'final';
            setPrompt('Hadapkan wajah lurus lagi', 'Langkah terakhir.');
          }
          markChal();
        } else if (r.faces !== 1) {
          hint.textContent = r.hint || '';
        } else if (Date.now() - phaseStart > 20_000) {
          return fail({ code: 'liveness_timeout', message: 'Gerakan belum terdeteksi. Ulangi dan lakukan gerakan dengan jelas.' });
        }
      } else if (phase === 'final') {
        if (r.ok && r.descriptor && face.frontal(r.metrics)) {
          descriptors.push(r.descriptor);
          face.stopCamera(video);
          video = null;
          return submit({ model_id: face.MODEL_ID, descriptors, liveness: done });
        }
        if (r.ok && !face.frontal(r.metrics)) setPrompt('Hadapkan wajah lurus lagi', 'Langkah terakhir.');
      }
      await new Promise((res) => setTimeout(res, phase === 'challenge' ? 60 : 120));
    }
  }

  // ── Langkah terakhir: kirim ──
  async function submit(faceData) {
    frame(steps - 1, session.title, html`<div class="result"><div class="loading">Mengirim presensi…</div></div>`);
    const body = { token: token.token, location: { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, gps_time: pos.at } };
    if (faceData) body.face = faceData;
    try {
      const r = await post('/api/attendance/submit', body);
      showResult({
        ok: true, late: r.status === 'terlambat',
        title: r.status === 'terlambat' ? 'Tercatat terlambat' : 'Tercatat hadir',
        time: r.server_time,
        message: `${r.schedule_title}, ${r.distance_m} m dari titik sekolah.`,
      });
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (e) {
      if (e.code === 'network') {
        // Cek ulang: jangan pernah menampilkan "berhasil" palsu atau "gagal" palsu.
        try {
          const t = await get('/api/me/today');
          const rec = t.sessions.find((s) => s.id === session.id)?.record;
          if (rec) return showResult({ ok: true, late: rec.status === 'terlambat', title: `Tercatat ${STATUS_LABEL[rec.status].toLowerCase()}`, time: rec.server_time, message: session.title });
        } catch { /* tetap tampilkan gagal */ }
      }
      fail(e);
    }
  }

  stepLocation();
}

// ─────────────────────────────── Riwayat ───────────────────────────────
function renderHistory(root) {
  const body = shell(root, 'riwayat', html`<div class="loading">Memuat riwayat…</div>`);
  let month = new Date(serverNow().getTime() + 7 * 3600e3).toISOString().slice(0, 7);
  const thisMonth = month;
  const shift = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };

  const load = async () => {
    try {
      const h = await get(`/api/me/history?month=${month}`);
      const s = h.summary;
      const label = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T00:00:00Z'));
      const groups = [];
      for (const it of h.items) {
        if (!groups.length || groups.at(-1).date !== it.date) groups.push({ date: it.date, items: [] });
        groups.at(-1).items.push(it);
      }
      mount(body, html`
        <div class="month-nav">
          <button class="icon-btn" id="prev" aria-label="Bulan sebelumnya">${icon('back')}</button>
          <h2>${label}</h2>
          <button class="icon-btn" id="next" aria-label="Bulan berikutnya" ${month >= thisMonth ? raw('disabled') : ''}>${icon('chevron')}</button>
        </div>
        <div class="tally">
          <div><b>${s.hadir || 0}</b><span>Hadir</span></div>
          <div><b>${s.terlambat || 0}</b><span>Terlambat</span></div>
          <div><b>${(s.izin || 0) + (s.sakit || 0)}</b><span>Izin/sakit</span></div>
          <div><b>${s.alfa || 0}</b><span>Alfa</span></div>
        </div>
        ${groups.length === 0 ? html`<div class="panel"><div class="empty">${icon('history', 'i-lg')}<b>Belum ada riwayat bulan ini</b></div></div>`
          : groups.map((g) => html`<section class="day-group"><h3>${fmtDay(g.date)}</h3><ul class="panel list">${g.items.map((i) => html`
            <li><div class="grow"><b>${i.title}</b><small>${i.time ? `Pukul ${fmtClock(i.time, true)}` : i.status === 'belum' ? 'Masih dibuka' : 'Tidak ada catatan'}${i.manual ? ', dicatat petugas' : ''}${i.note ? `: ${i.note}` : ''}</small></div>
            ${statusChip(i.status)}</li>`)}</ul></section>`)}`);
      $('#prev', body).addEventListener('click', () => { month = shift(month, -1); load(); });
      $('#next', body).addEventListener('click', () => { if (month < thisMonth) { month = shift(month, 1); load(); } });
    } catch (e) {
      mount(body, html`<div class="panel"><div class="empty">${icon('alert', 'i-lg')}<b>Riwayat belum bisa dimuat</b><span>${e.message}</span></div></div>`);
    }
  };
  load();
}

// ─────────────────────────────── Akun ───────────────────────────────
function renderAccount(root) {
  const { user } = state.me;
  const body = shell(root, 'akun', html`
    <section class="hello"><h1>${user.name}</h1><div class="meta"><span class="tag">${user.username}</span>${user.class_name ? html`<span class="tag">Kelas ${user.class_name}</span>` : ''}</div></section>
    <ul class="panel list">
      <li>${icon('key')}<div class="grow"><b>Password</b><small>${user.is_default_password ? 'Masih NIS. Sebaiknya diganti.' : 'Sudah diganti dari NIS.'}</small></div><a class="btn btn-sm" href="#/password">Ganti</a></li>
      <li>${icon('face')}<div class="grow"><b>Data wajah</b><small>${user.face_enrolled ? 'Sudah terdaftar.' : 'Belum terdaftar. Hubungi wali kelas.'}</small></div>${user.face_enrolled ? statusChip('hadir', 'Terdaftar') : statusChip('belum', 'Belum')}</li>
    </ul>
    <section>
      <h2 class="section-title">Kesiapan HP</h2>
      <ul class="panel list" id="ready">
        <li data-k="loc">${icon('pin')}<div class="grow"><b>Izin lokasi</b><small>Untuk memastikan Anda di area sekolah.</small></div><button class="btn btn-sm" data-ask="loc">Periksa</button></li>
        <li data-k="cam">${icon('camera')}<div class="grow"><b>Izin kamera</b><small>Untuk verifikasi wajah.</small></div><button class="btn btn-sm" data-ask="cam">Periksa</button></li>
        <li data-k="app">${icon('download')}<div class="grow"><b>Pasang di layar utama</b><small>Buka aplikasi tanpa mengetik alamat.</small></div><button class="btn btn-sm" data-ask="app">Pasang</button></li>
      </ul>
    </section>
    <p class="small muted">Foto wajah tidak pernah disimpan atau dikirim. Saat presensi, HP hanya mengirim angka hasil olahan wajah, lokasi, dan waktu.</p>
    <button class="btn btn-danger btn-block" id="out">${icon('logout')} Keluar</button>`);

  const setRow = (k, ok, text) => {
    const li = $(`[data-k=${k}]`, body);
    li.querySelector('small').textContent = text;
    const b = li.querySelector('button');
    if (ok) b.replaceWith(Object.assign(document.createElement('span'), { className: 'st st-hadir', textContent: 'Siap' }));
  };
  (async () => {
    try { if ((await navigator.permissions.query({ name: 'geolocation' })).state === 'granted') setRow('loc', true, 'Lokasi sudah diizinkan.'); } catch { /* abaikan */ }
    try { if ((await navigator.permissions.query({ name: 'camera' })).state === 'granted') setRow('cam', true, 'Kamera sudah diizinkan.'); } catch { /* abaikan */ }
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) setRow('app', true, 'Aplikasi sudah terpasang.');
  })();

  body.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-ask]')?.dataset.ask;
    if (k === 'loc') {
      navigator.geolocation.getCurrentPosition(
        (p) => setRow('loc', true, `Lokasi terbaca, akurasi ±${Math.round(p.coords.accuracy)} m.`),
        (err) => toast(err.code === 1 ? 'Izin lokasi ditolak. Izinkan dari pengaturan situs browser.' : 'Lokasi belum terbaca. Nyalakan GPS lalu coba lagi.', 'error'),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      );
    } else if (k === 'cam') {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        s.getTracks().forEach((t) => t.stop());
        setRow('cam', true, 'Kamera sudah diizinkan.');
      } catch { toast('Izin kamera ditolak. Izinkan dari pengaturan situs browser.', 'error'); }
    } else if (k === 'app') {
      if (window.__installPrompt) { window.__installPrompt.prompt(); window.__installPrompt = null; }
      else toast('Buka menu browser, lalu pilih "Tambahkan ke layar utama".');
    }
  });
  $('#out', body).addEventListener('click', async () => {
    await post('/api/auth/logout').catch(() => {});
    state.me = null;
    go('#/masuk');
  });
  loadMe().catch(() => {});
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installPrompt = e; });
