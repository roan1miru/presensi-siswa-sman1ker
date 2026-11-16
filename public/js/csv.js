// Parser CSV kecil: mendukung tanda kutip, baris baru di dalam kutip, dan pemisah , ; atau Tab
// (Excel berbahasa Indonesia biasanya menyimpan CSV dengan titik koma).

export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const ALIASES = {
  nis: ['nis', 'no induk', 'nomor induk', 'no. induk', 'nipd'],
  name: ['nama', 'nama siswa', 'nama lengkap', 'name'],
  class_name: ['kelas', 'rombel', 'rombongan belajar', 'class'],
};

/** Mengubah CSV menjadi [{nis, name, class_name, line}] + daftar masalah per baris. */
export function parseStudents(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { students: [], problems: ['File kosong atau hanya berisi judul kolom.'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(ALIASES)) idx[key] = header.findIndex((h) => names.includes(h));
  const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => ({ nis: 'nis', name: 'nama', class_name: 'kelas' })[k]);
  if (missing.length) return { students: [], problems: [`Kolom tidak ditemukan: ${missing.join(', ')}. Baris pertama harus berisi judul nis;nama;kelas.`] };

  const students = [];
  const problems = [];
  const seen = new Map();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const s = {
      nis: (r[idx.nis] || '').trim(),
      name: (r[idx.name] || '').trim().replace(/\s+/g, ' '),
      class_name: (r[idx.class_name] || '').trim().replace(/\s+/g, ' '),
      line,
    };
    if (!/^[0-9A-Za-z]{3,20}$/.test(s.nis)) problems.push(`Baris ${line}: NIS "${s.nis}" harus 3–20 angka/huruf.`);
    else if (seen.has(s.nis)) problems.push(`Baris ${line}: NIS ${s.nis} sudah ada di baris ${seen.get(s.nis)}.`);
    else if (s.name.length < 2) problems.push(`Baris ${line}: nama kosong.`);
    else if (!s.class_name) problems.push(`Baris ${line}: kelas kosong.`);
    else { seen.set(s.nis, line); students.push(s); }
  });
  return { students, problems };
}

export function toCsv(rows, delimiter = ';') {
  const q = (v) => {
    const s = String(v ?? '');
    return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(q).join(delimiter)).join('\r\n');
}
