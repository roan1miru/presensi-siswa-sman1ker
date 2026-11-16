// Waktu resmi sekolah: Asia/Jakarta (UTC+7, tanpa daylight saving). Jam HP siswa tidak pernah dipakai.
const OFFSET = 7 * 60 * 60 * 1000;

/** { date:'YYYY-MM-DD', minutes: menit sejak 00.00 WIB, weekday: 1=Senin … 7=Minggu, hhmm:'HH:MM' } */
export function jakarta(ms = Date.now()) {
  const d = new Date(ms + OFFSET);
  const date = d.toISOString().slice(0, 10);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return { date, minutes, weekday, hhmm: d.toISOString().slice(11, 16) };
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function weekdayOf(date) {
  const d = new Date(date + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Epoch ms untuk tanggal + jam WIB. */
export function jakartaMs(date, hhmm) {
  return Date.parse(`${date}T${hhmm}:00Z`) - OFFSET;
}
