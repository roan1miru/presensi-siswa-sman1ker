// Template wajah = rata-rata beberapa descriptor 128 angka. Foto tidak pernah diterima server.
// Pencocokan dilakukan di server: browser hanya mengirim descriptor wajah saat presensi,
// sehingga template siswa tidak pernah dikirim ke HP mana pun.
import { HttpError, json, readJson } from '../lib/http.js';
import { requireUser, auditStmt } from '../lib/session.js';
import { STAFF, scopeClassIds } from '../lib/scope.js';

export const MODEL_ID = 'faceapi-resnet128-v1';
export const DIM = 128;

export function parseDescriptor(v) {
  if (!Array.isArray(v) || v.length !== DIM) return null;
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    const x = v[i];
    if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 2) return null;
    out[i] = x;
  }
  return out;
}

export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export function blobToDescriptor(blob) {
  const bytes = blob instanceof ArrayBuffer ? new Uint8Array(blob) : Uint8Array.from(blob);
  return new Float32Array(bytes.buffer, bytes.byteOffset, DIM);
}

async function loadStudentFor(env, actor, studentId) {
  const s = await env.DB.prepare("SELECT id, name, class_id FROM users WHERE id = ? AND role = 'siswa'").bind(studentId).first();
  if (!s) throw new HttpError(404, 'not_found', 'Siswa tidak ditemukan.');
  const scope = await scopeClassIds(env, actor);
  if (scope && !scope.includes(s.class_id)) throw new HttpError(403, 'forbidden', 'Siswa ini bukan anggota kelas yang Anda ampu.');
  return s;
}

/** Pendaftaran wajah oleh operator (admin/wali) dari 3–8 sampel descriptor. */
export async function enroll(request, env) {
  const { user } = await requireUser(env, request, STAFF);
  const b = await readJson(request, 64 * 1024);
  const student = await loadStudentFor(env, user, b.student_id);
  if (b.model_id !== MODEL_ID) throw new HttpError(400, 'model_mismatch', 'Versi model wajah di perangkat ini tidak sesuai. Muat ulang aplikasi.');
  if (!Array.isArray(b.samples) || b.samples.length < 3 || b.samples.length > 8) {
    throw new HttpError(400, 'invalid_samples', 'Diperlukan 3–8 sampel wajah.');
  }
  const source = b.source === 'photo' ? 'photo' : 'camera';
  const samples = b.samples.map(parseDescriptor);
  if (samples.some((s) => !s)) throw new HttpError(400, 'invalid_samples', 'Data wajah tidak valid.');

  const mean = new Float32Array(DIM);
  for (const s of samples) for (let i = 0; i < DIM; i++) mean[i] += s[i] / samples.length;
  const spread = Math.max(...samples.map((s) => distance(s, mean)));
  if (spread > 0.4) {
    throw new HttpError(422, 'inconsistent_samples', 'Sampel wajah tidak konsisten (mungkin ada wajah lain atau gambar kabur). Ulangi pendaftaran.');
  }

  // Tolak bila wajah ini sudah terdaftar sebagai siswa lain di kelas yang sama (indikasi salah daftar).
  const { results: peers } = await env.DB.prepare(
    `SELECT u.name, f.embedding FROM face_profiles f JOIN users u ON u.id = f.student_id
      WHERE u.class_id = ? AND u.id <> ? AND f.model_id = ?`,
  ).bind(student.class_id ?? '', student.id, MODEL_ID).all();
  const clash = peers.find((p) => distance(blobToDescriptor(p.embedding), mean) < 0.35);
  if (clash) throw new HttpError(409, 'face_clash', `Wajah ini sangat mirip dengan data ${clash.name}. Pastikan siswa yang benar berada di depan kamera.`);

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO face_profiles (student_id, embedding, model_id, samples, enrolled_at, enrolled_by, source) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id) DO UPDATE SET embedding = excluded.embedding, model_id = excluded.model_id,
         samples = excluded.samples, enrolled_at = excluded.enrolled_at, enrolled_by = excluded.enrolled_by, source = excluded.source`,
    ).bind(student.id, mean.buffer, MODEL_ID, samples.length, now, user.id, source),
    auditStmt(env, user.id, 'face_enroll', student.id, { samples: samples.length, spread: Number(spread.toFixed(3)), source }),
  ]);
  return json({ enrolled_at: now, quality: Number((1 - spread).toFixed(2)) });
}

export async function remove(request, env, { id }) {
  const { user } = await requireUser(env, request, STAFF);
  await readJson(request);
  const student = await loadStudentFor(env, user, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM face_profiles WHERE student_id = ?').bind(student.id),
    auditStmt(env, user.id, 'face_delete', student.id),
  ]);
  return json({});
}
