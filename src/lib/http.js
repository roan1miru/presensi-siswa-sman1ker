// Respons JSON, error terstruktur, dan pembacaan body yang aman.

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return new Response(JSON.stringify({ ok: false, code: err.code, message: err.message, ...err.extra }), {
      status: err.status,
      headers: SECURITY_HEADERS,
    });
  }
  console.error('Unhandled error', err?.stack || err);
  return new Response(
    JSON.stringify({ ok: false, code: 'server_error', message: 'Server sedang bermasalah. Silakan coba beberapa saat lagi.' }),
    { status: 500, headers: SECURITY_HEADERS },
  );
}

/**
 * Membaca body JSON dengan batas ukuran. Permintaan yang mengubah data wajib JSON
 * dan (bila browser mengirim Origin) harus dari origin yang sama — lapisan CSRF kedua
 * di samping cookie SameSite=Strict.
 */
export async function readJson(request, maxBytes = 16 * 1024) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw new HttpError(403, 'bad_origin', 'Permintaan ditolak (origin berbeda).');

  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'bad_content_type', 'Format permintaan harus JSON.');
  }
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > maxBytes) throw new HttpError(413, 'too_large', 'Data yang dikirim terlalu besar.');

  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'Data yang dikirim terlalu besar.');
  try {
    const data = JSON.parse(text || '{}');
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, 'bad_json', 'Data yang dikirim tidak valid.');
  }
}

export function str(value, field, { min = 1, max = 200, trim = true } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_' + field, `Kolom ${field} wajib diisi.`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new HttpError(400, 'invalid_' + field, `Kolom ${field} minimal ${min} karakter.`);
  if (v.length > max) throw new HttpError(400, 'invalid_' + field, `Kolom ${field} maksimal ${max} karakter.`);
  return v;
}
