/**
 * Local SQLite store. Everything DocuLoom knows lives under the data
 * directory; nothing is written anywhere else and nothing leaves the
 * machine unless the user configures a hosted provider.
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATA_DIR =
  process.env.DOCULOOM_DATA_DIR ?? join(homedir(), '.doculoom')
export const PAPERS_DIR = join(DATA_DIR, 'papers')

const MIGRATIONS: string[] = [
  // 1 - initial schema
  `
  CREATE TABLE papers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    year INTEGER,
    abstract TEXT NOT NULL DEFAULT '',
    page_count INTEGER NOT NULL DEFAULT 0,
    file_hash TEXT NOT NULL,
    file_name TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    extraction_version INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX papers_file_hash ON papers(file_hash);

  CREATE TABLE blocks (
    id TEXT NOT NULL,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    section_path TEXT NOT NULL DEFAULT '[]',
    bbox TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1,
    PRIMARY KEY (paper_id, id)
  );
  CREATE INDEX blocks_paper_page ON blocks(paper_id, page);
  CREATE INDEX blocks_paper_ord ON blocks(paper_id, ord);

  CREATE VIRTUAL TABLE blocks_fts USING fts5(
    text,
    block_id UNINDEXED,
    paper_id UNINDEXED,
    tokenize = 'porter unicode61'
  );

  CREATE TABLE blueprints (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    report TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE explanations (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    claim_id TEXT NOT NULL,
    depth TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (paper_id, claim_id, depth)
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 2 - the graph blueprint is replaced by a reading lens
  `
  DROP TABLE IF EXISTS explanations;
  DROP TABLE IF EXISTS blueprints;

  CREATE TABLE lenses (
    paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    report TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  `,
]

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(PAPERS_DIR)) mkdirSync(PAPERS_DIR, { recursive: true })

  const handle = new Database(join(DATA_DIR, 'doculoom.db'))
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  migrate(handle)
  db = handle
  return db
}

function migrate(handle: Database.Database) {
  const current = handle.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    handle.transaction(() => {
      handle.exec(MIGRATIONS[v])
      handle.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export function closeDb() {
  db?.close()
  db = null
}
