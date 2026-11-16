-- Instalasi awal tanpa terminal.
-- Baris tunggal (id = 1) menandai instalasi selesai. PRIMARY KEY membuat pembuatan admin pertama
-- atomik: hanya satu permintaan yang bisa menyisipkan baris ini, dan sesudahnya halaman instalasi
-- tertutup permanen (meski akun superadmin kelak dihapus).
CREATE TABLE IF NOT EXISTS setup_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  completed_at  INTEGER NOT NULL,
  admin_id      TEXT NOT NULL,
  key_check     TEXT NOT NULL      -- sidik kunci sistem (bukan kuncinya), untuk mendeteksi KV yang tertukar
);

-- Pembatas percobaan kode instalasi yang salah.
CREATE TABLE IF NOT EXISTS setup_attempts (
  id  INTEGER PRIMARY KEY,
  ts  INTEGER NOT NULL,
  ip  TEXT
);
CREATE INDEX IF NOT EXISTS idx_setup_attempts_ts ON setup_attempts(ts);

-- Status pemulihan backup yang bisa dilanjutkan.
CREATE TABLE IF NOT EXISTS restore_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  started_at  INTEGER NOT NULL,
  started_by  TEXT NOT NULL,
  same_key    INTEGER NOT NULL,
  progress    TEXT NOT NULL
);
