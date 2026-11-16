-- Presensi Siswa v2.1 — skema lengkap.
-- Semua pernyataan idempoten (IF NOT EXISTS / OR IGNORE): aman dijalankan ulang oleh Worker maupun wrangler.
-- Waktu disimpan sebagai epoch milidetik (UTC); tanggal sesi sebagai 'YYYY-MM-DD' zona Asia/Jakarta.


CREATE TABLE IF NOT EXISTS classes (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  homeroom_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classes_homeroom ON classes(homeroom_user_id);

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,      -- siswa: 's' + NIS (huruf kecil); guru/admin: bebas
  nis                  TEXT UNIQUE,               -- hanya siswa; password awal = NIS
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('superadmin','admin','wali','siswa')),
  class_id             TEXT REFERENCES classes(id) ON DELETE SET NULL,
  pass_hash            TEXT NOT NULL,
  pass_salt            TEXT NOT NULL,
  pass_iter            INTEGER NOT NULL,
  is_default_password  INTEGER NOT NULL DEFAULT 1, -- 1 = masih NIS / sandi sementara
  must_change_password INTEGER NOT NULL DEFAULT 0, -- 1 = wajib ganti sebelum memakai aplikasi
  active               INTEGER NOT NULL DEFAULT 1,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         INTEGER,
  last_login_at        INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_class_role ON users(class_id, role, active);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,                    -- SHA-256 hex token cookie
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);

CREATE TABLE IF NOT EXISTS app_config (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
INSERT OR IGNORE INTO app_config (key, value) VALUES
  ('school_name', 'SMA Negeri 1 Kerjo'),
  ('default_lat', ''),
  ('default_lng', ''),
  ('default_radius_m', '100'),
  ('default_max_accuracy_m', '50'),
  ('school_ips', '[]'),
  ('face_threshold', '0.50'),
  ('force_password_change', '1');

CREATE TABLE IF NOT EXISTS holidays (
  date  TEXT PRIMARY KEY,                          -- YYYY-MM-DD
  name  TEXT NOT NULL
);

-- Jadwal: satu aturan bisa sekali (start_date = end_date) atau rutin (days_of_week diisi).
CREATE TABLE IF NOT EXISTS schedules (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('masuk','pulang','kegiatan')),
  start_date         TEXT NOT NULL,
  end_date           TEXT NOT NULL,
  days_of_week       TEXT,                         -- '1,2,3,4,5' (Senin=1 … Minggu=7); NULL = setiap hari dalam rentang
  start_time         TEXT NOT NULL,                -- HH:MM
  late_after         TEXT,                         -- HH:MM; NULL = tanpa status terlambat
  end_time           TEXT NOT NULL,
  lat                REAL NOT NULL,
  lng                REAL NOT NULL,
  radius_m           INTEGER NOT NULL,
  max_accuracy_m     INTEGER NOT NULL,
  class_ids          TEXT,                         -- JSON array; NULL = semua kelas
  require_face       INTEGER NOT NULL DEFAULT 1,
  require_liveness   INTEGER NOT NULL DEFAULT 1,
  require_school_ip  INTEGER NOT NULL DEFAULT 0,
  active             INTEGER NOT NULL DEFAULT 1,
  created_by         TEXT REFERENCES users(id),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_range ON schedules(active, start_date, end_date);

CREATE TABLE IF NOT EXISTS face_profiles (
  student_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embedding      BLOB NOT NULL,                    -- Float32Array (128 angka), bukan foto
  model_id       TEXT NOT NULL,
  samples        INTEGER NOT NULL,
  enrolled_at    INTEGER NOT NULL,
  enrolled_by    TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS attendance_tokens (
  id            TEXT PRIMARY KEY,                  -- SHA-256 hex token
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  session_date  TEXT NOT NULL,
  challenges    TEXT NOT NULL,                     -- JSON array tantangan liveness
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tokens_user_session ON attendance_tokens(user_id, schedule_id, session_date);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON attendance_tokens(expires_at);

CREATE TABLE IF NOT EXISTS attendance (
  id              INTEGER PRIMARY KEY,
  schedule_id     TEXT NOT NULL REFERENCES schedules(id),
  session_date    TEXT NOT NULL,
  student_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_time     INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('hadir','terlambat','izin','sakit','alfa')),
  source          TEXT NOT NULL CHECK (source IN ('app','manual')),
  lat             REAL,
  lng             REAL,
  accuracy_m      REAL,
  distance_m      REAL,
  face_distance   REAL,
  liveness        INTEGER,
  from_school_ip  INTEGER,
  note            TEXT,
  created_by      TEXT REFERENCES users(id),
  UNIQUE (schedule_id, session_date, student_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_date, schedule_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, session_date);

CREATE TABLE IF NOT EXISTS attempt_logs (
  id            INTEGER PRIMARY KEY,
  ts            INTEGER NOT NULL,
  user_id       TEXT,
  schedule_id   TEXT,
  session_date  TEXT,
  reason        TEXT NOT NULL,                     -- kode alasan
  message       TEXT,
  distance_m    REAL,
  accuracy_m    REAL,
  face_distance REAL,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_date ON attempt_logs(session_date, ts);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempt_logs(user_id, ts);
