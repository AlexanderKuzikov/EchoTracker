import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  email TEXT,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pos INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  column_id TEXT NOT NULL REFERENCES columns(id),
  kind TEXT NOT NULL DEFAULT 'task',
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  deadline TEXT,
  requested_at TEXT,
  started_at TEXT,
  doc_ref TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'original',
  derived_from TEXT REFERENCES files(id) ON DELETE CASCADE,
  orig_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_card ON files(card_id);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id);
CREATE TABLE IF NOT EXISTS checklist (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  pos INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklist_card ON checklist(card_id);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_card ON activity(card_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SEED_COLUMNS: Array<[string, string, number]> = [
  ['incoming', 'Входящие', 0],
  ['work', 'В работе', 1],
  ['waiting', 'Жду заказчика', 2],
  ['done', 'Готово', 3],
];

export function openDb(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const count = db.prepare('SELECT COUNT(*) AS c FROM columns').get() as { c: number };
  if (count.c === 0) {
    const ins = db.prepare('INSERT INTO columns (id, title, pos) VALUES (?, ?, ?)');
    for (const [id, title, pos] of SEED_COLUMNS) ins.run(id, title, pos);
  }
  ensureCodes(db);
  ensureDerived(db);
  return db;
}

export function fmtCode(n: number): string {
  return 'T-' + String(n).padStart(4, '0');
}

export function nextCode(db: DatabaseSync): string {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'card_seq'`).get() as
    | { value: string }
    | undefined;
  const n = (row ? parseInt(row.value, 10) || 0 : 0) + 1;
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('card_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(n));
  return fmtCode(n);
}

function ensureColumn(db: DatabaseSync, table: string, name: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

function stripBase(name: string): string {
  const noExt = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  return noExt.endsWith('.thumb') ? noExt.slice(0, -6) : noExt;
}

function ensureDerived(db: DatabaseSync): void {
  ensureColumn(db, 'files', 'derived_from', 'TEXT REFERENCES files(id) ON DELETE CASCADE');
  const all = db.prepare('SELECT id, card_id, kind, orig_name, derived_from FROM files').all() as Array<{
    id: string;
    card_id: string;
    kind: string;
    orig_name: string;
    derived_from: string | null;
  }>;
  for (const d of all) {
    if (d.kind === 'original' || d.derived_from) continue;
    const base = stripBase(d.orig_name);
    const parent = all.find(
      (f) => f.card_id === d.card_id && f.kind === 'original' && stripBase(f.orig_name) === base,
    );
    if (parent) db.prepare('UPDATE files SET derived_from = ? WHERE id = ?').run(parent.id, d.id);
  }
}

function ensureCodes(db: DatabaseSync): void {
  ensureColumn(db, 'cards', 'code', 'TEXT');
  ensureColumn(db, 'cards', 'started_at', 'TEXT');
  ensureColumn(db, 'cards', 'doc_ref', 'TEXT');
  const bare = db
    .prepare(`SELECT id FROM cards WHERE code IS NULL ORDER BY created_at, rowid`)
    .all() as Array<{ id: string }>;
  for (const r of bare) {
    db.prepare(`UPDATE cards SET code = ? WHERE id = ?`).run(nextCode(db), r.id);
  }
}
