# Phase 1 — Persistence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-written SQL with Prisma + libSQL, introduce a brand library backed by per-brand vector collections, and let every run pick the brand it is written for — without losing a single existing draft.

**Architecture:** `src/db.ts` keeps its exported signatures and its snake_case wire shape, swapping only its body for Prisma, so `web/` needs no changes until Task 7. A new `src/brands.ts` owns brand persistence. `lookupBrandStyle()` gains a required `brandId` and reads each brand's corpus from SQLite rather than from files, with the file and Notion loaders demoted to seed-time importers.

**Tech Stack:** Bun, TypeScript, Prisma 7.9.1, `@prisma/adapter-libsql` 7.9.1, `@libsql/client`, Zod 3, LangGraph, Chroma, Next.js 16, Biome.

## Global Constraints

Every value below was verified by spike against Prisma 7.9.1 on 2026-08-02. Trust these over any recollection of Prisma 5/6 conventions — several are recent breaking changes.

- **`prisma migrate dev` must NEVER be run against a database holding real data.** It reads the pre-existing `created_at` divergence as drift and offers to reset with *"All data will be lost."* Author migrations with `migrate diff`; apply them with `migrate deploy`.
- **`datasource` blocks no longer accept `url`.** Connection config lives in `prisma.config.ts` as `datasource: { url: env('DATABASE_URL') }`. The client receives an adapter instance instead.
- **The adapter class is `PrismaLibSql`** — lowercase `s`. `PrismaLibSQL` does not exist in v7 and fails at import.
- **CLI flag renames:** `--to-schema-datamodel` → `--to-schema`; `--from-url` → `--from-config-datasource`.
- `:memory:` and `file::memory:` both work with the libSQL adapter, but a database that starts empty has no migrations applied — tests must create their schema explicitly.
- Runtime is **Bun**: `bun`, `bun test`, `bunx`. Never `node`, `npm`, `npx`.
- Root gates: `bun run typecheck`, `bunx biome ci .`, `bun run test:unit`. `web/` is excluded from both — typecheck it with `cd web && bun run build`.
- The generated client is ~204 KB of TypeScript. It must be gitignored and excluded from Biome and `tsc`, or both gates fail on generated code.
- **`src/db.ts`'s exported function signatures and snake_case return shape must not change in this phase.** Five modules and four test files depend on them, and `web/lib/types.ts` mirrors the wire shape by hand.
- Phase 1 is **merged but not deployed** — production sees it only in the deploy that also carries phase 2.
- Commits: Conventional Commits. Do **not** add a Claude co-author trailer.

---

### Task 1: Prisma scaffolding and the baseline migration

Introduces Prisma alongside the existing `bun:sqlite` code without changing behaviour. Nothing imports the generated client yet.

**Files:**
- Create: `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/0_init/migration.sql`
- Modify: `package.json`, `.gitignore`, `biome.json`, `tsconfig.json`, `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: a generated client at `src/generated/prisma/client` exporting `PrismaClient`; a `Draft` model whose fields are `id, topic, channel, tone, audience, content, wordCount, verdict, toneScore, accuracyScore, structureScore, iterations, issues, costUsd, notionUrl, createdAt`.

- [ ] **Step 1: Install the dependencies**

```bash
bun add prisma@7 @prisma/client@7 @prisma/adapter-libsql@7 @libsql/client
```

- [ ] **Step 2: Write the config and the schema modelling the table that already exists**

`prisma.config.ts` at the repo root:

```ts
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

`prisma/schema.prisma` — models only what is in the database today, so the baseline describes reality:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"
}

model Draft {
  id             String   @id
  topic          String
  channel        String
  tone           String
  audience       String
  content        String
  wordCount      Int      @map("word_count")
  verdict        String?
  toneScore      Float?   @map("tone_score")
  accuracyScore  Float?   @map("accuracy_score")
  structureScore Float?   @map("structure_score")
  iterations     Int      @default(0)
  issues         String   @default("[]")
  costUsd        Float?   @map("cost_usd")
  notionUrl      String?  @map("notion_url")
  createdAt      DateTime @default(now()) @map("created_at")

  @@map("drafts")
}
```

- [ ] **Step 3: Exclude generated code from git and from both gates**

Append to `.gitignore`:

```
src/generated/
```

In `biome.json`, add `"src/generated"` to the existing `files.includes` ignore list (it already ignores `web` — follow that entry's syntax exactly rather than inventing a new key).

In `tsconfig.json`, add `"src/generated"` to the `exclude` array alongside the existing `web` entry.

- [ ] **Step 4: Add the scripts**

In `package.json`, add to `scripts`:

```json
    "prisma:generate": "prisma generate",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:status": "prisma migrate status",
```

In `.env.example`, replace the `DRAFTS_DB_PATH=data/app.db` line with:

```
# Prisma + libSQL connection string. Replaces DRAFTS_DB_PATH.
DATABASE_URL=file:./data/app.db
```

- [ ] **Step 5: Generate the client and verify it imports**

```bash
DATABASE_URL="file:./data/app.db" bun run prisma:generate
```

Expected: `✔ Generated Prisma Client (7.9.1) to ./src/generated/prisma`.

- [ ] **Step 6: Author the baseline migration**

```bash
mkdir -p prisma/migrations/0_init
DATABASE_URL="file:./data/app.db" bunx prisma migrate diff \
  --from-empty --to-schema prisma/schema.prisma --script \
  > prisma/migrations/0_init/migration.sql
```

Expected: a single `CREATE TABLE "drafts" (...)` matching the current columns. If the file is empty, the command failed — read stderr rather than continuing.

- [ ] **Step 7: Rehearse the baseline on a copy, never the real database first**

```bash
cp data/app.db /tmp/rehearse.db
DATABASE_URL="file:/tmp/rehearse.db" bunx prisma migrate resolve --applied 0_init
DATABASE_URL="file:/tmp/rehearse.db" bunx prisma migrate status
bun -e "const {Database}=require('bun:sqlite');const db=new Database('/tmp/rehearse.db');
console.log('rows:',db.query('select count(*) c from drafts').get().c);
console.log('tables:',db.query(\"select name from sqlite_master where type='table'\").all().map(t=>t.name).join(', '))"
```

Expected: `Database schema is up to date!`, the original row count unchanged, and tables `drafts, _prisma_migrations`. Only `_prisma_migrations` is new.

- [ ] **Step 8: Apply the baseline to the real local database**

```bash
DATABASE_URL="file:./data/app.db" bunx prisma migrate resolve --applied 0_init
DATABASE_URL="file:./data/app.db" bunx prisma migrate status
```

Expected: `Database schema is up to date!`

- [ ] **Step 9: Run the gates**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
```

Expected: all pass, unchanged from before — nothing imports Prisma yet.

- [ ] **Step 10: Commit**

```bash
git add prisma prisma.config.ts package.json bun.lock .gitignore biome.json tsconfig.json .env.example
git commit -m "chore: add Prisma 7 + libSQL alongside the existing SQLite layer

Baseline migration only — nothing imports the generated client yet, so
behaviour is unchanged. 0_init is marked applied rather than executed, so
the live drafts table is untouched.

Prisma 7 removed url from the datasource block; it lives in
prisma.config.ts now. Generated client is gitignored and excluded from
Biome and tsc, since it is ~204KB of generated TypeScript."
```

---

### Task 2: Move `src/db.ts` onto Prisma behind its existing API

The riskiest refactor in the phase: five modules and four test files depend on these signatures, and `web/` depends on the snake_case wire shape.

**Files:**
- Modify: `src/db.ts`
- Modify: `tests/unit/db.test.ts`, `tests/unit/stats.test.ts`, `tests/unit/server.test.ts`, `tests/unit/runManagerActivity.test.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` from `../generated/prisma/client` (Task 1).
- Produces: unchanged exports — `getDb()`, `insertDraft(NewDraft)`, `listDrafts(): DraftRow[]`, `getDraft(id): DraftRow | null`, `setDraftNotionUrl(id, url)`, `setDraftCost(id, costUsd)`, `getStats(): Stats`, `resetDbForTests()`. `DraftRow` keeps snake_case keys. All become `async` — see Step 3.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/db.test.ts`, which proves the wire shape survives the swap:

```ts
test('rows keep their snake_case wire shape', async () => {
  await insertDraft(sampleDraft('shape-1'));
  const row = await getDraft('shape-1');
  expect(row).not.toBeNull();
  // web/lib/types.ts mirrors these names by hand — renaming any of them breaks the dashboard silently.
  for (const key of [
    'word_count', 'tone_score', 'accuracy_score', 'structure_score',
    'cost_usd', 'notion_url', 'created_at',
  ]) {
    expect(Object.hasOwn(row as object, key)).toBe(true);
  }
  expect(row?.created_at).toBeTypeOf('string');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/db.test.ts -t "snake_case"`
Expected: FAIL — `getDraft` is currently synchronous, so `await` yields the row but `created_at` assertions pass for the wrong reason; the run fails on `insertDraft` being awaited before it is async. Confirm the failure message names one of those, then continue.

- [ ] **Step 3: Rewrite `src/db.ts` on Prisma**

Prisma's client is promise-based, so every exported function becomes `async`. That is the one deliberate signature change in this task and it ripples to callers in Step 5.

```ts
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from './generated/prisma/client';

export type DraftRow = {
  id: string;
  topic: string;
  channel: string;
  tone: string;
  audience: string;
  content: string;
  word_count: number;
  verdict: string | null;
  tone_score: number | null;
  accuracy_score: number | null;
  structure_score: number | null;
  iterations: number;
  issues: string;
  cost_usd: number | null;
  notion_url: string | null;
  created_at: string;
  brand_id: string | null;
};

export type NewDraft = Omit<
  DraftRow,
  'issues' | 'cost_usd' | 'notion_url' | 'created_at' | 'brand_id'
> & { issues: string[]; brand_id?: string | null };

let client: PrismaClient | null = null;

export function getDb(url = process.env.DATABASE_URL ?? 'file:./data/app.db'): PrismaClient {
  if (client) return client;
  client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  return client;
}

export async function resetDbForTests(): Promise<void> {
  await client?.$disconnect();
  client = null;
}

/**
 * Prisma returns camelCase and real Date objects; the HTTP API has always
 * emitted snake_case with SQLite's 'YYYY-MM-DD HH:MM:SS' strings, and
 * web/lib/types.ts mirrors that by hand. This is the only place the two
 * shapes meet.
 */
function toDraftRow(d: {
  id: string; topic: string; channel: string; tone: string; audience: string;
  content: string; wordCount: number; verdict: string | null;
  toneScore: number | null; accuracyScore: number | null; structureScore: number | null;
  iterations: number; issues: string; costUsd: number | null;
  notionUrl: string | null; createdAt: Date; brandId: string | null;
}): DraftRow {
  return {
    id: d.id,
    topic: d.topic,
    channel: d.channel,
    tone: d.tone,
    audience: d.audience,
    content: d.content,
    word_count: d.wordCount,
    verdict: d.verdict,
    tone_score: d.toneScore,
    accuracy_score: d.accuracyScore,
    structure_score: d.structureScore,
    iterations: d.iterations,
    issues: d.issues,
    cost_usd: d.costUsd,
    notion_url: d.notionUrl,
    created_at: d.createdAt.toISOString().replace('T', ' ').slice(0, 19),
    brand_id: d.brandId,
  };
}

export async function insertDraft(draft: NewDraft): Promise<void> {
  await getDb().draft.create({
    data: {
      id: draft.id,
      topic: draft.topic,
      channel: draft.channel,
      tone: draft.tone,
      audience: draft.audience,
      content: draft.content,
      wordCount: draft.word_count,
      verdict: draft.verdict,
      toneScore: draft.tone_score,
      accuracyScore: draft.accuracy_score,
      structureScore: draft.structure_score,
      iterations: draft.iterations,
      issues: JSON.stringify(draft.issues),
      brandId: draft.brand_id ?? null,
    },
  });
}

export async function listDrafts(): Promise<DraftRow[]> {
  const rows = await getDb().draft.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return rows.map(toDraftRow);
}

export async function getDraft(id: string): Promise<DraftRow | null> {
  const row = await getDb().draft.findUnique({ where: { id } });
  return row ? toDraftRow(row) : null;
}

export async function setDraftNotionUrl(id: string, url: string): Promise<void> {
  await getDb().draft.update({ where: { id }, data: { notionUrl: url } });
}

export async function setDraftCost(id: string, costUsd: number): Promise<void> {
  await getDb().draft.update({ where: { id }, data: { costUsd } });
}
```

Keep the existing `Stats` type verbatim, and reimplement `getStats()` as:

```ts
export async function getStats(): Promise<Stats> {
  const db = getDb();
  const [totalDrafts, approvedCount, agg, byChannelRaw, spendByDay] = await Promise.all([
    db.draft.count(),
    db.draft.count({ where: { verdict: 'APPROVED' } }),
    db.draft.aggregate({
      _sum: { costUsd: true },
      _avg: { iterations: true, toneScore: true, accuracyScore: true, structureScore: true },
    }),
    db.draft.groupBy({ by: ['channel'], _count: { _all: true } }),
    // date() grouping has no Prisma equivalent; raw SQL is the honest answer.
    db.$queryRawUnsafe<Array<{ day: string; costUsd: number }>>(
      `SELECT date(created_at) AS day, COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM drafts GROUP BY day ORDER BY day ASC`,
    ),
  ]);

  const byChannel = byChannelRaw
    .map((r) => ({ channel: r.channel, count: r._count._all }))
    .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));

  return {
    totalDrafts,
    approvedCount,
    approvalRate: totalDrafts === 0 ? 0 : approvedCount / totalDrafts,
    totalCostUsd: agg._sum.costUsd ?? 0,
    avgIterations: agg._avg.iterations ?? 0,
    avgScores: {
      tone: agg._avg.toneScore ?? 0,
      accuracy: agg._avg.accuracyScore ?? 0,
      structure: agg._avg.structureScore ?? 0,
    },
    byChannel,
    spendByDay,
  };
}
```

- [ ] **Step 4: Give the tests their own database**

The four DB-touching test files currently call `getDb()` against the default path. Add this to the top of each of `tests/unit/db.test.ts`, `tests/unit/stats.test.ts`, `tests/unit/server.test.ts`, `tests/unit/runManagerActivity.test.ts`, before their existing imports of `../../src/db`:

```ts
process.env.DATABASE_URL = ':memory:';
```

Because `:memory:` starts empty and migrations were never applied to it, each suite must create the schema. Add to each file, replacing the existing `afterEach(() => resetDbForTests())`:

```ts
beforeEach(async () => {
  await getDb().$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, topic TEXT NOT NULL, channel TEXT NOT NULL, tone TEXT NOT NULL,
    audience TEXT NOT NULL, content TEXT NOT NULL, word_count INTEGER NOT NULL,
    verdict TEXT, tone_score REAL, accuracy_score REAL, structure_score REAL,
    iterations INTEGER NOT NULL DEFAULT 0, issues TEXT NOT NULL DEFAULT '[]',
    cost_usd REAL, notion_url TEXT, brand_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
});

afterEach(async () => {
  await resetDbForTests();
});
```

Import `beforeEach` from `bun:test` in each file.

- [ ] **Step 5: Await the callers**

`insertDraft`, `setDraftCost` and `setDraftNotionUrl` are now async. Update each call site:

- `src/nodes/finalizer.ts` — `await insertDraft({...})` (the function is already async)
- `src/nodes/publisher.ts` — `await setDraftNotionUrl(...)`
- `src/runManager.ts` — `await setDraftCost(run.threadId, run.tracker.costUsd())` inside `drive()`, which is already async
- `src/cli.ts` — `await setDraftCost(threadId, tracker.costUsd())`
- `src/server.ts` — `listDrafts()`, `getDraft()`, `getStats()` and `setDraftNotionUrl()` all gain `await`; their Hono handlers become `async`

- [ ] **Step 6: Run the tests**

Run: `bun run test:unit`
Expected: PASS, including the new snake_case test.

- [ ] **Step 7: Run the gates**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
```

- [ ] **Step 8: Verify the HTTP shape is byte-identical**

```bash
DATABASE_URL="file:./data/app.db" bun run src/server.ts &
sleep 3
curl -s localhost:3000/drafts | head -c 400; echo
curl -s localhost:3000/stats; echo
lsof -ti:3000 | xargs kill
```

Expected: `/drafts` returns snake_case objects and `/stats` returns the same keys as before. If any key changed name, `toDraftRow` is wrong — fix it rather than changing `web/`.

- [ ] **Step 9: Commit**

```bash
git add src tests
git commit -m "refactor: move src/db.ts onto Prisma behind its existing API

Function names and the snake_case wire shape are unchanged, so web/ needs
no edits — toDraftRow is the single place Prisma's camelCase and Date
objects meet the API's long-standing snake_case strings.

Every exported function is now async, which ripples to finalizer,
publisher, runManager, cli and server. getStats keeps raw SQL for the
date() grouping, which has no Prisma equivalent.

Tests move to :memory: and create their own schema, since a database that
starts empty has no migrations applied to it."
```

---

### Task 3: Feature migration and the brand repository

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/1_add_brands/migration.sql`, `src/brands.ts`
- Test: `tests/unit/brands.test.ts`

**Interfaces:**
- Consumes: `getDb()` from Task 2.
- Produces: `listBrands(): Promise<BrandRow[]>`, `getBrand(id): Promise<BrandRow | null>`, `getDefaultBrand(): Promise<BrandRow | null>`, `createBrand(input): Promise<BrandRow>`, `updateBrand(id, patch): Promise<BrandRow>`, `setDefaultBrand(id): Promise<void>`, `getBrandCorpus(brandId): Promise<Array<{ source: string; content: string }>>`, `setBrandCorpusHash(id, hash): Promise<void>`. `BrandRow` is snake_case, matching `DraftRow`'s convention.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/brands.test.ts`:

```ts
process.env.DATABASE_URL = ':memory:';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createBrand, getBrandCorpus, getDefaultBrand, listBrands, setDefaultBrand } from '../../src/brands';
import { getDb, resetDbForTests } from '../../src/db';

beforeEach(async () => {
  const db = getDb();
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft', is_default BOOLEAN NOT NULL DEFAULT false,
    language TEXT NOT NULL DEFAULT 'en', collection_name TEXT NOT NULL UNIQUE,
    corpus_hash TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS brand_documents (
    id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, source_id TEXT, kind TEXT NOT NULL,
    title TEXT NOT NULL, content TEXT NOT NULL, included BOOLEAN NOT NULL DEFAULT true,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
});

afterEach(async () => {
  await resetDbForTests();
});

describe('brands', () => {
  test('creates a brand and lists it', async () => {
    const brand = await createBrand({ name: 'EONYX', slug: 'eonyx', language: 'uk', status: 'active' });
    expect(brand.slug).toBe('eonyx');
    expect(brand.collection_name).toBe('brand_eonyx');
    const all = await listBrands();
    expect(all).toHaveLength(1);
  });

  test('setDefaultBrand leaves exactly one default', async () => {
    const a = await createBrand({ name: 'A', slug: 'a', language: 'uk', status: 'active' });
    const b = await createBrand({ name: 'B', slug: 'b', language: 'en', status: 'active' });
    await setDefaultBrand(a.id);
    await setDefaultBrand(b.id);
    const all = await listBrands();
    expect(all.filter((brand) => brand.is_default)).toHaveLength(1);
    expect((await getDefaultBrand())?.id).toBe(b.id);
  });

  test('getBrandCorpus returns only included documents', async () => {
    const brand = await createBrand({ name: 'C', slug: 'c', language: 'uk', status: 'active' });
    const db = getDb();
    await db.brandDocument.create({
      data: { brandId: brand.id, kind: 'style_guide', title: 'Style', content: 'RULES', included: true },
    });
    await db.brandDocument.create({
      data: { brandId: brand.id, kind: 'raw_page', title: 'Home', content: 'NAV FOOTER', included: false },
    });
    const corpus = await getBrandCorpus(brand.id);
    expect(corpus).toHaveLength(1);
    expect(corpus[0]?.content).toBe('RULES');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/brands.test.ts`
Expected: FAIL — `Cannot find module '../../src/brands'`.

- [ ] **Step 3: Extend the schema**

Append to `prisma/schema.prisma` the `Brand`, `BrandSource` and `BrandDocument` models exactly as written in spec §5, and add to the `Draft` model:

```prisma
  brandId        String?  @map("brand_id")
  brand          Brand?   @relation(fields: [brandId], references: [id], onDelete: SetNull)

  @@index([brandId])
```

- [ ] **Step 4: Author the feature migration from the live database state**

```bash
mkdir -p prisma/migrations/1_add_brands
DATABASE_URL="file:./data/app.db" bunx prisma migrate diff \
  --from-config-datasource prisma.config.ts \
  --to-schema prisma/schema.prisma --script \
  > prisma/migrations/1_add_brands/migration.sql
```

Expected: `CREATE TABLE "brands"`, `CREATE TABLE "brand_sources"`, `CREATE TABLE "brand_documents"`, and a `-- RedefineTables` block containing `INSERT INTO "new_drafts" (...) SELECT (...) FROM "drafts"`. **That INSERT…SELECT is what preserves your rows — if it is absent, stop and do not apply.**

- [ ] **Step 5: Rehearse on a copy before touching the real database**

```bash
cp data/app.db /tmp/rehearse2.db
DATABASE_URL="file:/tmp/rehearse2.db" bunx prisma migrate deploy
bun -e "const {Database}=require('bun:sqlite');const db=new Database('/tmp/rehearse2.db');
console.log('rows:',db.query('select count(*) c from drafts').get().c);
console.log('tables:',db.query(\"select name from sqlite_master where type='table'\").all().map(t=>t.name).join(', '));
console.log(db.query('select topic,brand_id,created_at from drafts order by created_at desc limit 2').all())"
```

Expected: the original row count, tables including `brands`/`brand_sources`/`brand_documents`, `brand_id` null on every row, and `created_at` values unchanged. Only proceed when all four hold.

- [ ] **Step 6: Apply to the real local database and regenerate**

```bash
DATABASE_URL="file:./data/app.db" bunx prisma migrate deploy
DATABASE_URL="file:./data/app.db" bun run prisma:generate
```

- [ ] **Step 7: Write `src/brands.ts`**

```ts
import { getDb } from './db';

export type BrandRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_default: boolean;
  language: string;
  collection_name: string;
  corpus_hash: string | null;
  created_at: string;
};

export type NewBrand = {
  name: string;
  slug: string;
  language: string;
  status?: string;
};

function toBrandRow(b: {
  id: string; name: string; slug: string; status: string; isDefault: boolean;
  language: string; collectionName: string; corpusHash: string | null; createdAt: Date;
}): BrandRow {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    status: b.status,
    is_default: b.isDefault,
    language: b.language,
    collection_name: b.collectionName,
    corpus_hash: b.corpusHash,
    created_at: b.createdAt.toISOString().replace('T', ' ').slice(0, 19),
  };
}

/** Chroma collection names allow [a-zA-Z0-9._-] only, so the slug is narrowed. */
export function collectionNameFor(slug: string): string {
  return `brand_${slug.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
}

export async function createBrand(input: NewBrand): Promise<BrandRow> {
  const created = await getDb().brand.create({
    data: {
      name: input.name,
      slug: input.slug,
      language: input.language,
      status: input.status ?? 'draft',
      collectionName: collectionNameFor(input.slug),
    },
  });
  return toBrandRow(created);
}

export async function listBrands(): Promise<BrandRow[]> {
  const rows = await getDb().brand.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  return rows.map(toBrandRow);
}

export async function getBrand(id: string): Promise<BrandRow | null> {
  const row = await getDb().brand.findUnique({ where: { id } });
  return row ? toBrandRow(row) : null;
}

export async function getDefaultBrand(): Promise<BrandRow | null> {
  const row = await getDb().brand.findFirst({ where: { isDefault: true } });
  return row ? toBrandRow(row) : null;
}

export async function updateBrand(id: string, patch: { name?: string }): Promise<BrandRow> {
  const row = await getDb().brand.update({ where: { id }, data: patch });
  return toBrandRow(row);
}

/** Exactly one brand is default; clearing every other row is part of setting one. */
export async function setDefaultBrand(id: string): Promise<void> {
  const db = getDb();
  await db.$transaction([
    db.brand.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    db.brand.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function setBrandCorpusHash(id: string, hash: string): Promise<void> {
  await getDb().brand.update({ where: { id }, data: { corpusHash: hash } });
}

/**
 * The embeddable corpus for a brand. `included: false` documents — raw scraped
 * pages kept for provenance — are deliberately excluded so nav and footer text
 * never reaches the vector store.
 */
export async function getBrandCorpus(
  brandId: string,
): Promise<Array<{ source: string; content: string }>> {
  const docs = await getDb().brandDocument.findMany({
    where: { brandId, included: true },
    orderBy: { createdAt: 'asc' },
  });
  return docs.map((d) => ({ source: `${d.kind}:${d.id}`, content: `# ${d.title}\n\n${d.content}` }));
}
```

- [ ] **Step 8: Run the tests and gates**

```bash
bun test tests/unit/brands.test.ts
bun run typecheck && bunx biome ci . && bun run test:unit
```

- [ ] **Step 9: Commit**

```bash
git add prisma src/brands.ts tests/unit/brands.test.ts
git commit -m "feat: add brand models, the feature migration and a brand repository

The migration is authored with migrate diff from the live database state
rather than migrate dev, which would read the pre-existing created_at
divergence as drift and offer to reset. Prisma emits a table redefinition
whose INSERT...SELECT preserves every row and resolves that divergence in
passing; rehearsed against a copy of data/app.db.

getBrandCorpus returns only included documents, so raw scraped pages can be
kept for provenance in phase 2 without polluting retrieval."
```

---

### Task 4: Seed the EONYX brand and backfill existing drafts

**Files:**
- Create: `scripts/seed-brand.ts`
- Modify: `package.json`
- Test: manual — this is a one-shot data script

**Interfaces:**
- Consumes: `createBrand`, `setDefaultBrand` (Task 3); `getDb` (Task 2).
- Produces: an active default `Brand` named `EONYX` with `language: 'uk'`, its documents, and `drafts.brand_id` backfilled.

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-brand.ts`:

```ts
import 'dotenv/config';
import { createBrand, getDefaultBrand, setDefaultBrand } from '../src/brands';
import { getDb } from '../src/db';

const BRAND_DIR = 'data/brand';

/** Mirrors loadFromLocal() in src/tools/rag.ts, which this replaces at runtime. */
async function readCorpus(): Promise<Array<{ kind: string; title: string; content: string }>> {
  const glob = new Bun.Glob('**/*.md');
  const files = (await Array.fromAsync(glob.scan(BRAND_DIR))).sort();
  if (files.length === 0) throw new Error(`No .md files found in ${BRAND_DIR}`);
  return Promise.all(
    files.map(async (file) => ({
      kind: file.startsWith('examples/')
        ? 'exemplar'
        : file.includes('style')
          ? 'style_guide'
          : 'profile',
      title: file.replace(/\.md$/, ''),
      content: await Bun.file(`${BRAND_DIR}/${file}`).text(),
    })),
  );
}

async function main(): Promise<void> {
  const existing = await getDefaultBrand();
  if (existing) {
    console.log(`[seed] Default brand already exists (${existing.name}) — nothing to do.`);
    return;
  }

  const docs = await readCorpus();
  const brand = await createBrand({ name: 'EONYX', slug: 'eonyx', language: 'uk', status: 'active' });
  const db = getDb();

  for (const doc of docs) {
    await db.brandDocument.create({
      data: { brandId: brand.id, kind: doc.kind, title: doc.title, content: doc.content, included: true },
    });
  }
  await setDefaultBrand(brand.id);

  // Existing drafts genuinely were written against this corpus, so attributing
  // them to it is truthful rather than convenient.
  const backfilled = await db.draft.updateMany({
    where: { brandId: null },
    data: { brandId: brand.id },
  });

  console.log(
    `[seed] Created brand "${brand.name}" (${brand.id}) with ${docs.length} documents; ` +
      `backfilled ${backfilled.count} draft(s).`,
  );
}

main().catch((err) => {
  console.error('[seed] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Add the script**

In `package.json` scripts:

```json
    "seed-brand": "bun run scripts/seed-brand.ts",
```

- [ ] **Step 3: Rehearse on a copy**

```bash
cp data/app.db /tmp/rehearse3.db
DATABASE_URL="file:/tmp/rehearse3.db" bun run seed-brand
bun -e "const {Database}=require('bun:sqlite');const db=new Database('/tmp/rehearse3.db');
console.log(db.query('select name,slug,language,status,is_default from brands').all());
console.log('docs:',db.query('select kind,count(*) c from brand_documents group by kind').all());
console.log('drafts with brand:',db.query('select count(*) c from drafts where brand_id is not null').get().c);"
```

Expected: one `EONYX` brand (`uk`, `active`, default), documents split across `profile`/`style_guide`/`exemplar`, and every existing draft attributed.

- [ ] **Step 4: Confirm it is idempotent**

```bash
DATABASE_URL="file:/tmp/rehearse3.db" bun run seed-brand
```

Expected: `Default brand already exists (EONYX) — nothing to do.`

- [ ] **Step 5: Seed the real local database**

```bash
DATABASE_URL="file:./data/app.db" bun run seed-brand
```

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-brand.ts package.json
git commit -m "feat: seed the EONYX brand from data/brand and backfill drafts

Existing drafts were genuinely written against this corpus, so attributing
them to it is truthful rather than convenient. Idempotent: a second run
finds the default brand and exits."
```

---

### Task 5: Per-brand vector collections

**Files:**
- Modify: `src/tools/rag.ts`, `src/tools/index.ts`, `src/nodes/editor.ts`, `src/nodes/strategist.ts`
- Test: `tests/unit/rag.test.ts`

**Interfaces:**
- Consumes: `getBrandCorpus`, `getBrand`, `setBrandCorpusHash` (Task 3).
- Produces: `lookupBrandStyle(query: string, brandId: string): Promise<string>`; `makeBrandStyleRetriever(brandId: string)` returning a LangChain tool named `brand_style_lookup`. The old zero-argument `brandStyleRetriever` export is removed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/rag.test.ts` — it covers the pure helper, keeping the suite free of network and embedding calls:

```ts
import { describe, expect, test } from 'bun:test';
import { corpusHash } from '../../src/tools/rag';

describe('corpusHash', () => {
  test('is stable regardless of document order', () => {
    const a = [
      { source: 'style_guide:1', content: 'RULES' },
      { source: 'profile:2', content: 'MISSION' },
    ];
    const b = [...a].reverse();
    expect(corpusHash(a)).toBe(corpusHash(b));
  });

  test('changes when content changes', () => {
    const a = [{ source: 'style_guide:1', content: 'RULES' }];
    const b = [{ source: 'style_guide:1', content: 'RULES v2' }];
    expect(corpusHash(a)).not.toBe(corpusHash(b));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/rag.test.ts`
Expected: FAIL — `corpusHash` is not exported from `src/tools/rag.ts`.

- [ ] **Step 3: Rework `src/tools/rag.ts`**

Export the existing `corpusHash` function (add the `export` keyword; its body is unchanged). Then replace the corpus loading and store caches:

```ts
import { getBrand, getBrandCorpus, setBrandCorpusHash } from '../brands';

type SourceDoc = { source: string; content: string };

// One store per brand, per process. Both backends key on brand id so callers
// never learn which is in use.
const chromaStores = new Map<string, Promise<Chroma>>();
const memoryStores = new Map<string, Promise<MemoryVectorStore>>();

async function loadCorpus(brandId: string): Promise<SourceDoc[]> {
  const docs = await getBrandCorpus(brandId);
  if (docs.length === 0) {
    throw new Error(
      `Brand ${brandId} has no included documents — run "bun run seed-brand" or ingest a corpus.`,
    );
  }
  return docs;
}
```

`buildVectorStore(brandId, forceReindex)` keeps its existing structure but reads `collectionName` from `getBrand(brandId)` instead of the `CHROMA_COLLECTION` env var, calls `loadCorpus(brandId)`, and persists the hash with `setBrandCorpusHash(brandId, hash)` rather than writing Chroma collection metadata. `buildMemoryStore(brandId)` calls `loadCorpus(brandId)` the same way.

Replace the two lookup functions:

```ts
async function lookupMemory(query: string, brandId: string): Promise<string[]> {
  const store = await getMemoryStore(brandId);
  const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
  return store.search(await embeddings.embedQuery(query), 4);
}

async function lookupChroma(query: string, brandId: string): Promise<string[]> {
  const store = await getStore(brandId);
  const docs = await store.similaritySearch(query, 4);
  return docs.map((doc) => doc.pageContent);
}

export async function lookupBrandStyle(query: string, brandId: string): Promise<string> {
  const texts =
    VECTOR_STORE === 'memory'
      ? await lookupMemory(query, brandId)
      : await lookupChroma(query, brandId);
  if (texts.length === 0) return 'No relevant brand style documents found.';
  return texts.join('\n---\n');
}

/**
 * A factory rather than a module-scope tool: `createAgent` binds tools at
 * construction, so the brand has to be closed over per run. The strategist
 * node is where `state.brief` is in scope.
 */
export function makeBrandStyleRetriever(brandId: string) {
  return tool(
    async ({ query }, config) => {
      const threadId = config?.configurable?.thread_id as string | undefined;
      reportActivity(threadId, { kind: 'brand_style_lookup', detail: query });
      return lookupBrandStyle(query, brandId);
    },
    {
      name: 'brand_style_lookup',
      description:
        'Search the brand style guide, tone-of-voice rules, and approved example posts. Use this before planning content to ensure alignment with brand voice and channel requirements.',
      schema: z.object({
        query: z
          .string()
          .describe("What to look up, e.g. 'LinkedIn tone rules' or 'forbidden phrases'"),
      }),
    },
  );
}
```

`reindex()` takes a `brandId` and clears that brand's entry from both maps before rebuilding.

- [ ] **Step 4: Update the exports and the two call sites**

`src/tools/index.ts`:

```ts
export { lookupBrandStyle, makeBrandStyleRetriever } from './rag';
export { searchTool } from './search';
```

`src/nodes/strategist.ts` — replace the `brandStyleRetriever` import with `makeBrandStyleRetriever`, and build the tool inside the node:

```ts
    tools: [searchTool, makeBrandStyleRetriever(state.brief.brand_id)],
```

`src/nodes/editor.ts` — pass the brand:

```ts
  const brandStyle = await lookupBrandStyle(
    `${state.brief.channel} tone of voice rules, forbidden phrases, style guide`,
    state.brief.brand_id,
  );
```

- [ ] **Step 5: Update `scripts/reindex.ts`**

It currently calls `reindex()` with no argument. Make it resolve the default brand first:

```ts
const brand = await getDefaultBrand();
if (!brand) throw new Error('No default brand — run "bun run seed-brand" first.');
await reindex(brand.id);
```

- [ ] **Step 6: Run the tests and gates**

```bash
bun test tests/unit/rag.test.ts
bun run typecheck && bunx biome ci . && bun run test:unit
```

Note: `src/nodes/*.ts` will not typecheck until Task 6 adds `brand_id` to `BriefSchema`. Do Task 6 before expecting a green `typecheck`, and commit the two together if that is simpler.

- [ ] **Step 7: Commit**

```bash
git add src/tools src/nodes scripts/reindex.ts tests/unit/rag.test.ts
git commit -m "feat: give every brand its own vector collection

lookupBrandStyle gains a required brandId and reads the corpus from SQLite
rather than files or Notion, which become seed-time importers. The corpus
hash moves onto the Brand row, so the memory backend can finally use it —
production runs VECTOR_STORE=memory and re-embedded the whole corpus on
every container start.

brandStyleRetriever becomes makeBrandStyleRetriever(brandId): createAgent
binds tools at construction, so a module-scope tool has no way to see which
brand a run is for."
```

---

### Task 6: `brand_id` on the brief, and the brand endpoints

**Files:**
- Modify: `src/schemas.ts`, `src/server.ts`, `src/cli.ts`
- Test: `tests/unit/server.test.ts`

**Interfaces:**
- Consumes: `listBrands`, `getBrand`, `getDefaultBrand`, `updateBrand`, `setDefaultBrand` (Task 3).
- Produces: `Brief.brand_id: string`; `GET /brands`, `GET /brands/:id`, `PATCH /brands/:id`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/server.test.ts`:

```ts
test('GET /brands requires auth like every other data route', async () => {
  process.env.DEMO_PASSWORD = 'secret';
  const res = await app.request('/brands');
  expect(res.status).toBe(401);
  process.env.DEMO_PASSWORD = '';
});

test('POST /runs rejects a brief with an unknown brand', async () => {
  const res = await app.request('/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic: 'T',
      channel: 'blog',
      tone: 'professional',
      target_audience: 'A',
      word_count: 500,
      language: 'uk',
      brand_id: 'does-not-exist',
    }),
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/server.test.ts -t "brand"`
Expected: FAIL — `/brands` 404s because the route does not exist, and `/runs` accepts the unknown brand.

- [ ] **Step 3: Add `brand_id` to `BriefSchema`**

In `src/schemas.ts`, append to `BriefSchema`:

```ts
  brand_id: z.string().min(1).describe('Brand whose corpus and voice this content follows'),
```

- [ ] **Step 4: Add the routes and the brand check**

In `src/server.ts`, import the brand repository and register `/brands` on the auth loop — Hono matches `/brands` and `/brands/*` separately, so both are needed:

```ts
for (const route of ['/runs', '/runs/*', '/drafts', '/drafts/*', '/brands', '/brands/*', '/stats']) {
  app.use(route, requireAuth);
}
```

```ts
app.get('/brands', async (c) => c.json(await listBrands()));

app.get('/brands/:id', async (c) => {
  const brand = await getBrand(c.req.param('id'));
  if (!brand) return c.json({ error: 'brand not found' }, 404);
  return c.json(brand);
});

const BrandPatchSchema = z.object({
  name: z.string().min(1).optional(),
  is_default: z.literal(true).optional(),
});

app.patch('/brands/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await getBrand(id))) return c.json({ error: 'brand not found' }, 404);
  const parsed = BrandPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  if (parsed.data.is_default) await setDefaultBrand(id);
  const updated = parsed.data.name
    ? await updateBrand(id, { name: parsed.data.name })
    : await getBrand(id);
  return c.json(updated);
});
```

In the `POST /runs` handler, after `BriefSchema.safeParse` succeeds:

```ts
  const brand = await getBrand(parsed.data.brand_id);
  if (!brand || brand.status !== 'active') {
    return c.json({ error: 'unknown or inactive brand' }, 400);
  }
```

- [ ] **Step 5: Add `--brand` to the CLI**

In `src/cli.ts`, add `brand: { type: 'string' }` to the `parseArgs` options and `brand: z.string().optional()` to `ArgsSchema`. Resolve it before building the brief:

```ts
  const brand = args.brand ? await getBrand(args.brand) : await getDefaultBrand();
  if (!brand) {
    console.error('No brand found. Run "bun run seed-brand" first, or pass --brand <id>.');
    process.exit(1);
  }
```

Pass `brand_id: brand.id` into `BriefSchema.parse`, and add to `USAGE`:

```
  --brand       Brand id to write for (default: the default brand)
```

- [ ] **Step 6: Fix the remaining Brief fixtures**

`tests/fixtures/briefs.ts` and `tests/unit/runManagerActivity.test.ts` construct `Brief` literals. Add `brand_id: 'test-brand'` to each of the five.

- [ ] **Step 7: Run the tests and gates**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
```

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat: attach every run to a brand

BriefSchema gains a required brand_id; POST /runs rejects an unknown or
inactive one rather than silently retrieving from the wrong corpus. Adds
the three read/update brand endpoints the /run selector needs, guarded on
both /brands and /brands/* since Hono matches them separately."
```

---

### Task 7: Brand selector and attribution in the dashboard

**Files:**
- Modify: `web/lib/types.ts`, `web/lib/api.ts`, `web/components/brief-form.tsx`, `web/app/(dashboard)/run/page.tsx`, `web/app/(dashboard)/drafts/page.tsx`, `web/app/(dashboard)/drafts/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /brands` (Task 6); `DraftRow.brand_id` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Add the types**

In `web/lib/types.ts`:

```ts
export type Brand = {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_default: boolean;
  language: string;
  collection_name: string;
  corpus_hash: string | null;
  created_at: string;
};
```

Add `brand_id: string | null;` to `DraftRow`.

- [ ] **Step 2: Add the fetcher**

In `web/lib/api.ts`:

```ts
export async function fetchBrands(): Promise<Brand[]> {
  return (await get<Brand[]>('/brands')) ?? [];
}
```

Import the `Brand` type alongside `DraftRow`.

- [ ] **Step 3: Pass brands into the form**

`BriefForm` is a Client Component but `/run`'s page is one too, so fetch client-side. In `web/app/(dashboard)/run/page.tsx`, add state and load on mount:

```tsx
  const [brands, setBrands] = useState<Brand[]>([]);

  useEffect(() => {
    fetch('/api/brands')
      .then((res) => (res.ok ? res.json() : []))
      .then((list: Brand[]) => setBrands(list))
      .catch(() => setBrands([]));
  }, []);
```

Pass `brands={brands}` to `<BriefForm />`, and add `brand_id: formData.get('brand_id'),` to the `POST /api/runs` body.

- [ ] **Step 4: Render the selector**

In `web/components/brief-form.tsx`, accept the prop and render a field. The default brand sorts first from the API, so the first option is already the right default:

```tsx
export function BriefForm({
  running,
  brands,
  onSubmit,
}: {
  running: boolean;
  brands: Brand[];
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
```

```tsx
          <label className={LABEL}>
            Brand
            <select name="brand_id" className={FIELD}>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                  {brand.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </label>
```

- [ ] **Step 5: Show brand attribution on the drafts screens**

In `web/app/(dashboard)/drafts/page.tsx`, fetch brands alongside drafts and build a lookup so ids render as names:

```tsx
  const [drafts, brands] = await Promise.all([fetchDrafts(), fetchBrands()]);
  const brandName = new Map(brands.map((brand) => [brand.id, brand.name]));
```

Add a header cell `<th className="eonyx-label p-3 font-normal">Brand</th>` after Channel, and a matching body cell:

```tsx
                  <td className="p-3 text-muted-foreground">
                    {draft.brand_id ? (brandName.get(draft.brand_id) ?? '—') : '—'}
                  </td>
```

In `web/app/(dashboard)/drafts/[id]/page.tsx`, add the brand to the metadata line under the title by fetching brands and resolving `draft.brand_id` the same way.

- [ ] **Step 6: Typecheck the web app**

```bash
cd web && bun run build
```

- [ ] **Step 7: Commit**

```bash
git add web
git commit -m "feat: pick a brand per run and show it on every draft

The API sorts the default brand first, so the selector needs no separate
notion of a default."
```

---

### Task 8: Deployment, environment and documentation

**Files:**
- Modify: `Dockerfile`, `docker-entrypoint.sh`, `fly.toml`, `package.json`, `README.md`, `CLAUDE.md`, `web/AGENTS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Generate the client during the image build**

In `Dockerfile`, in the `api-deps` stage after `bun install`:

```dockerfile
COPY prisma prisma
COPY prisma.config.ts ./
RUN bunx prisma generate
```

In the `runtime` stage, copy the generated client and the migrations:

```dockerfile
COPY --from=api-deps /app/src/generated src/generated
COPY prisma prisma
COPY prisma.config.ts ./
```

Replace `ENV DRAFTS_DB_PATH=/data/app.db` with:

```dockerfile
ENV DATABASE_URL=file:/data/app.db
```

- [ ] **Step 2: Run migrations before the API starts**

In `docker-entrypoint.sh`, immediately after `set -euo pipefail`:

```bash
# Migrations must land before either process serves traffic. `set -e` turns a
# failure here into a non-zero exit, which is the behaviour we want: the
# platform restarts rather than serving against a stale schema.
bunx prisma migrate deploy
```

- [ ] **Step 3: Update `fly.toml`**

Replace `DRAFTS_DB_PATH = '/data/app.db'` with `DATABASE_URL = 'file:/data/app.db'` in the `[env]` block.

- [ ] **Step 4: Update the judge-test script**

In `package.json`, `test:judge` currently sets `DRAFTS_DB_PATH=:memory:`. Change it to:

```json
    "test:judge": "DATABASE_URL=:memory: MAX_ITERATIONS=2 MAX_SEARCHES=3 bun test tests/judge",
```

- [ ] **Step 5: Document it**

In `README.md`, replace `DRAFTS_DB_PATH` in the environment block with `DATABASE_URL=file:./data/app.db`, add `bun run seed-brand` to the setup steps ahead of the first run, and add `--brand` to the CLI options table:

```
| `--brand` | Brand id (default: the default brand) | no |
```

In `CLAUDE.md`, replace the "Drafts persist to SQLite, not files, by default" section's first sentence with one naming Prisma, and add:

> **Never run `prisma migrate dev` against a database with real data.** The pre-Prisma `drafts` table declares `created_at TEXT DEFAULT (datetime('now'))` where Prisma models `DATETIME DEFAULT CURRENT_TIMESTAMP`; `migrate dev` reads that as drift and offers to reset. Author migrations with `prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` and apply them with `prisma migrate deploy`. Prisma 7 also removed `url` from the `datasource` block — it lives in `prisma.config.ts` — and the libSQL adapter class is `PrismaLibSql`, not `PrismaLibSQL`.

Add a "Brands" subsection recording that `lookupBrandStyle(query, brandId)` reads its corpus from `brand_documents where included = true`, that `data/brand/*.md` is now only a seed source, and that the corpus hash lives on the `Brand` row so the in-process store no longer re-embeds on every boot.

- [ ] **Step 6: Verify the container builds and migrates**

```bash
docker build -t cca-phase1 . 2>&1 | tail -5
docker run --rm -e DATABASE_URL=file:/tmp/test.db -e OPENAI_API_KEY=x -e SKIP_PUBLISH=true \
  cca-phase1 sh -c 'bunx prisma migrate deploy && echo MIGRATE_OK'
```

Expected: the build succeeds and `MIGRATE_OK` prints.

- [ ] **Step 7: Full gates**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit && (cd web && bun run build)
```

- [ ] **Step 8: Commit**

```bash
git add Dockerfile docker-entrypoint.sh fly.toml package.json README.md CLAUDE.md web/AGENTS.md
git commit -m "chore: run migrations at container start and document the Prisma rules

DATABASE_URL replaces DRAFTS_DB_PATH everywhere. migrate deploy runs before
either process serves traffic; set -e makes a failure exit the container,
matching its existing refusal to serve half-dead."
```

---

## Verification before handoff

Phase 1 is merged but **not deployed** — production sees it only alongside phase 2. Before merging, confirm on a copy of the production database:

```bash
cp data/app.db /tmp/final-check.db
DATABASE_URL="file:/tmp/final-check.db" bunx prisma migrate status
DATABASE_URL="file:/tmp/final-check.db" bun run seed-brand
DATABASE_URL="file:/tmp/final-check.db" bun run src/server.ts &
sleep 3
curl -s localhost:3000/brands | head -c 200; echo
curl -s localhost:3000/drafts | head -c 200; echo
lsof -ti:3000 | xargs kill
```

Every pre-existing draft must still be listed, attributed to EONYX, with its original `created_at`.

## Out of scope for this phase

- **Ingestion.** No crawler, distiller, review gate or `POST /brands`. Phase 2.
- **`DELETE /brands/:id`** and the `/brands` screens. Phase 2.
- **The Editor verdict bug** — `REVISION_NEEDED` on scores above the 0.8 threshold. Tracked separately.
- **Deploying.** Merge only.
