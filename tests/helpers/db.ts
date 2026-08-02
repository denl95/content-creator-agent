import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb, resetDbForTests } from '../../src/db';

/**
 * The pre-Prisma `drafts` table, verbatim. Tests never run migrations — a test
 * database starts empty, so the schema is created explicitly.
 */
const DRAFTS_SCHEMA = `CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  channel TEXT NOT NULL,
  tone TEXT NOT NULL,
  audience TEXT NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  verdict TEXT,
  tone_score REAL,
  accuracy_score REAL,
  structure_score REAL,
  iterations INTEGER NOT NULL DEFAULT 0,
  issues TEXT NOT NULL DEFAULT '[]',
  cost_usd REAL,
  notion_url TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

let counter = 0;
const created: string[] = [];

/**
 * Drop any cached client and hand back an empty database.
 *
 * A temp file rather than `:memory:` on purpose: libSQL gives every pooled
 * connection its own private in-memory database, so a CREATE TABLE issued on
 * one connection is invisible to the insert that follows on another. That fails
 * as `no such table: main.drafts`, and only intermittently — whichever suite
 * order happens to reuse a connection passes.
 */
export async function freshDb(): Promise<ReturnType<typeof getDb>> {
  await resetDbForTests();
  counter += 1;
  const file = path.join(tmpdir(), `cca-test-${process.pid}-${counter}.db`);
  try {
    unlinkSync(file);
  } catch {
    // First use of this name in the process — nothing to remove.
  }
  created.push(file);
  const db = getDb(`file:${file}`);
  await db.$executeRawUnsafe(DRAFTS_SCHEMA);
  return db;
}

// Registered once per process so no individual suite has to remember.
process.on('exit', () => cleanupTestDbs());

/** Remove every database this helper created. Safe to call more than once. */
export function cleanupTestDbs(): void {
  while (created.length > 0) {
    const file = created.pop();
    if (!file) continue;
    for (const suffix of ['', '-shm', '-wal']) {
      try {
        unlinkSync(`${file}${suffix}`);
      } catch {
        // Already gone, or never created — either is fine.
      }
    }
  }
}
