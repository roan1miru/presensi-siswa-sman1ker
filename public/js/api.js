// Klien API: semua panggilan same-origin, cookie sesi dikirim otomatis oleh browser.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthenticated = () => {};
export function setUnauthenticatedHandler(fn) {
  onUnauthenticated = fn;
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Error 1027 Cloudflare (kuota harian habis) dan error proxy lain tidak berupa JSON.
    throw new ApiError(res.status, 'unavailable', 'Server sedang tidak dapat melayani. Gunakan prosedur presensi manual dan coba lagi nanti.');
  }
  if (!res.ok || data.ok === false) {
    const err = new ApiError(res.status, data.code || 'error', data.message || 'Terjadi kesalahan.');
    if (res.status === 401 && path !== '/api/auth/login') onUnauthenticated(err);
    throw err;
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
