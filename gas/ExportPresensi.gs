/**
 * Ekspor rekap presensi harian + backup database ke Google Sheets/Drive.
 * Skrip ini hanya MENARIK data dari Worker sekali-dua kali sehari. Ia tidak berada di jalur presensi siswa.
 *
 * Pemasangan (sekali):
 * 1. Buat Google Spreadsheet baru, misalnya "Rekap Presensi 2026/2027". Buka Ekstensi → Apps Script.
 * 2. Tempel seluruh file ini, simpan.
 * 3. Di aplikasi presensi: Pengaturan → Ekspor otomatis → "Aktifkan dan buat kunci". Salin kuncinya.
 * 4. Di Apps Script: Project Settings → Script properties, isi:
 *      BASE_URL          alamat aplikasi, misalnya https://presensi-siswa.namaanda.workers.dev (tanpa / di akhir)
 *      EXPORT_KEY        kunci dari langkah 3
 *      BACKUP_FOLDER_ID  (opsional) ID folder Google Drive khusus backup. JANGAN dibagikan: berisi data biometrik.
 * 5. Pilih fungsi setupTriggers di toolbar, klik Run, lalu berikan izin.
 *    Rekap harian otomatis pukul 16.30 WIB, backup pukul 23.00 WIB.
 * 6. Untuk mengisi ulang tanggal tertentu: jalankan exportDate('2026-11-16') dari editor.
 */

const TZ = 'Asia/Jakarta';

function props_() {
  const p = PropertiesService.getScriptProperties();
  const base = (p.getProperty('BASE_URL') || '').replace(/\/+$/, '');
  const key = p.getProperty('EXPORT_KEY');
  if (!base || !key) throw new Error('Isi BASE_URL dan EXPORT_KEY di Script properties.');
  return { base, key, folder: p.getProperty('BACKUP_FOLDER_ID') };
}

function fetchJson_(path) {
  const { base, key } = props_();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = UrlFetchApp.fetch(base + path, { headers: { 'X-Export-Key': key }, muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code < 500 || attempt === 3) throw new Error('Gagal ' + path + ' (' + code + '): ' + res.getContentText().slice(0, 200));
    Utilities.sleep(2000 * attempt);
  }
}

/** Dipanggil trigger harian. */
function exportToday() {
  exportDate(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
}

/** Menulis rekap satu tanggal ke tab bulan (mis. "2026-11"). Aman diulang: baris tanggal itu diganti. */
function exportDate(date) {
  const data = fetchJson_('/api/export/daily?date=' + encodeURIComponent(date));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const name = date.slice(0, 7);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(data.header);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, data.header.length).setFontWeight('bold');
  }
  const last = sh.getLastRow();
  if (last > 1) {
    const dates = sh.getRange(2, 1, last - 1, 1).getDisplayValues().map((r) => r[0]);
    for (let i = dates.length - 1; i >= 0; i--) if (dates[i] === date) sh.deleteRow(i + 2);
  }
  if (data.rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, data.rows.length, data.header.length).setNumberFormat('@').setValues(data.rows);
  }
  Logger.log('%s: %s baris', date, data.rows.length);
}

/** Backup semua tabel ke satu file JSON di Drive; menyimpan 30 file terakhir. */
function backupAll() {
  const { folder } = props_();
  if (!folder) { Logger.log('BACKUP_FOLDER_ID kosong: backup Drive dilewati.'); return; }
  const meta = fetchJson_('/api/export/backup');
  // Format sama dengan "Unduh backup" di aplikasi, sehingga bisa dipulihkan dari menu Pengaturan.
  const out = { format: meta.format, created_at: new Date().toISOString(), key_check: meta.key_check, tables: {} };
  meta.tables.forEach((t) => {
    out.tables[t] = [];
    let after = '';
    for (;;) {
      const page = fetchJson_('/api/export/backup?table=' + t + '&after=' + encodeURIComponent(after));
      out.tables[t] = out.tables[t].concat(page.rows);
      if (page.done) break;
      after = page.next;
    }
  });
  const dir = DriveApp.getFolderById(folder);
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd_HHmm');
  dir.createFile('backup-presensi-' + stamp + '.json', JSON.stringify(out), 'application/json');

  const files = [];
  const it = dir.getFilesByType('application/json');
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf('backup-presensi-') === 0) files.push(f); }
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  files.slice(30).forEach((f) => f.setTrashed(true));
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('exportToday').timeBased().atHour(16).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('backupAll').timeBased().atHour(23).everyDays(1).inTimezone(TZ).create();
}
