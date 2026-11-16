// Utilitas kriptografi. Hanya memakai Web Crypto, jadi berjalan sama di Workers dan Node 20+.

const enc = new TextEncoder();

export const ITER_PERMANENT = 10_000; // password pilihan pengguna (±1,4 ms CPU)
export const ITER_TEMPORARY = 1_000;  // password awal = NIS / sandi sementara (±0,3 ms CPU)

export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** Bilangan bulat acak seragam di [0, max) tanpa bias modulo. */
export function randomInt(max) {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

/** Kata sandi sementara untuk guru/admin: 10 karakter tanpa huruf yang mirip (0/O, 1/l). */
export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export function isWeakPin(pin) {
  if (/^(\d)\1+$/.test(pin)) return true; // 000000, 111111
  const asc = '01234567890123456789';
  const desc = '98765432109876543210';
  if (asc.includes(pin) || desc.includes(pin)) return true; // 123456, 654321
  const common = ['123123', '112233', '121212', '010101', '696969', '520520'];
  return common.includes(pin);
}

/**
 * hash = PBKDF2-SHA256( HMAC-SHA256(PEPPER, password), salt, iter ).
 * PEPPER adalah secret Worker; tanpa itu, isi database saja tidak cukup untuk menebak PIN.
 */
export async function hashPin(pin, saltHex, iterations, pepper) {
  if (!pepper || pepper.length < 32) throw new Error('Kunci sistem belum tersedia.');
  const hmacKey = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const peppered = await crypto.subtle.sign('HMAC', hmacKey, enc.encode(pin.normalize('NFC')));
  const baseKey = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, baseKey, 256);
  return toHex(bits);
}

export async function makePassRecord(password, pepper, iterations) {
  const salt = randomHex(16);
  return { pass_hash: await hashPin(password, salt, iterations, pepper), pass_salt: salt, pass_iter: iterations };
}

export function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
