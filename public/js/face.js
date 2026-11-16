// Mesin wajah di browser (face-api / TF.js). Gambar kamera hanya hidup di memori HP:
// tidak disimpan, tidak dikirim. Yang keluar dari modul ini hanya angka (descriptor 128 dimensi).

export const MODEL_ID = 'faceapi-resnet128-v1';
let faceapi = null;
let loading = null;

/** Memuat pustaka + 3 model (±8 MB, di-cache service worker). onProgress(0..1). */
export function loadFaceEngine(onProgress = () => {}) {
  if (loading) return loading;
  loading = (async () => {
    onProgress(0.05);
    faceapi = await import('/vendor/face-api/face-api.esm.js');
    onProgress(0.2);
    try {
      await faceapi.tf.setBackend('webgl');
    } catch {
      await faceapi.tf.setBackend('cpu');
    }
    await faceapi.tf.ready();
    if (faceapi.tf.getBackend() !== 'webgl') await faceapi.tf.setBackend('cpu');
    await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
    onProgress(0.35);
    await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
    onProgress(0.5);
    await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
    onProgress(1);
    return faceapi;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

export const engineBackend = () => faceapi?.tf.getBackend() ?? null;

// ───── Kamera ─────
export async function startCamera(video, facing = 'user') {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Browser ini tidak mendukung kamera. Gunakan Chrome atau Safari versi terbaru.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('Izin kamera ditolak. Buka pengaturan situs di browser, izinkan kamera, lalu coba lagi.');
    if (e.name === 'NotFoundError') throw new Error('Kamera depan tidak ditemukan di perangkat ini.');
    throw new Error('Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera lalu coba lagi.');
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  await new Promise((r) => (video.readyState >= 2 ? r() : video.addEventListener('loadeddata', r, { once: true })));
  return stream;
}

/** Mematikan kamera dan melepas semua referensi frame. */
export function stopCamera(video) {
  const stream = video?.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (video) {
    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
  }
  if (lumaCanvas) {
    lumaCanvas.getContext('2d').clearRect(0, 0, lumaCanvas.width, lumaCanvas.height);
    lumaCanvas.width = lumaCanvas.height = 0;
    lumaCanvas = null;
  }
}

// ───── Pengukuran ─────
let lumaCanvas = null;
function brightness(video) {
  lumaCanvas ??= Object.assign(document.createElement('canvas'), { width: 24, height: 24 });
  const ctx = lumaCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  ctx.clearRect(0, 0, 24, 24);
  return sum / (d.length / 4);
}

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function eyeAspect(pts) {
  return (dist2(pts[1], pts[5]) + dist2(pts[2], pts[4])) / (2 * dist2(pts[0], pts[3]));
}
/** Rasio posisi hidung di antara tepi rahang: 0,5 = menghadap lurus. */
function yawRatio(p) {
  const left = p[0].x, right = p[16].x;
  return (p[30].x - left) / (right - left);
}

/**
 * Satu kali analisis frame. Mengembalikan { ok, hint, faces, metrics, detection }.
 * withDescriptor=true juga menghitung descriptor (lebih berat, dipanggil seperlunya).
 */
export async function analyze(video, { withDescriptor = false } = {}) {
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const all = await faceapi.detectAllFaces(video, opts).withFaceLandmarks();
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  if (all.length === 0) return { ok: false, hint: 'Wajah belum terlihat. Arahkan wajah ke dalam bingkai.', faces: 0 };
  if (all.length > 1) return { ok: false, hint: 'Terlihat lebih dari satu wajah. Pastikan hanya Anda di depan kamera.', faces: all.length };
  const det = all[0];
  const box = det.detection.box;
  const pts = det.landmarks.positions;
  const size = box.width / vw;
  const cx = (box.x + box.width / 2) / vw;
  const cy = (box.y + box.height / 2) / vh;
  const luma = brightness(video);
  const metrics = {
    size, luma,
    ear: (eyeAspect(pts.slice(36, 42)) + eyeAspect(pts.slice(42, 48))) / 2,
    yaw: yawRatio(pts),
    score: det.detection.score,
  };
  let hint = null;
  if (luma < 55) hint = 'Terlalu gelap. Hadapkan wajah ke arah cahaya.';
  else if (luma > 225) hint = 'Terlalu silau. Hindari cahaya langsung di belakang atau depan kamera.';
  else if (size < 0.26) hint = 'Dekatkan wajah ke kamera.';
  else if (size > 0.75) hint = 'Jauhkan sedikit wajah dari kamera.';
  else if (Math.abs(cx - 0.5) > 0.18 || Math.abs(cy - 0.5) > 0.2) hint = 'Posisikan wajah di tengah bingkai.';
  const out = { ok: !hint, hint, faces: 1, metrics };
  if (withDescriptor && out.ok) {
    const full = await faceapi.detectSingleFace(video, opts).withFaceLandmarks().withFaceDescriptor();
    out.descriptor = full ? Array.from(full.descriptor, (x) => Math.round(x * 1e6) / 1e6) : null;
  }
  return out;
}

export const frontal = (m) => Math.abs(m.yaw - 0.5) < 0.09;

/**
 * Pemeriksa tantangan liveness berbasis landmark.
 * blink: rasio mata turun ke ≤ 65% nilai normal lalu kembali.
 * turn_left / turn_right: arah dari sudut pandang siswa (gambar kamera belum dicerminkan).
 */
export function challengeTracker(kind) {
  let base = null;
  let closed = false;
  return {
    kind,
    update(m) {
      if (kind === 'blink') {
        if (base === null && frontal(m)) base = m.ear;
        if (base === null) return false;
        if (!closed && m.ear < base * 0.65) closed = true;
        if (closed && m.ear > base * 0.85) return true;
        if (!closed) base = base * 0.9 + m.ear * 0.1;
        return false;
      }
      // Siswa menoleh ke kirinya → hidung bergeser ke kanan gambar mentah → rasio membesar.
      if (kind === 'turn_left') return m.yaw > 0.64;
      if (kind === 'turn_right') return m.yaw < 0.36;
      return false;
    },
  };
}

export const CHALLENGE_TEXT = {
  blink: { title: 'Kedipkan mata', hint: 'Pejamkan mata sebentar lalu buka kembali.' },
  turn_left: { title: 'Tolehkan kepala ke kiri', hint: 'Putar kepala perlahan ke arah kiri Anda.' },
  turn_right: { title: 'Tolehkan kepala ke kanan', hint: 'Putar kepala perlahan ke arah kanan Anda.' },
};
export const CHALLENGE_SHORT = { blink: 'Kedip', turn_left: 'Kiri', turn_right: 'Kanan' };

export const descriptorDistance = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

/** Overlay bingkai oval (SVG). */
export const ovalOverlay = `<svg class="oval" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><mask id="oval-cut"><rect width="300" height="400" fill="white"/><ellipse cx="150" cy="190" rx="98" ry="130" fill="black"/></mask></defs>
  <rect class="mask" width="300" height="400" mask="url(#oval-cut)"/>
  <ellipse class="guide" cx="150" cy="190" rx="98" ry="130"/>
</svg>`;
