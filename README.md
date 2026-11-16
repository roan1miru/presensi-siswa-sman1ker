# Presensi Siswa — Cloudflare Workers + D1

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/NAMA-AKUN-GITHUB/presensi-siswa)

> Ganti `NAMA-AKUN-GITHUB` pada tautan di atas dengan nama akun GitHub tempat repository ini diunggah. **Panduan lengkap tanpa CMD ada di [PANDUAN_DEPLOY.md](PANDUAN_DEPLOY.md).**

Aplikasi presensi siswa berbasis web (PWA) dengan pemeriksaan **lokasi GPS**, **verifikasi wajah di HP**, **gerakan acak (liveness)**, dan opsi **wajib Wi-Fi sekolah**. Semua berjalan di paket **gratis** Cloudflare.

## Pemasangan satu klik

1. Unggah folder ini ke repository **publik** GitHub.
2. Klik tombol **Deploy to Cloudflare** di atas, hubungkan GitHub dan Cloudflare, lalu isi **SETUP_CODE** (kata rahasia pilihan Anda).
3. Cloudflare otomatis membuat database D1 dan penyimpanan KV, menerbitkan aplikasi, dan menyalin repository ke akun Anda dengan deploy otomatis (Workers Builds). Tabel dibuat sendiri oleh aplikasi saat pertama kali dibuka.
4. Buka alamat aplikasi. Halaman instalasi meminta SETUP_CODE, lalu Anda membuat akun admin pertama.

Tidak perlu Node.js, Wrangler, CMD, menyalin `database_id`, atau membuat kunci rahasia sendiri.

| Hal | Cara otomatisnya |
| --- | --- |
| Database & KV | Binding ditulis **tanpa ID**; Wrangler (≥ 4.45, provisioning otomatis) membuat D1 `presensi-db` dan KV `KEYS` saat deploy pertama dan menautkannya pada deploy berikutnya. |
| Tabel | Worker menjalankan migrasi sendiri (`src/lib/migrate.js`) pada permintaan pertama: file `migrations/*.sql` idempoten, versi dicatat di `_app_schema`, data tidak dihapus. Tidak bergantung pada deploy command (`npx wrangler deploy` atau `npm run deploy`). |
| Kunci password (pepper) | Dibuat acak (CSPRNG, 256 bit) saat instalasi, disimpan di KV `KEYS`, terpisah dari D1. Tidak ada secret di repository. |
| Admin pertama | Halaman instalasi, atomik (tabel `setup_state` id tunggal), dilindungi SETUP_CODE, tertutup permanen setelah selesai. |
| Ekspor Google Sheets | Opsional; kunci dibuat dari menu Pengaturan (hanya hash disimpan). |
| Cache PWA | `sw.js` diberi ID versi deploy otomatis (`version_metadata`). |

## Fitur
**Siswa (HP)**
- Login `s` + NIS (contoh `s2425001`), password awal = NIS. Bisa diganti sendiri; admin/wali bisa mengembalikannya ke NIS.
- Beranda: jam server WIB, linimasa sesi hari ini (masuk, pulang, kegiatan) beserta statusnya.
- Alur presensi: cincin geofence (jarak dan akurasi), kamera dengan bingkai oval, 2 gerakan acak (kedip/menoleh), lalu hasil.
- Riwayat bulanan dengan rekap hadir/terlambat/izin/alfa. Halaman akun dengan cek kesiapan izin lokasi/kamera.

**Admin & wali kelas (desktop/HP)**
- **Hari ini:** sebaran status per sesi dan per kelas, presensi terbaru, jumlah percobaan ditolak. Diperbarui tiap 30 detik.
- **Rekap:** daftar siswa per tanggal/sesi/kelas, presensi manual massal (hadir/izin/sakit/alfa, wajib keterangan), log percobaan ditolak, unduh CSV.
- **Jadwal:** rutin mingguan atau sekali; jam buka, batas terlambat, tutup; kelas peserta; titik dan radius di peta; aturan wajah/gerakan/Wi-Fi. Daftar hari libur.
- **Siswa:** filter password masih NIS, wajah belum, akun terkunci; reset ke NIS; buka kunci; ubah kelas; nonaktifkan; cetak kartu login.
- **Data wajah:** pendaftaran beruntun satu kelas dengan kamera depan/belakang; menolak sampel yang tidak konsisten dan wajah yang sama dengan siswa lain sekelas.
- **Kelas, Impor CSV, Akun guru, Pengaturan** (lokasi sekolah, IP Wi-Fi, ambang wajah, wajib ganti password).
- Wali kelas hanya melihat dan mengubah data kelas yang ia ampu. Batas ini ditegakkan di query server.

## Cara kerja verifikasi wajah

1. Model `face-api` (TF.js, MIT) berjalan di browser: deteksi wajah, 68 titik landmark, descriptor 128 angka.
2. **Foto tidak pernah keluar dari HP.** Saat presensi, HP mengirim 2 descriptor (sebelum dan sesudah gerakan), koordinat, dan token.
3. **Pencocokan dilakukan di server** terhadap template yang tidak pernah dikirim ke HP mana pun. Siswa tidak bisa mengambil template wajahnya sendiri atau milik orang lain.
4. Gerakan acak ditentukan server per token. Ini penghalang untuk foto diam, bukan anti-deepfake.

## Struktur

```
migrations/                   0001 skema utama, 0002 instalasi/pemulihan. Idempoten; file baru wajib didaftarkan di src/lib/migrate.js
src/index.js                  Router + cron pembersihan harian
src/lib/                      crypto, sesi, waktu WIB, geo/IP, konfigurasi, cakupan peran
src/routes/                   setup, auth, admin, schedules, face, attendance, export, maintenance
public/                       PWA tanpa framework; js/views/* per halaman; models/ (±7 MB); vendor/ (face-api, Leaflet)
gas/ExportPresensi.gs         Google Apps Script (opsional): rekap harian ke Sheets + backup JSON ke Drive
scripts/demo-data.mjs         data contoh untuk uji lokal
test/                         smoke.mjs (28 kelompok uji API), maintenance.mjs (backup/pemulihan)
.dev.vars.example             daftar secret yang diminta formulir deploy (hanya SETUP_CODE)
```

## Pengembangan lokal (opsional, untuk teknisi)

```bash
npm install
echo 'SETUP_CODE="kode-uji-lokal-2026"' > .dev.vars
npm run dev                       # http://localhost:8787 → tabel dibuat otomatis → halaman instalasi
npm run test:smoke                # 28 kelompok uji API (database lokal bersih)
node test/maintenance.mjs         # backup/pemulihan (setelah smoke)
npm run demo:local                # opsional: 72 siswa contoh
```

## Keputusan keamanan

| Hal | Implementasi |
| --- | --- |
| Password | `PBKDF2-SHA256(HMAC(kunci_sistem, password), salt acak 128-bit per pengguna, iter)`; kunci sistem 256-bit dari KV. Password pilihan pengguna 10.000 iterasi (±1,4 ms); password NIS/sementara 1.000 iterasi agar impor 20 siswa per permintaan tetap di bawah batas CPU 10 ms. |
| Password awal = NIS | Mudah ditebak teman sekelas. Mitigasi: **Pengaturan → wajibkan ganti password saat masuk pertama** (bawaan aktif), penguncian 5 kali salah selama 15 menit, dan peringatan di beranda selama password masih NIS. |
| Sesi | Cookie `__Host-sid` HttpOnly, Secure, SameSite=Strict; D1 menyimpan SHA-256 token. Siswa 14 hari, staf 12 jam. |
| CSRF | SameSite=Strict + wajib JSON + cek `Origin`. |
| Presensi | Token sekali pakai 3 menit; 9 pemeriksaan server (jadwal, waktu server, GPS ≤ 2 menit, akurasi, Haversine, IP sekolah, wajah, gerakan); `UNIQUE(jadwal, tanggal, siswa)`. Maks. 15 percobaan per sesi. |
| Header | CSP ketat (tanpa inline script/style), `Permissions-Policy` kamera/lokasi hanya origin sendiri, `X-Frame-Options: DENY`. |
| Data | Log percobaan dihapus setelah 180 hari, audit 400 hari (cron 00.00 WIB). |

## Batas yang perlu diketahui

- **Liveness dan descriptor tetap dihitung di HP.** Orang yang memodifikasi JavaScript bisa memalsukan gerakan, tetapi tetap butuh descriptor wajah pemilik akun (template tidak pernah dikirim ke HP). Untuk bukti hadir terkuat, aktifkan **Wajib Wi-Fi sekolah**.
- **GPS browser bisa dipalsukan** dengan aplikasi mock location. Ini alasan opsi Wi-Fi sekolah ada.
- **Ambang wajah 0,50 adalah titik awal.** Tetapkan dari data pilot: catat salah tolak dan salah terima, lalu atur di Pengaturan.
- **Arah gerakan menoleh** dihitung dari gambar kamera depan yang belum dicerminkan. Uji di beberapa HP saat pilot.
- **Lisensi bobot model:** kode face-api berlisensi MIT; bobot model pengenal wajahnya berasal dari dlib. Periksa ketentuannya sebelum dipakai resmi.
- **Ekspor seluruh sekolah dibatasi 7 hari** (satu kelas: 62 hari) agar tetap di bawah batas CPU paket gratis.
- **Kuota harian Cloudflare direset pukul 07.00 WIB.** Sebaiknya jam buka sesi masuk tidak tepat di sekitar jam itu.
- **Peta jadwal memakai tile OpenStreetMap** yang hanya dibutuhkan admin saat mengatur titik.
- Paket gratis: database maksimal 500 MB (±100 MB per tahun ajaran), riwayat Time Travel 7 hari.
