// Pengaturan sekolah dari tabel app_config, dengan nilai bawaan yang aman.

const DEFAULTS = {
  school_name: 'Sekolah',
  default_lat: '',
  default_lng: '',
  default_radius_m: '100',
  default_max_accuracy_m: '50',
  school_ips: '[]',
  face_threshold: '0.50',
  force_password_change: '1',
};

export async function getConfig(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM app_config').all();
  const raw = { ...DEFAULTS, ...Object.fromEntries(results.map((r) => [r.key, r.value])) };
  let ips = [];
  try { ips = JSON.parse(raw.school_ips); } catch { /* biarkan kosong */ }
  return {
    school_name: raw.school_name,
    default_lat: raw.default_lat === '' ? null : Number(raw.default_lat),
    default_lng: raw.default_lng === '' ? null : Number(raw.default_lng),
    default_radius_m: Number(raw.default_radius_m),
    default_max_accuracy_m: Number(raw.default_max_accuracy_m),
    school_ips: Array.isArray(ips) ? ips : [],
    face_threshold: Number(raw.face_threshold),
    force_password_change: raw.force_password_change === '1',
  };
}

export async function getConfigValue(env, key) {
  const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind(key).first();
  return row ? row.value : DEFAULTS[key];
}
