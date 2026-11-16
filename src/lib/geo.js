// Jarak Haversine (meter) dan pencocokan IP jaringan sekolah.

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const validLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
export const validLng = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;

function ipv4ToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((acc, x) => (acc << 8) + Number(x), 0) >>> 0;
}

/**
 * Entri yang didukung: IP persis ("103.10.20.30"), CIDR IPv4 ("103.10.20.0/24"),
 * atau awalan diakhiri * ("2001:db8:1:2:*") untuk IPv6.
 */
export function ipMatches(ip, entries) {
  if (!ip || !Array.isArray(entries)) return false;
  const ipInt = ipv4ToInt(ip);
  for (const raw of entries) {
    const e = String(raw).trim();
    if (!e) continue;
    if (e.endsWith('*')) {
      if (ip.toLowerCase().startsWith(e.slice(0, -1).toLowerCase())) return true;
    } else if (e.includes('/') && ipInt !== null) {
      const [base, bits] = e.split('/');
      const baseInt = ipv4ToInt(base);
      const n = Number(bits);
      if (baseInt === null || !(n >= 0 && n <= 32)) continue;
      const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
      if ((ipInt & mask) === (baseInt & mask)) return true;
    } else if (e.toLowerCase() === ip.toLowerCase()) {
      return true;
    }
  }
  return false;
}

export const clientIp = (request) => request.headers.get('CF-Connecting-IP') || '127.0.0.1';
