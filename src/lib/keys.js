// Kunci sistem ("pepper") untuk hashing password.
// Dibuat acak sekali saat instalasi lalu disimpan di Workers KV (binding KEYS), TERPISAH dari D1.
// Akibatnya file ekspor/backup database saja tidak cukup untuk menebak password siswa.
// Tidak ada kunci tetap di kode sumber, repository, atau frontend.
import { HttpError } from './http.js';
import { toHex } from './crypto.js';

export const KEY_NAME = 'system-pepper-v1';
let cached = null;      // kunci di memori isolate
let verified = false;   // sudah dicocokkan dengan sidik di D1

/** Sidik kunci (bukan kuncinya) untuk mendeteksi KV yang tertukar/terhapus. */
export async function keyCheck(key) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('presensi-key-check'))).slice(0, 24);
}

export function requireKv(env) {
  if (!env.KEYS || typeof env.KEYS.get !== 'function') {
    throw new HttpError(500, 'kv_missing', 'Penyimpanan kunci (KV "KEYS") belum terhubung ke Worker. Deploy ulang memakai tombol Deploy to Cloudflare.');
  }
}

export async function readStoredKey(env) {
  requireKv(env);
  return env.KEYS.get(KEY_NAME);
}

/** Kunci untuk hashing; gagal dengan pesan jelas bila aplikasi belum diinstal. */
export async function systemKey(env) {
  if (cached && verified) return cached;
  const key = cached || (await readStoredKey(env));
  const state = await env.DB.prepare('SELECT key_check FROM setup_state WHERE id = 1').first();
  if (!key && !state) throw new HttpError(503, 'not_installed', 'Aplikasi belum selesai diinstal. Buka halaman utama untuk membuat akun admin pertama.');
  if (!key) throw new HttpError(503, 'key_missing', 'Kunci sistem tidak ditemukan. Admin perlu membuka halaman utama aplikasi dan menjalankan pemulihan dengan kode instalasi (tersedia 10 menit setelah masalah ini muncul).');
  if (state && state.key_check !== (await keyCheck(key))) {
    throw new HttpError(500, 'key_mismatch', 'Kunci sistem tidak cocok dengan database (KV terhapus atau tertukar). Admin perlu menjalankan pemulihan instalasi.');
  }
  cached = key;
  verified = !!state;
  return key;
}

export function rememberKey(key) {
  cached = key;
  verified = true;
}

export function forgetKey() {
  cached = null;
  verified = false;
}
