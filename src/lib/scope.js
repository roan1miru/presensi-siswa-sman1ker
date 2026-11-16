// Batas data per peran: admin melihat semua kelas, wali hanya kelas yang ia ampu.
export const ADMINS = ['superadmin', 'admin'];
export const STAFF = ['superadmin', 'admin', 'wali'];
export const isAdmin = (user) => ADMINS.includes(user.role);

/** null = tanpa batas (admin); array = id kelas yang boleh diakses (wali). */
export async function scopeClassIds(env, user) {
  if (isAdmin(user)) return null;
  const { results } = await env.DB.prepare('SELECT id FROM classes WHERE homeroom_user_id = ?').bind(user.id).all();
  return results.map((r) => r.id);
}

export const placeholders = (n) => Array(n).fill('?').join(',');

/** Kelas yang wajib mengikuti jadwal: null = semua. */
export function scheduleClassIds(schedule) {
  if (!schedule.class_ids) return null;
  try {
    const ids = JSON.parse(schedule.class_ids);
    return Array.isArray(ids) && ids.length ? ids : null;
  } catch {
    return null;
  }
}

export function scheduleAppliesToClass(schedule, classId) {
  const ids = scheduleClassIds(schedule);
  return ids === null || (classId != null && ids.includes(classId));
}
