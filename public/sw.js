// Service worker: cache tampilan aplikasi agar cepat dibuka. API tidak pernah di-cache.
// Naikkan VERSION setiap deploy yang mengubah file frontend.
const VERSION = 'v1.0.0';
const CACHE = `presensi-${VERSION}`;
const SHELL = [
  '/', '/styles.css', '/manifest.webmanifest',
  '/fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/face.js',
  '/js/views/login.js', '/js/views/student.js',
  '/icons/icon.svg', '/icons/icon-192.png',
];
// Model wajah (±8 MB) tidak dimasukkan ke SHELL agar pemasangan cepat; diunduh saat beranda siswa
// sedang diam (requestIdleCallback) lalu disimpan oleh aturan cache-first di bawah.

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('presensi-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  // Halaman: jaringan dulu (agar selalu versi terbaru), cache bila offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  // Aset statis (termasuk model ONNX pada tahap 3): cache dulu, perbarui di latar belakang.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fresh;
    }),
  );
});
