# Panduan Memasang Aplikasi Presensi Siswa

Panduan ini untuk Anda yang **tidak memakai CMD, terminal, atau kode**. Semua langkah dilakukan lewat browser, dan semua layanan yang dipakai **gratis**.

Waktu yang dibutuhkan: sekitar 30 menit.

```
Folder proyek ──unggah──► GitHub (repository publik)
                                │
                     klik tombol "Deploy to Cloudflare"
                                ▼
       Cloudflare otomatis: membuat database & penyimpanan kunci,
       menerbitkan aplikasi, menyalin repository ke akun GitHub Anda
                                ▼
   https://presensi-siswa.namaanda.workers.dev ─► halaman instalasi ─► selesai
           (tabel database dibuat otomatis saat pertama dibuka)
```

---

## Langkah 0 — Bersihkan percobaan sebelumnya (lewati bila belum pernah mencoba)

Lakukan langkah ini **bila Anda pernah menekan tombol Deploy to Cloudflare** dengan versi lama. Tujuannya agar nama aplikasi dan repository tidak bentrok.

**Di Cloudflare** (https://dash.cloudflare.com):

1. Menu kiri **Compute (Workers)**, lalu **Workers & Pages**. Klik aplikasi **presensi-siswa**.
2. Buka tab **Settings**, gulir ke paling bawah, lalu klik **Delete**. Ketik nama aplikasinya untuk konfirmasi.
3. Menu kiri **Storage & Databases**, lalu **D1 SQL Database**. Hapus database dari percobaan sebelumnya: klik namanya, buka **Settings**, lalu **Delete**. Database ini masih kosong, jadi aman dihapus.
4. Menu kiri **Storage & Databases**, lalu **Workers KV**. Hapus namespace dari percobaan sebelumnya (biasanya bernama mirip `presensi-siswa-...` atau `KEYS`).

**Di GitHub** (https://github.com):

1. Buka **salinan repository** yang dulu dibuat Cloudflare. Klik **Settings**, gulir ke **Danger Zone**, klik **Delete this repository**, lalu ikuti konfirmasinya.
2. Lakukan hal yang sama untuk repository `presensi-siswa` yang Anda unggah pertama kali.

Setelah itu, mulai dari Langkah 1 seperti pemasangan baru.

---

## Langkah 1 — Siapkan dua akun gratis

1. **GitHub**: daftar di https://github.com/signup.
2. **Cloudflare**: daftar di https://dash.cloudflare.com/sign-up. Tidak perlu kartu kredit atau domain.

---

## Langkah 2 — Unggah folder proyek ke GitHub

1. Ekstrak file ZIP **terbaru**. Anda akan mendapat folder **presensi-siswa**.
2. Di GitHub, klik tombol **+** di kanan atas, lalu **New repository**.
   - Repository name: `presensi-siswa`
   - Pilih **Public**. Tombol Deploy to Cloudflare hanya bisa membaca repository publik. Repository ini tidak berisi data siswa atau kata sandi apa pun.
   - Jangan centang **Add a README file**.
   - Klik **Create repository**.
3. Di halaman repository yang masih kosong, klik tautan **uploading an existing file**.
4. Buka folder **presensi-siswa** di komputer. Pilih **semua isi di dalamnya** (tekan `Ctrl + A`; bukan folder itu sendiri), lalu seret ke halaman GitHub.
   - Pastikan file **`.dev.vars.example`** dan **`.gitignore`** ikut terunggah. Di Mac, tekan `Cmd + Shift + .` di Finder agar file berawalan titik terlihat.
   - Jumlahnya sekitar 74 file, masih di bawah batas 100 file sekali unggah.
5. Tunggu sampai semua file selesai diunggah, lalu klik **Commit changes**.
6. Periksa sekilas: di halaman depan repository harus terlihat folder `migrations`, `public`, `src`, dan file `wrangler.jsonc`. Kalau yang terlihat hanya satu folder `presensi-siswa`, berarti yang terunggah folder induknya. Hapus repository lalu ulangi poin 4.

---

## Langkah 3 — Buka tombol deploy

**Cara termudah:** ketik alamat ini di browser. Ganti `NAMA-AKUN-GITHUB` dengan nama akun GitHub Anda, yang terlihat di alamat repository:

```
https://deploy.workers.cloudflare.com/?url=https://github.com/NAMA-AKUN-GITHUB/presensi-siswa
```

Contoh: bila repository Anda `https://github.com/smkn1kerjo/presensi-siswa`, buka
`https://deploy.workers.cloudflare.com/?url=https://github.com/smkn1kerjo/presensi-siswa`

> Bila ingin tombolnya bisa diklik dari README: buka file **README.md** di repository, klik ikon pensil (**Edit**), ganti `NAMA-AKUN-GITHUB` dengan nama akun Anda, lalu **Commit changes**. Tombol oranye **Deploy to Cloudflare** di halaman depan repository kemudian langsung bisa dipakai.

---

## Langkah 4 — Isi formulir "Set up your application"

Masuk ke akun Cloudflare bila diminta. Bila muncul permintaan **Connect GitHub**, klik dan izinkan Cloudflare mengakses akun GitHub Anda.

Isi setiap bagian formulir sebagai berikut:

| Bagian di layar | Yang dilakukan |
| --- | --- |
| **Git account** | Pilih akun GitHub Anda. Cloudflare akan membuat **salinan repository** baru di akun ini dan menghubungkannya ke aplikasi. |
| **Create private Git repository** | Boleh dicentang, supaya salinannya tidak terlihat orang lain. |
| Nama proyek / repository | Biarkan `presensi-siswa`, atau ganti misalnya `presensi-smkn1kerjo`. Nama ini menjadi bagian alamat aplikasi. |
| **Penyimpanan kunci sistem** (*Select KV namespace*) | Biarkan **new**. |
| **Database presensi** (*Select D1 database*) | Biarkan **new**. |
| **Enable read replication** | Biarkan **mati**. |
| **Enable Preview builds** | Biarkan **mati**. |
| **Protect with Cloudflare Access** | **Harus mati.** Bila menyala, siswa tidak bisa membuka aplikasi tanpa login Cloudflare. |
| **Advanced settings** | Klik untuk membuka. Bila ada kolom **SETUP_CODE**, ganti nilai contoh `GANTI-dengan-kata-rahasia-anda` dengan kata rahasia pilihan Anda (minimal 10 karakter, misalnya `bakso-kantin-kerjo-2026`). Bila kolom ini **tidak ada**, tidak apa-apa; Anda akan mengisinya di Langkah 5. Kolom lain (Build command, Deploy command) **biarkan apa adanya**. |

Lalu klik **Create and deploy** dan tunggu 2–5 menit sampai status **Success**. Salin alamat aplikasi yang muncul, misalnya `https://presensi-siswa.namaanda.workers.dev`.

> Bila status **Failed**: klik **View build log**, salin seluruh isinya, lalu kirimkan ke pengembang.

---

## Langkah 5 — Isi kode instalasi (SETUP_CODE)

Buka alamat aplikasi.

**A. Bila langsung muncul "Buat akun admin pertama"**, berarti SETUP_CODE sudah terisi di Langkah 4. Lanjut ke Langkah 6.

**B. Bila muncul "Kode instalasi belum diatur"** (hal ini wajar), tambahkan kodenya dari dashboard:

1. Di https://dash.cloudflare.com, buka **Workers & Pages** dan klik **presensi-siswa**.
2. Buka tab **Settings**, cari bagian **Variables and Secrets**, lalu klik **Add**.
3. Isi kolomnya:
   - **Type**: pilih **Secret**.
   - **Variable name**: `SETUP_CODE`
   - **Value**: kata rahasia pilihan Anda, minimal 10 karakter, misalnya `bakso-kantin-kerjo-2026`.
4. Klik **Deploy** (atau **Save and deploy**).
   Bila `SETUP_CODE` sudah ada dengan nilai contoh `GANTI-dengan-kata-rahasia-anda`, klik ikon pensil di barisnya untuk mengganti nilainya.
5. Kembali ke halaman aplikasi, lalu klik **Muat ulang**.

**Catat kode ini.** Kode diminta sekali di langkah berikutnya.

### Mengapa harus ada kode instalasi?

Begitu terbit, alamat aplikasi bisa dibuka siapa saja. Tanpa kode ini, orang lain yang kebetulan membuka alamat itu sebelum Anda bisa membuat akun admin pertama dan menguasai aplikasi. Nilai contoh `GANTI-dengan-kata-rahasia-anda` sengaja ditolak aplikasi, karena terlihat publik di GitHub.

---

## Langkah 6 — Buat akun admin pertama

1. Di halaman **Buat akun admin pertama**, isi:
   - **Kode instalasi**: kode dari Langkah 4 atau 5.
   - **Nama lengkap admin**.
   - **Username**, misalnya `admin.tu`.
   - **Password**, minimal 10 karakter. Simpan di tempat aman.
2. Klik **Buat akun dan mulai**. Anda langsung masuk ke halaman Pengaturan.

Setelah ini halaman instalasi **tertutup permanen**. Tidak ada password bawaan yang sama di semua sekolah, dan tidak ada pendaftaran admin terbuka.

---

## Langkah 7 — Siapkan aplikasi untuk sekolah

Ikuti urutan di halaman **Hari ini** dalam aplikasi:

1. **Pengaturan**: isi titik lokasi sekolah (tombol "Isi dengan lokasi saya sekarang" saat Anda berada di tengah sekolah), radius, dan daftar IP Wi-Fi sekolah.
2. **Impor siswa**: unggah CSV dari Excel dengan kolom `nis;nama;kelas`. Username siswa otomatis `s` + NIS, password awal = NIS.
3. **Akun guru**: buat akun wali kelas, lalu cetak kartunya. Buat juga **satu superadmin cadangan** agar akses tidak hilang bila Anda lupa password.
4. **Data wajah**: dari foto kartu pelajar (lihat bagian *Data wajah dari foto* di bawah), atau dengan kamera per kelas bersama wali kelas.
5. **Jadwal**: buat jadwal Masuk dan Pulang (rutin Senin–Jumat).

---

## Data wajah dari foto kartu pelajar

Cara tercepat untuk satu sekolah. Foto **hanya dibaca di browser** komputer yang dipakai. Yang dikirim ke server hanya angka hasil olahan wajah, bukan fotonya.

1. Kumpulkan foto siswa dalam satu folder di laptop. Beri **nama file sesuai NIS**, misalnya `2425001.jpg`. Nama seperti `2425001 - Ahmad.jpg` atau `s2425001.jpg` juga dikenali.
2. Satu foto satu siswa, wajah menghadap depan, format JPG atau PNG, minimal sekitar 300 piksel. Foto dari iPhone (HEIC) perlu diubah ke JPG dulu.
3. Di aplikasi, buka **Data wajah**, klik **Impor dari foto**, lalu **Pilih folder foto**.
4. Periksa ringkasan (berapa foto yang cocok dengan NIS), lalu klik **Mulai impor**. Jangan tutup halaman selama proses berjalan. Sebagai gambaran, 864 foto di laptop biasa butuh sekitar 10–20 menit.
5. Di akhir muncul daftar foto yang gagal beserta alasannya (wajah tidak terdeteksi, lebih dari satu wajah, terlalu kecil). Daftar ini bisa diunduh. Siswa yang gagal bisa didaftarkan dengan kamera, atau fotonya diganti lalu diimpor lagi.

**Perlu diketahui:** kecocokan wajah bergantung pada kualitas dan umur foto. Foto kartu pelajar kelas X bisa berbeda dengan wajah siswa kelas XII. Di tabel Data wajah tertulis asal datanya (**Dari foto** atau **Dari kamera**). Bila seorang siswa sering ditolak saat presensi (terlihat di Rekap → Percobaan ditolak, alasan "Wajah tidak cocok"), daftarkan ulang siswa itu dengan kamera.

---

## Mengganti alamat aplikasi

Alamat aplikasi terdiri dari dua bagian: `NAMA-APLIKASI.SUBDOMAIN-AKUN.workers.dev`. Contoh: `presensi-siswa-sman1ker.namagithub.workers.dev`.

### Cara 1 — Ganti subdomain akun (gratis, 1 menit, data aman)

1. Di https://dash.cloudflare.com, buka **Workers & Pages**.
2. Klik **Change** di samping **Your subdomain** (bisa juga lewat tab **Domains** pada aplikasi).
3. Ketik nama baru, misalnya `sman1kerjo`, lalu simpan. Nama ini harus unik di seluruh Cloudflare.

Hasilnya: `presensi-siswa-sman1ker.sman1kerjo.workers.dev`. Alamat lama langsung tidak berlaku, jadi lakukan **sebelum** alamat dibagikan ke siswa. Pengguna yang sudah masuk perlu masuk ulang.

### Cara 2 — Ganti nama aplikasi (bagian depan)

Nama bagian depan berasal dari nama proyek yang diisi saat deploy. Mengganti nama aplikasi yang sudah berjalan **tidak disarankan**, karena penyimpanan kunci sistem ikut terikat pada nama itu. Selagi data masih sedikit, cara paling aman:

1. Di aplikasi lama: **Pengaturan → Unduh backup sekarang**.
2. Ikuti **Langkah 0** (hapus aplikasi lama), lalu **Langkah 3–6** dengan nama proyek pendek, misalnya `presensi`.
3. Di aplikasi baru: **Pengaturan → Pulihkan dari file backup**. Password siswa otomatis kembali ke NIS.

Digabung dengan Cara 1, hasilnya misalnya `presensi.sman1kerjo.workers.dev`.

### Cara 3 — Domain sekolah sendiri (misalnya `presensi.sman1kerjo.sch.id`)

Bisa, bila domain sekolah **dikelola lewat Cloudflare**: domain ditambahkan ke Cloudflare (paket Free) dengan mengganti nameserver di tempat domain terdaftar. Setelah itu buka aplikasi → tab **Domains** → tambahkan domain kustom. Langkah ini perlu dikoordinasikan dengan pengelola domain sekolah atau dinas, karena memindahkan nameserver memengaruhi seluruh situs dan email sekolah. Alternatifnya, beli domain murah khusus aplikasi (misalnya `.my.id`).

### Cara 4 — Tautan pendek dan QR (gratis, tanpa mengubah apa pun)

Buat tautan pendek di layanan seperti s.id, misalnya `s.id/presensi-sman1kerjo`, lalu cetak kode QR-nya di kelas. Siswa cukup membuka sekali, lalu memasang aplikasi ke layar utama HP (menu Akun → Pasang di layar utama). Setelah itu mereka tidak perlu mengetik alamat lagi.

---

## Memperbarui aplikasi

Cloudflare sudah membuat **salinan repository di akun GitHub Anda** (nama yang Anda isi di Langkah 4). **Salinan inilah** yang terhubung ke Cloudflare, bukan repository yang Anda unggah di Langkah 2.

1. Buka salinan repository itu di GitHub.
2. Klik **Add file → Upload files**, lalu seret file versi baru. File bernama sama otomatis tertimpa. Klik **Commit changes**.
3. Cloudflare otomatis membangun dan menerbitkan ulang dalam 1–3 menit. Statusnya bisa dilihat di Workers & Pages → presensi-siswa → **Deployments**.

**Data siswa tetap aman.** Database yang sama dipakai terus. Saat versi baru pertama kali dibuka, aplikasi hanya menambahkan tabel yang belum ada, dan nomor versinya tercatat di tabel `_app_schema`. Tabel dan data lama tidak pernah dihapus. Aplikasi di HP siswa ikut diperbarui otomatis.

Repository dari Langkah 2 boleh dihapus atau dijadikan Private setelah deploy berhasil.

---

## Backup dan pemulihan

| Cara | Kapan dipakai | Tindakan |
| --- | --- | --- |
| **Unduh backup dari aplikasi** | Rutin, misalnya tiap Jumat | Pengaturan → **Unduh backup sekarang**. Simpan file `.json` di tempat yang tidak dibagikan (berisi data wajah). |
| **Backup otomatis ke Google Drive** (opsional) | Setiap malam pukul 23.00 | Lihat bagian Google Sheets di bawah. |
| **Pulihkan dari file backup** | Data rusak, terhapus, atau pindah ke akun Cloudflare baru | Pengaturan → **Pulihkan dari file backup** → pilih file → ketik `PULIHKAN`. |

Hal yang perlu diketahui saat memulihkan:

- Seluruh data saat ini **diganti** dengan isi file. Akun superadmin yang sedang memulihkan tetap dipakai.
- Paket gratis membatasi **100.000 baris ditulis per hari**. Backup satu tahun bisa melebihi itu. Bila kuota habis, pemulihan berhenti dengan aman. Pilih file yang sama keesokan harinya untuk melanjutkan.
- Memulihkan ke **instalasi baru** memakai kunci sistem yang berbeda, jadi password lama tidak berlaku. Aplikasi otomatis mengembalikan password siswa ke **NIS**. Password guru direset satu per satu di menu Akun guru.
- Cloudflare juga menyimpan riwayat database 7 hari (Time Travel). Pemulihannya membutuhkan perintah teknis, jadi anggap ini cadangan terakhir yang dikerjakan teknisi.

---

## Ekspor otomatis ke Google Sheets (opsional)

Aplikasi berjalan normal tanpa fitur ini.

1. Di aplikasi, buka **Pengaturan → Ekspor otomatis**, lalu klik **Aktifkan dan buat kunci**. Salin kunci yang tampil; kunci ini hanya ditampilkan sekali.
2. Buat Google Spreadsheet baru, lalu buka **Ekstensi → Apps Script**.
3. Hapus isi editor, tempel seluruh isi file `gas/ExportPresensi.gs`, lalu simpan.
4. Klik ikon roda gigi (**Project Settings**), buka **Script properties**, dan tambahkan:
   - `BASE_URL`: alamat aplikasi tanpa `/` di akhir.
   - `EXPORT_KEY`: kunci dari poin 1.
   - `BACKUP_FOLDER_ID` (opsional): ID folder Google Drive untuk backup, yaitu bagian alamat folder setelah `folders/`. Jangan bagikan folder ini.
5. Kembali ke editor, pilih fungsi **setupTriggers**, klik **Run**, lalu berikan izin.

Rekap harian masuk ke Spreadsheet setiap pukul 16.30 WIB, dan backup ke Drive setiap pukul 23.00 WIB.

---

## Batas paket gratis Cloudflare

| Batas | Nilai | Untuk 864 siswa |
| --- | --- | --- |
| Permintaan aplikasi | 100.000 per hari (reset 07.00 WIB) | Pemakaian normal sekitar 20.000 |
| Baris database ditulis | 100.000 per hari | Presensi harian sekitar 10.000 |
| Ukuran satu database | 500 MB | Sekitar 100 MB per tahun ajaran; unduh backup dan arsipkan setiap tahun |
| Riwayat database (Time Travel) | 7 hari | Lengkapi dengan backup mingguan |
| Build otomatis dari GitHub | 3.000 menit per bulan | Satu build sekitar 1 menit |

Jika kuota harian sering habis, upgrade ke **Workers Paid (US$5/bulan)** di dashboard. Tidak ada perubahan pada aplikasi.

---

## Tindakan yang tetap harus dilakukan manual

| # | Tindakan | Alasan tidak bisa otomatis |
| --- | --- | --- |
| 1 | Membuat akun GitHub dan Cloudflare | Akun harus milik sekolah/Anda sendiri. |
| 2 | Mengunggah folder ke GitHub sebagai repository Public | Syarat tombol Deploy to Cloudflare. |
| 3 | Membuka alamat deploy dengan nama akun GitHub Anda | Alamat repository baru diketahui setelah Anda membuatnya. |
| 4 | Mengisi **SETUP_CODE** (di formulir deploy atau dashboard) | Pengaman agar hanya Anda yang bisa membuat admin pertama. Sengaja tidak dibuat otomatis. |
| 5 | Membuat akun admin di halaman instalasi | Password admin harus dibuat sendiri; tidak ada password bawaan. |
| 6 | Mengisi lokasi sekolah, impor siswa, jadwal, mendaftarkan wajah | Data khas sekolah Anda. |
| 7 | (Opsional) Google Sheets, domain sekolah sendiri | Fitur tambahan. |

**Yang sudah otomatis:** pembuatan database D1, penyimpanan kunci (KV), semua tabel database, kunci pengaman password (dibuat acak saat instalasi), penerbitan aplikasi, sertifikat HTTPS, salinan repository dan deploy ulang setiap ada perubahan, pembaruan aplikasi di HP siswa, dan pembersihan data kedaluwarsa setiap tengah malam.

---

## Jika ada masalah

| Gejala | Penyebab dan solusi |
| --- | --- |
| Deploy **Failed** | Klik **View build log**, salin seluruh isinya, lalu kirimkan ke pengembang. |
| Error "KV namespace ... not found" | Masih memakai versi lama. Ikuti Langkah 0, lalu unggah isi ZIP terbaru. |
| Nama aplikasi `presensi-siswa` sudah dipakai | Worker lama belum dihapus (Langkah 0), atau pakai nama lain di formulir deploy. |
| "Kode instalasi belum diatur" | Ikuti Langkah 5B. |
| "Terlalu banyak kode salah" | Tunggu 15 menit. |
| Siswa diminta login Cloudflare saat membuka aplikasi | **Cloudflare Access** menyala. Matikan di Settings → Domains & Routes (atau bagian Access) pada aplikasi. |
| Lupa password superadmin | Minta superadmin cadangan mereset dari menu Akun guru. |
| "Kunci sistem tidak ditemukan" | Penyimpanan KV terhapus. Buka alamat aplikasi; setelah 10 menit muncul halaman pemulihan yang meminta kode instalasi. Setelah itu reset password siswa dari Pengaturan. |
| Siswa: "Server sedang tidak dapat melayani" | Kuota harian habis. Pakai presensi manual. Kuota pulih pukul 07.00 WIB. |
