// Migrasi otomatis oleh Worker sendiri.
// Tabel dibuat/diperbarui saat aplikasi pertama kali menerima permintaan setelah deploy,
// sehingga tidak bergantung pada "deploy command" di Cloudflare (bisa `npx wrangler deploy`
// atau `npm run deploy`). Data lama tidak pernah dihapus: semua file migrasi idempoten
// (CREATE ... IF NOT EXISTS, INSERT OR IGNORE) dan nomor versi tercatat di tabel _app_schema.
import m0001 from '../../migrations/0001_init.sql';
import m0002 from '../../migrations/0002_instalasi.sql';
import m0003 from '../../migrations/0003_sumber_wajah.sql';

const MIGRATIONS = [m0001, m0002, m0003]; // tambahkan file baru di akhir; jangan ubah urutan
let ready = false;
let running = null;

/** Memecah SQL menjadi pernyataan: buang komentar `--` lalu pisah per titik koma. */
export function splitSql(sql) {
  return sql
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

async function migrate(env) {
  let version = 0;
  try {
    const row = await env.DB.prepare('SELECT version FROM _app_schema WHERE id = 1').first();
    version = row?.version ?? 0;
  } catch {
    version = 0; // tabel belum ada = database baru
  }
  if (version >= MIGRATIONS.length) return;
  for (let i = version; i < MIGRATIONS.length; i++) {
    const sqls = [];
    for (const sql of splitSql(MIGRATIONS[i])) {
      // ALTER TABLE ... ADD COLUMN tidak punya "IF NOT EXISTS" di SQLite: lewati bila kolom sudah ada
      // (misalnya database pernah dimigrasi lewat `wrangler d1 migrations apply`).
      const m = /^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i.exec(sql);
      if (m) {
        const { results } = await env.DB.prepare('SELECT name FROM pragma_table_info(?)').bind(m[1]).all();
        if (results.some((r) => r.name.toLowerCase() === m[2].toLowerCase())) continue;
      }
      sqls.push(sql);
    }
    const stmts = sqls.map((s) => env.DB.prepare(s));
    stmts.push(env.DB.prepare('CREATE TABLE IF NOT EXISTS _app_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, updated_at INTEGER NOT NULL)'));
    stmts.push(env.DB.prepare(
      'INSERT INTO _app_schema (id, version, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = MAX(version, excluded.version), updated_at = excluded.updated_at',
    ).bind(i + 1, Date.now()));
    try {
      await env.DB.batch(stmts); // satu migrasi = satu transaksi
    } catch (e) {
      // Isolate lain mungkin baru saja menjalankan migrasi yang sama (mis. ALTER TABLE yang tidak
      // idempoten). Bila versi di database sudah mencakup migrasi ini, lanjutkan saja.
      const row = await env.DB.prepare('SELECT version FROM _app_schema WHERE id = 1').first().catch(() => null);
      if (!row || row.version < i + 1) throw e;
    }
  }
}

export async function ensureSchema(env) {
  if (ready) return;
  running ??= migrate(env).then(() => { ready = true; }).finally(() => { running = null; });
  await running;
}
