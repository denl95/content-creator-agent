import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import 'dotenv/config';

/**
 * Apply migrations to whatever state the volume is actually in.
 *
 * A plain `prisma migrate deploy` is wrong for this project's live volume. That
 * database predates Prisma: it already has a `drafts` table and no
 * `_prisma_migrations`, so `deploy` tries to run `0_init` (`CREATE TABLE
 * drafts`), fails with "table already exists", and — under `set -e` in the
 * entrypoint — crash-loops the container. The phase-1 rehearsal baselined a
 * local copy by hand, which is exactly the step a deploy has no way to perform.
 *
 * Three states, one of which is the dangerous one:
 *
 *   - no database file          → fresh; deploy runs every migration
 *   - `_prisma_migrations` set  → already managed; deploy runs what is pending
 *   - `drafts` but no history   → the live volume; baseline `0_init` first
 *
 * Baselining marks the migration as applied without executing it, leaving the
 * existing table untouched. It is idempotent by construction: once the history
 * table exists, this branch never runs again.
 */

const BASELINE = '0_init';

function databaseFile(url: string | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('file:')) return null; // A remote libSQL URL manages itself.
  const path = url.slice('file:'.length);
  return path.startsWith(':') ? null : path; // `file::memory:` has nothing to inspect.
}

function tablesIn(path: string): Set<string> {
  const db = new Database(path, { readonly: true });
  try {
    const rows = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>;
    return new Set(rows.map((r) => r.name));
  } finally {
    db.close();
  }
}

async function prisma(...args: string[]): Promise<void> {
  const proc = Bun.spawn(['bunx', 'prisma', ...args], { stdout: 'inherit', stderr: 'inherit' });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`prisma ${args.join(' ')} exited with ${code}`);
}

async function main(): Promise<void> {
  const path = databaseFile(process.env.DATABASE_URL);

  if (path && existsSync(path)) {
    const tables = tablesIn(path);
    if (tables.has('drafts') && !tables.has('_prisma_migrations')) {
      console.log(
        `[migrate] ${path} has a pre-Prisma drafts table and no migration history — ` +
          `baselining ${BASELINE} instead of executing it.`,
      );
      await prisma('migrate', 'resolve', '--applied', BASELINE);
    }
  }

  await prisma('migrate', 'deploy');
}

main().catch((err) => {
  console.error('[migrate] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
