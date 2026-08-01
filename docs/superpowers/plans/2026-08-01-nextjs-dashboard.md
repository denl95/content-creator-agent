# Next.js Dashboard + Fly.io Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file demo UI with a designed Next.js dashboard (4 screens), gate it behind a shared password, and deploy the whole thing to Fly.io as one container.

**Architecture:** Next.js in `web/` is frontend-only; it proxies `/api/*` to the existing Hono server, which keeps owning the LangGraph pipeline, SQLite, and SSE. Backend gains three contained additions: a `/stats` aggregation endpoint, an auth module, and an in-process vector store so Chroma isn't needed in production. Both processes run in one container behind Next's port.

**Tech Stack:** Bun 1.3.5, Hono 4, Next.js 16, React 19, Tailwind 4, shadcn/ui, Recharts 3, `bun:sqlite`, Fly.io.

**Spec:** `docs/superpowers/specs/2026-08-01-nextjs-dashboard-design.md`

## Global Constraints

- Runtime is **Bun** (`bun`, `bun test`, `bun add`) for everything under the repo root — never npm/node (see `.cursor/rules/`). `web/` is the documented exception if Next-specific runtime bugs appear; record it in `CLAUDE.md` if it happens.
- Biome enforces style at the repo root: single quotes, 2-space indent, semicolons, line width 100. Run `bun run check` before committing, and **only stage the files your task owns** — `bun run check` reformats the whole repo, so revert unrelated churn with `git checkout -- <file>` after confirming it's cosmetic.
- `web/` is **excluded from root Biome and tsc**; it has its own ESLint/tsconfig from `create-next-app`. Add `web` to `biome.json`'s ignore list and to `tsconfig.json`'s `exclude` in Task 4.
- Unit tests live in `tests/unit/`, never call an LLM or external service, and run via `bun run test:unit`. The existing 19 must stay green.
- **All frontend→backend calls go through `/api/*`.** Next rewrites `/api/:path*` → `${API_ORIGIN}/:path*`. Never rewrite bare `/drafts` or `/runs` — those collide with page routes.
- New env vars: `DEMO_PASSWORD` (unset = auth disabled), `VECTOR_STORE` (`chroma`|`memory`, default `chroma`), `API_ORIGIN` (default `http://localhost:3000`), `NEXT_PORT` (default `3001`), `ENABLE_SSE_DEBUG` (`true` registers the diagnostic endpoint).
- Commit messages: conventional style (`feat:`, `fix:`, `chore:`, `docs:`) — **no Co-Authored-By line**.
- Branch: create `nextjs-dashboard` off `main` before Task 1. `main` is currently clean at `ac36c61`.

---

### Task 1: `/stats` aggregation endpoint

**Files:**
- Modify: `src/db.ts` (append `Stats` type + `getStats()`)
- Modify: `src/server.ts` (add `GET /stats`)
- Test: `tests/unit/stats.test.ts` (create)

**Interfaces:**
- Consumes: `getDb()`, `insertDraft()`, `resetDbForTests()` from `src/db.ts`.
- Produces:
```ts
export type Stats = {
  totalDrafts: number;
  approvedCount: number;
  approvalRate: number;          // 0 when totalDrafts === 0, never NaN
  totalCostUsd: number;
  avgIterations: number;
  avgScores: { tone: number; accuracy: number; structure: number };
  byChannel: Array<{ channel: string; count: number }>;
  spendByDay: Array<{ day: string; costUsd: number }>;  // day = 'YYYY-MM-DD'
};
export function getStats(): Stats;
```
`GET /stats` returns this object as JSON with status 200.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/stats.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { getDb, getStats, insertDraft, resetDbForTests } from '../../src/db';

afterEach(() => resetDbForTests());

function draft(id: string, over: Partial<Parameters<typeof insertDraft>[0]> = {}) {
  return {
    id,
    topic: 'T',
    channel: 'blog',
    tone: 'professional',
    audience: 'SMB owners',
    content: 'body',
    word_count: 100,
    verdict: 'APPROVED' as string | null,
    tone_score: 0.9 as number | null,
    accuracy_score: 0.8 as number | null,
    structure_score: 0.7 as number | null,
    iterations: 2,
    issues: [] as string[],
    ...over,
  };
}

describe('getStats', () => {
  test('returns zeros on an empty database, never NaN', () => {
    getDb(':memory:');
    const s = getStats();
    expect(s.totalDrafts).toBe(0);
    expect(s.approvedCount).toBe(0);
    expect(s.approvalRate).toBe(0);
    expect(s.totalCostUsd).toBe(0);
    expect(s.avgIterations).toBe(0);
    expect(Number.isNaN(s.approvalRate)).toBe(false);
    expect(s.byChannel).toEqual([]);
    expect(s.spendByDay).toEqual([]);
  });

  test('computes totals, approval rate and average scores', () => {
    getDb(':memory:');
    insertDraft(draft('a'));
    insertDraft(draft('b', { verdict: 'REVISION_NEEDED', iterations: 4, tone_score: 0.5 }));
    const s = getStats();
    expect(s.totalDrafts).toBe(2);
    expect(s.approvedCount).toBe(1);
    expect(s.approvalRate).toBeCloseTo(0.5, 5);
    expect(s.avgIterations).toBeCloseTo(3, 5);
    expect(s.avgScores.tone).toBeCloseTo(0.7, 5);
  });

  test('groups by channel, most frequent first', () => {
    getDb(':memory:');
    insertDraft(draft('a', { channel: 'blog' }));
    insertDraft(draft('b', { channel: 'twitter' }));
    insertDraft(draft('c', { channel: 'twitter' }));
    const s = getStats();
    expect(s.byChannel[0]).toEqual({ channel: 'twitter', count: 2 });
    expect(s.byChannel[1]).toEqual({ channel: 'blog', count: 1 });
  });

  test('sums cost per day in ascending date order', () => {
    getDb(':memory:');
    insertDraft(draft('a'));
    insertDraft(draft('b'));
    const s = getStats();
    expect(s.spendByDay).toHaveLength(1);
    expect(s.spendByDay[0]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.spendByDay[0]?.costUsd).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/stats.test.ts`
Expected: FAIL — `getStats` is not exported from `src/db.ts`.

- [ ] **Step 3: Implement `getStats` in `src/db.ts`**

Append to `src/db.ts`:

```ts
export type Stats = {
  totalDrafts: number;
  approvedCount: number;
  approvalRate: number;
  totalCostUsd: number;
  avgIterations: number;
  avgScores: { tone: number; accuracy: number; structure: number };
  byChannel: Array<{ channel: string; count: number }>;
  spendByDay: Array<{ day: string; costUsd: number }>;
};

type TotalsRow = {
  totalDrafts: number;
  approvedCount: number;
  totalCostUsd: number;
  avgIterations: number;
  avgTone: number;
  avgAccuracy: number;
  avgStructure: number;
};

export function getStats(): Stats {
  const database = getDb();

  const totals = database
    .query(
      `SELECT
         COUNT(*) AS totalDrafts,
         COALESCE(SUM(CASE WHEN verdict = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approvedCount,
         COALESCE(SUM(cost_usd), 0) AS totalCostUsd,
         COALESCE(AVG(iterations), 0) AS avgIterations,
         COALESCE(AVG(tone_score), 0) AS avgTone,
         COALESCE(AVG(accuracy_score), 0) AS avgAccuracy,
         COALESCE(AVG(structure_score), 0) AS avgStructure
       FROM drafts`,
    )
    .get() as TotalsRow;

  const byChannel = database
    .query(
      `SELECT channel, COUNT(*) AS count
       FROM drafts
       GROUP BY channel
       ORDER BY count DESC, channel ASC`,
    )
    .all() as Array<{ channel: string; count: number }>;

  const spendByDay = database
    .query(
      `SELECT date(created_at) AS day, COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM drafts
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all() as Array<{ day: string; costUsd: number }>;

  return {
    totalDrafts: totals.totalDrafts,
    approvedCount: totals.approvedCount,
    approvalRate: totals.totalDrafts === 0 ? 0 : totals.approvedCount / totals.totalDrafts,
    totalCostUsd: totals.totalCostUsd,
    avgIterations: totals.avgIterations,
    avgScores: {
      tone: totals.avgTone,
      accuracy: totals.avgAccuracy,
      structure: totals.avgStructure,
    },
    byChannel,
    spendByDay,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/stats.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Expose the endpoint**

In `src/server.ts`, change the `./db` import to include `getStats`, and add this route immediately after the `app.get('/drafts', ...)` line:

```ts
app.get('/stats', (c) => c.json(getStats()));
```

- [ ] **Step 6: Verify and commit**

Run: `bun run typecheck && bun run test:unit && bun run check`
Expected: typecheck exit 0, 23 tests pass, biome clean.

```bash
git add src/db.ts src/server.ts tests/unit/stats.test.ts
git commit -m "feat: add /stats aggregation endpoint for the dashboard"
```

---

### Task 2: In-process vector store

**Files:**
- Create: `src/tools/memoryVectorStore.ts`
- Modify: `src/tools/rag.ts` (add `VECTOR_STORE` switch)
- Test: `tests/unit/memoryVectorStore.test.ts` (create)

**Interfaces:**
- Consumes: `OpenAIEmbeddings`, `RecursiveCharacterTextSplitter`, and the existing private `loadFromNotion()` / `loadFromLocal()` in `src/tools/rag.ts`.
- Produces:
```ts
// src/tools/memoryVectorStore.ts
export function cosineSimilarity(a: number[], b: number[]): number;
export class MemoryVectorStore {
  add(text: string, vector: number[]): void;
  get size(): number;
  search(queryVector: number[], k: number): string[];  // most similar first
}
```
`lookupBrandStyle(query: string): Promise<string>` keeps its exact existing signature — callers in `src/nodes/editor.ts` and `brandStyleRetriever` do not change.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/memoryVectorStore.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { cosineSimilarity, MemoryVectorStore } from '../../src/tools/memoryVectorStore';

describe('cosineSimilarity', () => {
  test('identical vectors score 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  test('orthogonal vectors score 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  test('magnitude does not affect similarity', () => {
    expect(cosineSimilarity([1, 1], [5, 5])).toBeCloseTo(1, 6);
  });

  test('a zero vector scores 0 rather than NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('MemoryVectorStore', () => {
  test('returns the k most similar texts, most similar first', () => {
    const store = new MemoryVectorStore();
    store.add('exact', [1, 0, 0]);
    store.add('close', [0.9, 0.1, 0]);
    store.add('far', [0, 0, 1]);
    expect(store.size).toBe(3);
    expect(store.search([1, 0, 0], 2)).toEqual(['exact', 'close']);
  });

  test('k larger than the corpus returns everything without error', () => {
    const store = new MemoryVectorStore();
    store.add('only', [1, 0]);
    expect(store.search([1, 0], 10)).toEqual(['only']);
  });

  test('an empty store returns an empty array', () => {
    expect(new MemoryVectorStore().search([1, 0], 4)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/memoryVectorStore.test.ts`
Expected: FAIL — `Cannot find module '../../src/tools/memoryVectorStore'`.

- [ ] **Step 3: Implement the store**

Create `src/tools/memoryVectorStore.ts`:

```ts
/**
 * Minimal in-process vector store. LangChain 1.x ships no in-memory vector store
 * (MemoryVectorStore existed in 0.x; the @langchain/community options need native
 * modules), and the brand corpus is small enough that a linear scan is fine.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class MemoryVectorStore {
  private entries: Array<{ text: string; vector: number[] }> = [];

  add(text: string, vector: number[]): void {
    this.entries.push({ text, vector });
  }

  get size(): number {
    return this.entries.length;
  }

  search(queryVector: number[], k: number): string[] {
    return this.entries
      .map((entry) => ({ text: entry.text, score: cosineSimilarity(queryVector, entry.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((scored) => scored.text);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/memoryVectorStore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire the `VECTOR_STORE` switch into `src/tools/rag.ts`**

Add the import at the top of `src/tools/rag.ts`:

```ts
import { MemoryVectorStore } from './memoryVectorStore';
```

Add this constant next to the existing `COLLECTION` constant:

```ts
const VECTOR_STORE = process.env.VECTOR_STORE ?? 'chroma';
```

Add this block immediately above the existing `export async function lookupBrandStyle`:

```ts
let memoryStorePromise: Promise<MemoryVectorStore> | null = null;

async function buildMemoryStore(): Promise<MemoryVectorStore> {
  const docs = (await loadFromNotion()) ?? (await loadFromLocal());
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 });
  const chunkLists = await Promise.all(
    docs.map((d) => splitter.createDocuments([d.content], [{ source: d.source }])),
  );
  const texts = chunkLists.flat().map((chunk) => chunk.pageContent);

  const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
  const vectors = await embeddings.embedDocuments(texts);

  const store = new MemoryVectorStore();
  texts.forEach((text, i) => {
    const vector = vectors[i];
    if (vector) store.add(text, vector);
  });
  console.log(`[rag] Built in-process vector store — ${store.size} chunks from ${docs.length} docs`);
  return store;
}

function getMemoryStore(): Promise<MemoryVectorStore> {
  if (!memoryStorePromise) memoryStorePromise = buildMemoryStore();
  return memoryStorePromise;
}

async function lookupBrandStyleMemory(query: string): Promise<string> {
  const store = await getMemoryStore();
  const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
  const queryVector = await embeddings.embedQuery(query);
  const results = store.search(queryVector, 4);
  if (results.length === 0) return 'No relevant brand style documents found.';
  return results.join('\n---\n');
}
```

Then replace the body of `lookupBrandStyle` so it dispatches:

```ts
export async function lookupBrandStyle(query: string): Promise<string> {
  if (VECTOR_STORE === 'memory') return lookupBrandStyleMemory(query);
  const store = await getStore();
  const results = await store.similaritySearch(query, 4);
  if (results.length === 0) return 'No relevant brand style documents found.';
  return results.map((doc) => doc.pageContent).join('\n---\n');
}
```

- [ ] **Step 6: Verify and commit**

Run: `bun run typecheck && bun run test:unit && bun run check`
Expected: typecheck exit 0, 30 tests pass.

Manual check (requires `OPENAI_API_KEY`, no Chroma needed) — confirms the memory path returns real brand text:

```bash
VECTOR_STORE=memory bun -e "import {lookupBrandStyle} from './src/tools/rag'; console.log((await lookupBrandStyle('instagram tone rules')).slice(0,200))"
```
Expected: prints brand-guide prose, and a `[rag] Built in-process vector store — N chunks` log line.

```bash
git add src/tools/memoryVectorStore.ts src/tools/rag.ts tests/unit/memoryVectorStore.test.ts
git commit -m "feat: add in-process vector store so Chroma is optional in production"
```

---

### Task 3: Auth module, Hono guard, and SSE debug endpoint

**Files:**
- Create: `src/auth.ts`
- Modify: `src/server.ts` (login/check routes, guard middleware, debug SSE endpoint)
- Test: `tests/unit/auth.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
```ts
// src/auth.ts
export const SESSION_COOKIE = 'demo_session';
export function isAuthEnabled(): boolean;          // false when DEMO_PASSWORD unset/empty
export function sessionToken(): string;            // HMAC-SHA256 hex; throws if auth disabled
export function verifyPassword(input: string): boolean;
export function verifySessionCookie(value: string | undefined): boolean;  // true when auth disabled
```
HTTP surface added: `POST /auth/login` `{password}` → 200 + `Set-Cookie`, or 401; `GET /auth/check` → 200 or 401; `GET /debug/sse-ping` (only when `ENABLE_SSE_DEBUG=true`) → 5 SSE events, 500 ms apart. `/runs*`, `/drafts*`, `/stats` return 401 without a valid cookie when auth is enabled.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/auth.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import {
  isAuthEnabled,
  sessionToken,
  verifyPassword,
  verifySessionCookie,
} from '../../src/auth';

const original = process.env.DEMO_PASSWORD;
afterEach(() => {
  if (original === undefined) delete process.env.DEMO_PASSWORD;
  else process.env.DEMO_PASSWORD = original;
});

describe('auth disabled (DEMO_PASSWORD unset)', () => {
  test('isAuthEnabled is false and every cookie passes', () => {
    delete process.env.DEMO_PASSWORD;
    expect(isAuthEnabled()).toBe(false);
    expect(verifySessionCookie(undefined)).toBe(true);
    expect(verifySessionCookie('anything')).toBe(true);
  });

  test('an empty string counts as unset', () => {
    process.env.DEMO_PASSWORD = '';
    expect(isAuthEnabled()).toBe(false);
  });
});

describe('auth enabled', () => {
  test('accepts the correct password and rejects others', () => {
    process.env.DEMO_PASSWORD = 'hunter2';
    expect(isAuthEnabled()).toBe(true);
    expect(verifyPassword('hunter2')).toBe(true);
    expect(verifyPassword('wrong')).toBe(false);
    expect(verifyPassword('')).toBe(false);
  });

  test('a token from the right password validates; a forged one does not', () => {
    process.env.DEMO_PASSWORD = 'hunter2';
    const token = sessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySessionCookie(token)).toBe(true);
    expect(verifySessionCookie('deadbeef')).toBe(false);
    expect(verifySessionCookie(undefined)).toBe(false);
  });

  test('the token is not the password itself', () => {
    process.env.DEMO_PASSWORD = 'hunter2';
    expect(sessionToken()).not.toContain('hunter2');
  });

  test('changing the password invalidates old tokens', () => {
    process.env.DEMO_PASSWORD = 'first';
    const old = sessionToken();
    process.env.DEMO_PASSWORD = 'second';
    expect(verifySessionCookie(old)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/auth.test.ts`
Expected: FAIL — `Cannot find module '../../src/auth'`.

- [ ] **Step 3: Implement `src/auth.ts`**

```ts
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'demo_session';

/** Read the password fresh each call so tests can change it at runtime. */
function password(): string | undefined {
  const value = process.env.DEMO_PASSWORD;
  return value && value.length > 0 ? value : undefined;
}

export function isAuthEnabled(): boolean {
  return password() !== undefined;
}

/** Opaque session value derived from the password — never the password itself. */
export function sessionToken(): string {
  const secret = password();
  if (!secret) throw new Error('sessionToken() called while auth is disabled');
  return crypto.createHmac('sha256', secret).update('content-creator-demo-session').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPassword(input: string): boolean {
  const secret = password();
  if (!secret) return false;
  return safeEqual(input, secret);
}

export function verifySessionCookie(value: string | undefined): boolean {
  if (!isAuthEnabled()) return true;
  if (!value) return false;
  return safeEqual(value, sessionToken());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add routes, guard, and the SSE debug endpoint to `src/server.ts`**

Add imports at the top:

```ts
import { getCookie, setCookie } from 'hono/cookie';
import { isAuthEnabled, SESSION_COOKIE, sessionToken, verifyPassword, verifySessionCookie } from './auth';
```

Add this immediately after `export const app = new Hono();`:

```ts
const LoginSchema = z.object({ password: z.string() });

app.post('/auth/login', async (c) => {
  if (!isAuthEnabled()) return c.json({ ok: true });
  const body = await c.req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'password required' }, 400);
  if (!verifyPassword(parsed.data.password)) return c.json({ error: 'invalid password' }, 401);
  setCookie(c, SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return c.json({ ok: true });
});

app.get('/auth/check', (c) => {
  if (!isAuthEnabled()) return c.json({ ok: true });
  return verifySessionCookie(getCookie(c, SESSION_COOKIE))
    ? c.json({ ok: true })
    : c.json({ error: 'unauthorized' }, 401);
});

const requireAuth = async (c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
  if (!isAuthEnabled()) return next();
  if (!verifySessionCookie(getCookie(c, SESSION_COOKIE))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
};

// Hono matches '/runs' and '/runs/*' separately — both must be registered.
for (const route of ['/runs', '/runs/*', '/drafts', '/drafts/*', '/stats']) {
  app.use(route, requireAuth);
}

if (process.env.ENABLE_SSE_DEBUG === 'true') {
  // Diagnostic only: emits 5 events 500ms apart so a proxy can be tested for
  // response buffering without spending money on a real pipeline run.
  app.get('/debug/sse-ping', (c) =>
    streamSSE(c, async (stream) => {
      for (let i = 0; i < 5; i++) {
        await stream.writeSSE({ data: JSON.stringify({ i, ts: Date.now() }) });
        await stream.sleep(500);
      }
    }),
  );
}
```

If the `requireAuth` parameter typing is awkward, import Hono's `MiddlewareHandler` type and annotate it as `const requireAuth: MiddlewareHandler = async (c, next) => {...}` instead.

- [ ] **Step 6: Verify auth actually gates the API**

Run: `bun run typecheck && bun run test:unit`
Expected: typecheck exit 0, 36 tests pass (existing `server.test.ts` still passes because `DEMO_PASSWORD` is unset there).

Manual check:

```bash
DEMO_PASSWORD=secret ENABLE_SSE_DEBUG=true PORT=3000 bun run src/server.ts &
sleep 2
curl -s -o /dev/null -w "no cookie -> %{http_code}\n" localhost:3000/drafts
curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"password":"wrong"}' -w " <- wrong password\n"
curl -s -c /tmp/jar -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"password":"secret"}'
curl -s -b /tmp/jar -o /dev/null -w "with cookie -> %{http_code}\n" localhost:3000/drafts
kill %1
```
Expected: `no cookie -> 401`, invalid-password JSON error, then `with cookie -> 200`.

- [ ] **Step 7: Commit**

```bash
git add src/auth.ts src/server.ts tests/unit/auth.test.ts
git commit -m "feat: add shared-password gate and SSE diagnostic endpoint"
```

---

### Task 4: Next.js scaffold + SSE buffering spike

This task exists to **de-risk the whole project**. If Next's proxy buffers SSE, the live pipeline view — the centerpiece of the demo — silently breaks. Find out now, before any UI is built on top of it.

**Files:**
- Create: `web/` (via `create-next-app`)
- Create: `web/next.config.ts`
- Create: `web/app/spike/page.tsx`
- Modify: `biome.json` (ignore `web`), `tsconfig.json` (exclude `web`), `package.json` (add `web` + `dev:all` scripts), `.gitignore` (`web/.next`, `web/node_modules`)

**Interfaces:**
- Consumes: `GET /debug/sse-ping` from Task 3.
- Produces: `web/` Next app on port 3001; all backend calls reachable at `/api/*`; root scripts `bun run web` and `bun run dev:all`.

- [ ] **Step 1: Scaffold the app**

Run from the repo root:

```bash
bunx create-next-app@latest web --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-bun
```

Accept defaults for anything else it prompts. Expected: `web/` exists with `app/page.tsx` and Tailwind 4 configured.

- [ ] **Step 2: Configure rewrites**

Replace `web/next.config.ts` entirely:

```ts
import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    // Everything backend is namespaced under /api so it can never collide with
    // page routes like /drafts or /runs.
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
};

export default nextConfig;
```

- [ ] **Step 3: Keep root tooling out of `web/`**

In `biome.json`, add `"!web"` to the `files.includes` array (alongside the existing `"!**/node_modules"` entries).

In `tsconfig.json`, add `"web"` to the `exclude` array.

In `.gitignore`, append:

```
web/.next
web/node_modules
web/out
```

In root `package.json` `scripts`, add:

```json
"web": "cd web && bun run dev --port ${NEXT_PORT:-3001}",
"dev:all": "bun run serve & bun run web"
```

- [ ] **Step 4: Write the SSE spike page**

Create `web/app/spike/page.tsx`:

```tsx
'use client';

import { useState } from 'react';

type Tick = { i: number; ts: number; receivedAt: number };

export default function SpikePage() {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [status, setStatus] = useState('idle');

  function start() {
    setTicks([]);
    setStatus('streaming');
    const source = new EventSource('/api/debug/sse-ping');
    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as { i: number; ts: number };
      setTicks((prev) => [...prev, { ...parsed, receivedAt: Date.now() }]);
    };
    source.onerror = () => {
      source.close();
      setStatus('closed');
    };
  }

  const gaps = ticks.slice(1).map((tick, i) => tick.receivedAt - (ticks[i]?.receivedAt ?? 0));
  const buffered = gaps.length > 0 && gaps.every((gap) => gap < 100);

  return (
    <main style={{ fontFamily: 'monospace', padding: 24 }}>
      <button type="button" onClick={start}>
        Start SSE ping
      </button>
      <p>status: {status}</p>
      <p>events: {ticks.length}</p>
      <p>gaps between arrivals (ms): {gaps.join(', ') || '—'}</p>
      <p style={{ fontWeight: 'bold' }}>
        {ticks.length < 5
          ? 'waiting for 5 events…'
          : buffered
            ? 'BUFFERED — all events arrived at once. Rewrites are NOT streaming.'
            : 'STREAMING OK — events arrived ~500ms apart.'}
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Run the spike and record the result**

```bash
ENABLE_SSE_DEBUG=true bun run serve &
bun run web &
```

Open `http://localhost:3001/spike` and click "Start SSE ping".

Expected: **"STREAMING OK — events arrived ~500ms apart."** with gaps near 500.

**If it reports BUFFERED**, the fallback from the spec applies and must be implemented before continuing:
1. Add `import { cors } from 'hono/cors';` to `src/server.ts` and `app.use('*', cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3001', credentials: true }));` as the first middleware.
2. Add `web/lib/api.ts` exporting `export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';` and have every `EventSource` use `` `${API_BASE}/runs/...` `` while normal fetches keep using `/api/*`.
3. Re-run this step against the direct origin to confirm streaming, and note the outcome in the commit message.

Stop both processes when done (`kill %1 %2`).

- [ ] **Step 6: Commit**

```bash
git add web biome.json tsconfig.json package.json .gitignore
git commit -m "feat: scaffold Next.js app with API rewrites and verify SSE streaming"
```

---

### Task 5: Login page and route protection

**Files:**
- Create: `web/proxy.ts`, `web/app/login/page.tsx`
- Test: manual (Next's proxy layer has no unit-test harness in this project)

**Next.js 16 note:** the `middleware.ts` convention is **deprecated and renamed to `proxy.ts`**, with the exported function renamed from `middleware` to `proxy` (see `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`). The proxy runtime is always `nodejs` and cannot be configured to `edge` — which suits us, since it needs to `fetch` the Hono server. Without a `matcher`, proxy runs on *every* request including `_next/static`, so the negative match below is required, not optional.

**Interfaces:**
- Consumes: `POST /auth/login`, `GET /auth/check` from Task 3, via `/api/auth/*`.
- Produces: every page except `/login` redirects to `/login` when unauthenticated. Auth is a no-op when `DEMO_PASSWORD` is unset on the server.

- [ ] **Step 1: Write the proxy**

Create `web/proxy.ts`:

```ts
import { type NextRequest, NextResponse } from 'next/server';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

export async function proxy(request: NextRequest) {
  // Single source of truth: the Hono server decides whether this cookie is valid.
  // It answers 200 unconditionally when DEMO_PASSWORD is unset, so local dev is unaffected.
  const check = await fetch(`${API_ORIGIN}/auth/check`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
  }).catch(() => null);

  if (check?.ok) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, Next internals, and the API proxy
  // (the API guards itself and must stay reachable for the login POST).
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 2: Write the login page**

Create `web/app/login/page.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (res.ok) {
      router.push('/');
      router.refresh();
      return;
    }
    setError('Incorrect password');
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">EONYX</h1>
        <p className="text-sm text-muted-foreground">Enter the demo password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border px-3 py-2"
          placeholder="Password"
          autoFocus
        />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={pending || password.length === 0}
          className="w-full rounded-md bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {pending ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Verify both states manually**

Auth disabled (normal local dev) — the app must behave exactly as before:

```bash
bun run serve & bun run web &
```
Visit `http://localhost:3001/spike`. Expected: loads directly, no redirect.

Auth enabled:

```bash
kill %1 %2
DEMO_PASSWORD=secret bun run serve & bun run web &
```
Visit `http://localhost:3001/spike`. Expected: redirected to `/login`; a wrong password shows "Incorrect password"; the correct one lands on `/`. Reloading `/spike` afterwards stays put.

Stop both processes.

- [ ] **Step 4: Commit**

```bash
git add web/proxy.ts web/app/login/page.tsx
git commit -m "feat: gate the dashboard behind a shared password"
```

---

### Task 6: Design system and app shell

**Files:**
- Modify: `web/app/globals.css` (design tokens)
- Create: `web/app/layout.tsx` (replace scaffold), `web/components/nav.tsx`, `web/components/stat-tile.tsx`, `web/components/verdict-badge.tsx`, `web/lib/format.ts`
- Test: `web/lib/format.ts` is pure — covered by manual verification alongside the screens that use it

**Interfaces:**
- Produces:
```ts
// web/lib/format.ts
export function formatUsd(value: number | null | undefined): string;   // '$0.0071', '—' when null
export function formatDate(iso: string): string;                       // '1 Aug 2026, 14:49'
export function formatPercent(ratio: number): string;                  // '67%'
// web/components/verdict-badge.tsx
export function VerdictBadge({ verdict }: { verdict: string | null }): JSX.Element;
// web/components/stat-tile.tsx
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element;
```

- [ ] **Step 1: Install shadcn/ui and the components used across screens**

```bash
cd web
bunx shadcn@latest init
bunx shadcn@latest add button card table badge input select separator
cd ..
```
Accept the defaults when prompted (New York style, CSS variables enabled — CSS variables are required by the token system below).

- [ ] **Step 2: Define the design tokens**

Append to `web/app/globals.css` (after whatever `shadcn init` wrote):

```css
:root {
  --brand: oklch(0.55 0.19 275);
  --brand-foreground: oklch(0.99 0 0);
  --state-approved: oklch(0.62 0.15 150);
  --state-approved-bg: oklch(0.95 0.04 150);
  --state-revision: oklch(0.65 0.15 70);
  --state-revision-bg: oklch(0.96 0.05 80);
}

/* Dark values are applied two ways: by shadcn's .dark class (if a toggle is ever
   added) and by OS preference. There is no theme toggle in scope — following the
   viewer's OS setting is what makes the demo look right on whatever machine a
   client opens it on. */
.dark {
  --brand: oklch(0.68 0.17 275);
  --brand-foreground: oklch(0.15 0 0);
  --state-approved: oklch(0.75 0.15 150);
  --state-approved-bg: oklch(0.28 0.05 150);
  --state-revision: oklch(0.78 0.14 75);
  --state-revision-bg: oklch(0.30 0.05 75);
}

@media (prefers-color-scheme: dark) {
  :root:not(.light) {
    --brand: oklch(0.68 0.17 275);
    --brand-foreground: oklch(0.15 0 0);
    --state-approved: oklch(0.75 0.15 150);
    --state-approved-bg: oklch(0.28 0.05 150);
    --state-revision: oklch(0.78 0.14 75);
    --state-revision-bg: oklch(0.30 0.05 75);
  }
}

@theme inline {
  --color-brand: var(--brand);
  --color-brand-foreground: var(--brand-foreground);
  --color-state-approved: var(--state-approved);
  --color-state-approved-bg: var(--state-approved-bg);
  --color-state-revision: var(--state-revision);
  --color-state-revision-bg: var(--state-revision-bg);
}
```

- [ ] **Step 3: Write the formatting helpers**

Create `web/lib/format.ts`:

```ts
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value.toFixed(4)}`;
}

export function formatDate(iso: string): string {
  // SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC; make it explicit before parsing.
  const parsed = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
```

- [ ] **Step 4: Write the shared components**

Create `web/components/verdict-badge.tsx`:

```tsx
export function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>;
  const approved = verdict === 'APPROVED';
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        approved
          ? 'bg-state-approved-bg text-state-approved'
          : 'bg-state-revision-bg text-state-revision'
      }`}
    >
      {verdict.replace('_', ' ').toLowerCase()}
    </span>
  );
}
```

Create `web/components/stat-tile.tsx`:

```tsx
import { Card, CardContent } from '@/components/ui/card';

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
```

Create `web/components/nav.tsx`:

```tsx
import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/run', label: 'New run' },
  { href: '/drafts', label: 'Drafts' },
];

export function Nav() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
        <span className="font-semibold tracking-tight">EONYX</span>
        <div className="flex gap-4 text-sm text-muted-foreground">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 5: Wire the shell into the layout**

Replace `web/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'EONYX — AI Content Pipeline',
  description: 'Plan, write, edit and publish on-brand content with a human in the loop.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Nav />
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Verify and commit**

```bash
cd web && bun run build && cd ..
```
Expected: build succeeds with no type errors.

```bash
git add web
git commit -m "feat: add design tokens, app shell and shared components"
```

---

### Task 7: `/run` screen (parity with the old UI)

**Files:**
- Create: `web/app/run/page.tsx`, `web/components/pipeline-progress.tsx`, `web/components/plan-approval.tsx`, `web/lib/types.ts`

**Interfaces:**
- Consumes: `POST /api/runs`, `GET /api/runs/:id/events`, `POST /api/runs/:id/resume`, `GET /api/drafts/:id` (all via rewrite). Event shape from `src/runManager.ts`: `{ node: string; data: unknown; ts: number; seq: number }`.
- Produces:
```ts
// web/lib/types.ts
export type RunEvent = { node: string; data: any; ts: number; seq: number };
export type ContentPlan = { outline: string[]; keywords: string[]; key_messages: string[]; target_audience: string; tone: string };
export type EditFeedback = { verdict: string; issues: string[]; tone_score: number; accuracy_score: number; structure_score: number };
export type DraftRow = { id: string; topic: string; channel: string; tone: string; audience: string; content: string; word_count: number; verdict: string | null; tone_score: number | null; accuracy_score: number | null; structure_score: number | null; iterations: number; issues: string; cost_usd: number | null; notion_url: string | null; created_at: string };
export const NODES: string[];  // ['strategist','hitl','writer','editor','finalizer','publisher']
```

Parity requirement — all of these must work before `public/index.html` is deleted in Task 12: brief form, live node progress, plan approve/revise with feedback, editor scores per iteration, final result, publish to Notion.

- [ ] **Step 1: Define shared types**

Create `web/lib/types.ts`:

```ts
export const NODES = ['strategist', 'hitl', 'writer', 'editor', 'finalizer', 'publisher'];

// biome-ignore lint/suspicious/noExplicitAny: event payloads are node-specific and narrowed at each use site
export type RunEvent = { node: string; data: any; ts: number; seq: number };

export type ContentPlan = {
  outline: string[];
  keywords: string[];
  key_messages: string[];
  target_audience: string;
  tone: string;
};

export type EditFeedback = {
  verdict: string;
  issues: string[];
  tone_score: number;
  accuracy_score: number;
  structure_score: number;
};

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
};
```

- [ ] **Step 2: Write the pipeline progress component**

Create `web/components/pipeline-progress.tsx`:

```tsx
import { NODES } from '@/lib/types';

export function PipelineProgress({ done, active }: { done: Set<string>; active: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      {NODES.map((node) => {
        const state = done.has(node) ? 'done' : node === active ? 'active' : 'idle';
        return (
          <span
            key={node}
            className={`rounded-full px-3 py-1 text-sm ${
              state === 'done'
                ? 'bg-state-approved-bg text-state-approved'
                : state === 'active'
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {node}
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Write the plan approval component**

Create `web/components/plan-approval.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ContentPlan } from '@/lib/types';

export function PlanApproval({
  plan,
  onDecision,
}: {
  plan: ContentPlan;
  onDecision: (approved: boolean, feedback?: string) => void;
}) {
  const [feedback, setFeedback] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Content plan — approve?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {plan.outline.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <p className="text-sm">
          <span className="font-medium">Keywords:</span> {plan.keywords.join(', ')}
        </p>
        <p className="text-sm">
          <span className="font-medium">Tone:</span> {plan.tone} ·{' '}
          <span className="font-medium">Audience:</span> {plan.target_audience}
        </p>
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="Feedback (required to request changes)"
          className="min-h-20 w-full rounded-md border p-2 text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={() => onDecision(true)}>Approve</Button>
          <Button
            variant="secondary"
            disabled={feedback.trim().length === 0}
            onClick={() => onDecision(false, feedback.trim())}
          >
            Request changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write the run page**

Create `web/app/run/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { PipelineProgress } from '@/components/pipeline-progress';
import { PlanApproval } from '@/components/plan-approval';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsd } from '@/lib/format';
import { type ContentPlan, type EditFeedback, NODES, type RunEvent } from '@/lib/types';

const CHANNELS = ['blog', 'linkedin', 'twitter', 'instagram', 'threads'];

export default function RunPage() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [feedback, setFeedback] = useState<EditFeedback | null>(null);
  const [result, setResult] = useState<{ costUsd: number; tokens: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const lastSeq = useRef(-1);
  const source = useRef<EventSource | null>(null);

  function listen(id: string) {
    source.current?.close();
    const es = new EventSource(`/api/runs/${id}/events`);
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RunEvent;
      // seq is monotonic per run; replayed events on reconnect are skipped.
      if (parsed.seq <= lastSeq.current) return;
      lastSeq.current = parsed.seq;
      handle(parsed);
    };
    source.current = es;
  }

  function handle(event: RunEvent) {
    if (NODES.includes(event.node)) {
      setDone((prev) => new Set(prev).add(event.node));
      setActive(null);
    }
    if (event.node === 'hitl' && event.data?.awaiting) {
      setPlan(event.data.payload?.plan ?? null);
    }
    if (event.node === 'editor' && event.data?.editFeedback) {
      setFeedback(event.data.editFeedback);
      setDone((prev) => {
        const next = new Set(prev);
        next.delete('editor');
        return next;
      });
      setActive('editor');
    }
    if (event.node === 'done') {
      setResult({ costUsd: event.data.costUsd ?? 0, tokens: event.data.tokens ?? 0 });
      setRunning(false);
      source.current?.close();
    }
    if (event.node === 'error') {
      setError(event.data.message ?? 'Run failed');
      setRunning(false);
      source.current?.close();
    }
  }

  async function start(formData: FormData) {
    setDone(new Set());
    setPlan(null);
    setFeedback(null);
    setResult(null);
    setError(null);
    lastSeq.current = -1;
    setRunning(true);
    setActive('strategist');

    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: formData.get('topic'),
        channel: formData.get('channel'),
        tone: formData.get('tone'),
        target_audience: formData.get('target_audience'),
        word_count: Number(formData.get('word_count')),
      }),
    });
    if (!res.ok) {
      setError('Invalid brief');
      setRunning(false);
      return;
    }
    const { thread_id } = (await res.json()) as { thread_id: string };
    setThreadId(thread_id);
    listen(thread_id);
  }

  async function decide(approved: boolean, note?: string) {
    if (!threadId) return;
    setPlan(null);
    setActive('writer');
    await fetch(`/api/runs/${threadId}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(approved ? { approved: true } : { approved: false, feedback: note }),
    });
    listen(threadId);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">New run</h1>

      <Card>
        <CardContent className="p-6">
          <form action={start} className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Topic
              <input name="topic" required className="rounded-md border px-3 py-2" defaultValue="How an AI assistant saves 10 hours a week" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Channel
              <select name="channel" className="rounded-md border px-3 py-2">
                {CHANNELS.map((channel) => (
                  <option key={channel}>{channel}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tone
              <input name="tone" required defaultValue="professional" className="rounded-md border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Audience
              <input name="target_audience" required defaultValue="SMB owners" className="rounded-md border px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Word count
              <input name="word_count" type="number" required defaultValue={800} className="rounded-md border px-3 py-2" />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={running} className="w-full">
                {running ? 'Running…' : 'Generate'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <PipelineProgress done={done} active={active} />

      {feedback ? (
        <p className="text-sm text-muted-foreground">
          editor: {feedback.verdict} · tone {feedback.tone_score} · accuracy {feedback.accuracy_score} ·
          structure {feedback.structure_score}
        </p>
      ) : null}

      {plan ? <PlanApproval plan={plan} onDecision={decide} /> : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {result && threadId ? (
        <Card>
          <CardHeader>
            <CardTitle>Done</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {formatUsd(result.costUsd)} · {result.tokens} tokens
            </p>
            <Link href={`/drafts/${threadId}`} className="text-sm underline">
              Open the finished draft →
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Verify against a real run**

```bash
bun run serve & bun run web &
```
Open `http://localhost:3001/run`, submit the pre-filled brief (use a small word count like 100 to keep it cheap), and confirm: node badges advance live, the plan card appears, Approve continues the run, editor scores update per iteration, and the done card links to the draft.

Note the draft id — Task 8 uses it. Stop both processes.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add /run screen with live pipeline progress and plan approval"
```

---

### Task 8: `/drafts` library and `/drafts/[id]` detail

**Files:**
- Create: `web/app/drafts/page.tsx`, `web/app/drafts/[id]/page.tsx`, `web/components/publish-button.tsx`, `web/lib/api.ts`

**Interfaces:**
- Consumes: `GET /api/drafts`, `GET /api/drafts/:id`, `POST /api/drafts/:id/publish`; `DraftRow` from Task 7; `formatUsd`/`formatDate` from Task 6.
- Produces:
```ts
// web/lib/api.ts — server-side fetch helpers (Server Components only)
export async function fetchDrafts(): Promise<DraftRow[]>;
export async function fetchDraft(id: string): Promise<DraftRow | null>;
export async function fetchStats(): Promise<Stats>;
```

- [ ] **Step 1: Write the server-side fetch helpers**

Create `web/lib/api.ts`:

```ts
import { headers } from 'next/headers';
import type { DraftRow } from './types';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

export type Stats = {
  totalDrafts: number;
  approvedCount: number;
  approvalRate: number;
  totalCostUsd: number;
  avgIterations: number;
  avgScores: { tone: number; accuracy: number; structure: number };
  byChannel: Array<{ channel: string; count: number }>;
  spendByDay: Array<{ day: string; costUsd: number }>;
};

/** Server Components talk to Hono directly, forwarding the caller's auth cookie. */
async function get<T>(path: string): Promise<T | null> {
  const cookie = (await headers()).get('cookie') ?? '';
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers: { cookie },
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as T;
}

export async function fetchDrafts(): Promise<DraftRow[]> {
  return (await get<DraftRow[]>('/drafts')) ?? [];
}

export async function fetchDraft(id: string): Promise<DraftRow | null> {
  return get<DraftRow>(`/drafts/${id}`);
}

export async function fetchStats(): Promise<Stats> {
  return (
    (await get<Stats>('/stats')) ?? {
      totalDrafts: 0,
      approvedCount: 0,
      approvalRate: 0,
      totalCostUsd: 0,
      avgIterations: 0,
      avgScores: { tone: 0, accuracy: 0, structure: 0 },
      byChannel: [],
      spendByDay: [],
    }
  );
}
```

- [ ] **Step 2: Write the drafts library page**

Create `web/app/drafts/page.tsx`:

```tsx
import Link from 'next/link';
import { VerdictBadge } from '@/components/verdict-badge';
import { fetchDrafts } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

export default async function DraftsPage() {
  const drafts = await fetchDrafts();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Drafts</h1>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No drafts yet. <Link href="/run" className="underline">Generate one →</Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">Topic</th>
                <th className="p-3 font-medium">Channel</th>
                <th className="p-3 font-medium">Verdict</th>
                <th className="p-3 text-right font-medium">Words</th>
                <th className="p-3 text-right font-medium">Cost</th>
                <th className="p-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <Link href={`/drafts/${draft.id}`} className="font-medium hover:underline">
                      {draft.topic}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{draft.channel}</td>
                  <td className="p-3"><VerdictBadge verdict={draft.verdict} /></td>
                  <td className="p-3 text-right tabular-nums">{draft.word_count}</td>
                  <td className="p-3 text-right tabular-nums">{formatUsd(draft.cost_usd)}</td>
                  <td className="p-3 text-muted-foreground">{formatDate(draft.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the publish button island**

Create `web/components/publish-button.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function PublishButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function publish() {
    setPending(true);
    setError('');
    const res = await fetch(`/api/drafts/${draftId}/publish`, { method: 'POST' });
    const body = (await res.json()) as { url?: string; error?: string };
    setPending(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    setError(body.error ?? 'Publish failed');
  }

  return (
    <div className="space-y-2">
      <Button onClick={publish} disabled={pending}>
        {pending ? 'Publishing…' : 'Publish to Notion'}
      </Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Write the draft detail page**

Create `web/app/drafts/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { PublishButton } from '@/components/publish-button';
import { StatTile } from '@/components/stat-tile';
import { VerdictBadge } from '@/components/verdict-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchDraft } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

export default async function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await fetchDraft(id);
  if (!draft) notFound();

  const issues = JSON.parse(draft.issues || '[]') as string[];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{draft.topic}</h1>
          <VerdictBadge verdict={draft.verdict} />
        </div>
        <p className="text-sm text-muted-foreground">
          {draft.channel} · {draft.tone} · {draft.audience} · {formatDate(draft.created_at)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Words" value={String(draft.word_count)} />
        <StatTile label="Cost" value={formatUsd(draft.cost_usd)} />
        <StatTile label="Iterations" value={String(draft.iterations)} />
        <StatTile
          label="Scores"
          value={`${draft.tone_score ?? '—'} / ${draft.accuracy_score ?? '—'} / ${draft.structure_score ?? '—'}`}
          hint="tone / accuracy / structure"
        />
      </div>

      {issues.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Editor issues</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{draft.content}</pre>
        </CardContent>
      </Card>

      {draft.notion_url ? (
        <a href={draft.notion_url} target="_blank" rel="noreferrer" className="text-sm underline">
          Open in Notion →
        </a>
      ) : (
        <PublishButton draftId={draft.id} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify**

```bash
bun run serve & bun run web &
```
Visit `http://localhost:3001/drafts`. Expected: the 3 existing drafts listed, newest first, costs formatted. Click one — content, scores, and issues render; the Instagram draft from 1 Aug shows an "Open in Notion" link, the others show a Publish button.

Also confirm `/drafts/does-not-exist` renders Next's 404 rather than crashing. Stop both processes.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add drafts library and draft detail screens"
```

---

### Task 9: `/` dashboard with charts

**Files:**
- Create: `web/app/page.tsx` (replace scaffold), `web/components/spend-chart.tsx`, `web/components/channel-chart.tsx`

**Interfaces:**
- Consumes: `fetchStats()`, `fetchDrafts()` from Task 8; `StatTile`, `VerdictBadge`, formatters from Task 6.
- Produces: nothing consumed by later tasks.

Charts must look composed with 1–3 data points, not broken. Both components render an explicit empty state rather than an axis with nothing on it.

- [ ] **Step 1: Install Recharts**

```bash
cd web && bun add recharts && cd ..
```

- [ ] **Step 2: Write the spend chart**

Create `web/components/spend-chart.tsx`:

```tsx
'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function SpendChart({ data }: { data: Array<{ day: string; costUsd: number }> }) {
  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No spend recorded yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={224}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} tickFormatter={(v) => `$${Number(v).toFixed(3)}`} />
        <Tooltip formatter={(value) => [`$${Number(value).toFixed(4)}`, 'spend']} />
        <Area
          type="monotone"
          dataKey="costUsd"
          stroke="var(--brand)"
          fill="var(--brand)"
          fillOpacity={0.15}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Write the channel chart**

Create `web/components/channel-chart.tsx`:

```tsx
'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function ChannelChart({ data }: { data: Array<{ channel: string; count: number }> }) {
  if (data.length === 0) {
    return (
      <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No drafts yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={224}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis dataKey="channel" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={32} />
        <Tooltip />
        <Bar dataKey="count" fill="var(--brand)" radius={[4, 4, 0, 0]} maxBarSize={56} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Write the dashboard page**

Replace `web/app/page.tsx`:

```tsx
import Link from 'next/link';
import { ChannelChart } from '@/components/channel-chart';
import { SpendChart } from '@/components/spend-chart';
import { StatTile } from '@/components/stat-tile';
import { VerdictBadge } from '@/components/verdict-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchDrafts, fetchStats } from '@/lib/api';
import { formatDate, formatPercent, formatUsd } from '@/lib/format';

export default async function DashboardPage() {
  const [stats, drafts] = await Promise.all([fetchStats(), fetchDrafts()]);
  const recent = drafts.slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Link href="/run" className="text-sm underline">New run →</Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Drafts" value={String(stats.totalDrafts)} />
        <StatTile
          label="Approved"
          value={formatPercent(stats.approvalRate)}
          hint={`${stats.approvedCount} of ${stats.totalDrafts}`}
        />
        <StatTile label="Total spend" value={formatUsd(stats.totalCostUsd)} />
        <StatTile label="Avg iterations" value={stats.avgIterations.toFixed(1)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Spend over time</CardTitle></CardHeader>
          <CardContent><SpendChart data={stats.spendByDay} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Drafts per channel</CardTitle></CardHeader>
          <CardContent><ChannelChart data={stats.byChannel} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent drafts</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. <Link href="/run" className="underline">Generate your first draft →</Link>
            </p>
          ) : (
            recent.map((draft) => (
              <div key={draft.id} className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <Link href={`/drafts/${draft.id}`} className="block truncate text-sm font-medium hover:underline">
                    {draft.topic}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {draft.channel} · {formatDate(draft.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <VerdictBadge verdict={draft.verdict} />
                  <span className="text-sm tabular-nums text-muted-foreground">{formatUsd(draft.cost_usd)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

```bash
bun run serve & bun run web &
```
Visit `http://localhost:3001/`. Expected with the 3 existing drafts: four stat tiles populated, both charts rendered and legible at low data volume, recent drafts listed and clickable.

Check the empty state too:
```bash
kill %1 %2
DRAFTS_DB_PATH=/tmp/empty-demo.db bun run serve & bun run web &
```
Expected: zeros, no `NaN`, both charts show their empty-state message rather than broken axes. Then `rm /tmp/empty-demo.db` and stop both processes.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add dashboard with spend and channel charts"
```

---

### Task 10: Dockerfile, entrypoint, and fly.toml

**Files:**
- Create: `Dockerfile`, `docker-entrypoint.sh`, `fly.toml`, `.dockerignore`

**Interfaces:**
- Consumes: everything above.
- Produces: an image running Hono on `:3000` (internal) and Next on `:8080` (public), with `DRAFTS_DB_PATH=/data/app.db` and `VECTOR_STORE=memory`.

The image uses a Node base with Bun installed on top: Node is required because the Notion publisher spawns `npx -y @notionhq/notion-mcp-server`, and Bun is required for `bun:sqlite` and the pipeline itself.

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
web/node_modules
web/.next
.git
data
output
.env
.superpowers
docs
screenshots
tests
```

- [ ] **Step 2: Write the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /app

# --- Build the Next.js frontend ---------------------------------------------
FROM base AS web-builder
COPY web/package.json web/bun.lock* web/
RUN cd web && (bun install --frozen-lockfile || bun install)
COPY web web
# API_ORIGIN is baked as a build-time default; the runtime env var overrides it.
RUN cd web && bun run build

# --- Install backend dependencies -------------------------------------------
FROM base AS api-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- Runtime -----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PORT=8080
ENV DRAFTS_DB_PATH=/data/app.db
ENV VECTOR_STORE=memory

COPY --from=api-deps /app/node_modules node_modules
COPY package.json bun.lock ./
COPY src src
COPY data/brand data/brand
COPY docker-entrypoint.sh ./

COPY --from=web-builder /app/web/.next/standalone web/
COPY --from=web-builder /app/web/.next/static web/.next/static
COPY --from=web-builder /app/web/public web/public

RUN chmod +x docker-entrypoint.sh
EXPOSE 8080
CMD ["./docker-entrypoint.sh"]
```

- [ ] **Step 3: Write the entrypoint**

Create `docker-entrypoint.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Hono API (internal only)
bun run src/server.ts &
API_PID=$!

# Next.js standalone server (public)
PORT="${NEXT_PORT}" HOSTNAME=0.0.0.0 node web/server.js &
WEB_PID=$!

# If either process dies the container must exit, so the platform restarts it —
# a half-dead container that still answers HTTP is worse than a crashed one.
trap 'kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true' TERM INT
wait -n "$API_PID" "$WEB_PID"
EXIT_CODE=$?
kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
exit "$EXIT_CODE"
```

- [ ] **Step 4: Write `fly.toml`**

Replace `<app-name>` with the name chosen during `fly launch`, and `<region>` with a region near you (e.g. `waw`, `fra`, `iad`).

```toml
app = "<app-name>"
primary_region = "<region>"

[build]

[env]
  PORT = "3000"
  NEXT_PORT = "8080"
  DRAFTS_DB_PATH = "/data/app.db"
  VECTOR_STORE = "memory"
  API_ORIGIN = "http://localhost:3000"
  NODE_ENV = "production"

[http_service]
  internal_port = 8080
  force_https = true
  # CRITICAL: in-memory run state means a stopped machine loses in-flight runs.
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[mounts]]
  source = "demo_data"
  destination = "/data"

[[vm]]
  size = "shared-cpu-1x"
  memory = "1gb"
```

- [ ] **Step 5: Build and run the image locally**

```bash
docker build -t content-creator-demo .
docker run --rm -p 8080:8080 \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e TAVILY_API_KEY="$TAVILY_API_KEY" \
  -e DEMO_PASSWORD=secret \
  -v "$(pwd)/tmp-data:/data" \
  content-creator-demo
```

Expected: both processes start; `http://localhost:8080` redirects to `/login`; the password works; the dashboard loads with an empty state (fresh volume). Then `rm -rf tmp-data`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-entrypoint.sh fly.toml .dockerignore
git commit -m "chore: containerize the API and dashboard for Fly.io"
```

---

### Task 11: Deploy to Fly.io and smoke-test live

**Files:** none — this task is deployment and verification only.

**Requires:** a Fly.io account with `flyctl` installed and authenticated (`fly auth login`). This step needs the repo owner; an agent cannot complete it unattended.

- [ ] **Step 1: Create the app and volume**

```bash
fly launch --no-deploy --copy-config --name <app-name> --region <region>
fly volumes create demo_data --region <region> --size 1
```

- [ ] **Step 2: Set secrets**

```bash
fly secrets set \
  OPENAI_API_KEY="..." \
  TAVILY_API_KEY="..." \
  DEMO_PASSWORD="..." \
  OPENAI_MODEL="gpt-4o-mini"
```

If using a gpt-5.x reasoning model, also set `OPENAI_REASONING_EFFORT=none` (see `src/model.ts`).

Optional, for Notion publishing: `fly secrets set NOTION_TOKEN="..." NOTION_DRAFTS_DATABASE_ID="..."`.

- [ ] **Step 3: Deploy and pin to a single machine**

```bash
fly deploy
fly scale count 1
fly status
```
Expected: exactly one machine, state `started`.

- [ ] **Step 4: Smoke-test the live URL**

Against `https://<app-name>.fly.dev`, verify each item:

1. The root URL redirects to `/login`; a wrong password is rejected; the correct one enters.
2. `/run` completes a full brief → approve → result cycle, with progress streaming live (not appearing all at once — this is the deployed proof that SSE survives the proxy).
3. The finished draft appears in `/drafts` and opens in `/drafts/[id]`.
4. The dashboard shows non-zero spend.

- [ ] **Step 5: Verify persistence and no-sleep — the two ways this deployment fails**

```bash
fly machine restart <machine-id>
```
Then reload `/drafts`. Expected: the draft is still listed (volume persisted).

Leave the app untouched for 20+ minutes, then run:
```bash
fly status
```
Expected: still `started`. If it shows `stopped`, `auto_stop_machines` did not take effect — fix `fly.toml`, redeploy, and re-verify. **Do not skip this**: a machine that stops silently will kill a run mid-demo.

- [ ] **Step 6: Record the deployment**

Append the live URL and the two verification results to the PR description or `README.md`. No code commit required unless `fly.toml` changed during troubleshooting — in which case:

```bash
git add fly.toml
git commit -m "chore: correct Fly machine configuration after live verification"
```

---

### Task 12: Retire the old UI and update docs

**Files:**
- Delete: `public/index.html`
- Modify: `src/server.ts` (drop static serving), `README.md`, `CLAUDE.md`, `.env.example`

- [ ] **Step 1: Confirm parity before deleting anything**

Re-read the parity list from Task 7 and confirm each item works on `/run`: brief form, live node progress, plan approve/revise with feedback, editor scores per iteration, final result, publish to Notion. If any item is missing, fix it before proceeding — this deletion is the point of no return for the old UI.

- [ ] **Step 2: Delete the old UI and its static route**

```bash
git rm public/index.html
```

In `src/server.ts`, remove the `serveStatic` import and the `app.use('/*', serveStatic({ root: './public' }));` line. The Hono server is now API-only.

- [ ] **Step 3: Update `.env.example`**

Append:

```
# Shared password for the deployed demo (unset = no auth, local dev default)
DEMO_PASSWORD=

# Vector store backend: chroma (local dev) | memory (no Chroma service needed)
VECTOR_STORE=chroma

# Next.js frontend
API_ORIGIN=http://localhost:3000
NEXT_PORT=3001

# Set to "true" to expose GET /debug/sse-ping for proxy buffering diagnostics
ENABLE_SSE_DEBUG=
```

- [ ] **Step 4: Update `README.md`**

Replace the "Web UI & API" section body with:

- `bun run dev:all` starts the Hono API and the Next dashboard together; the dashboard is at `http://localhost:3001`
- The four screens: `/` dashboard, `/run`, `/drafts`, `/drafts/[id]`
- Setting `DEMO_PASSWORD` enables the login gate; leaving it unset disables auth for local development
- `VECTOR_STORE=memory` runs without Chroma
- The app deploys to Fly.io as a single container (`fly deploy`), with SQLite on a persistent volume

- [ ] **Step 5: Update `CLAUDE.md`**

Add a `web/` section to the architecture notes covering:

- Next.js lives in `web/`, is frontend-only, and reaches the API exclusively through the `/api/*` rewrite — never rewrite bare `/drafts` or `/runs`, as they collide with page routes
- `web/` is excluded from root Biome and tsc and has its own ESLint/tsconfig
- Auth has a single source of truth: `src/auth.ts` on the Hono side; Next's `proxy.ts` delegates to `GET /auth/check` rather than duplicating the HMAC
- SSE dedup is keyed on `seq`, not `ts` (see the existing note in this file), and the `/run` page must preserve that
- Whether Next ended up running on Bun or Node in `web/` (record the actual outcome from Task 4)

- [ ] **Step 6: Verify and commit**

```bash
bun run typecheck && bun run test:unit && bun run check && cd web && bun run build && cd ..
```
Expected: all green.

```bash
git add -A
git commit -m "chore: retire the static demo UI in favour of the Next.js dashboard"
```

---

## Deferred (not in this plan)

- Authentication with real user accounts, roles, or multi-tenancy
- Moving run state out of memory (required before more than one machine can run)
- Postgres migration — the Fly volume keeps SQLite viable
- Editing draft content in the UI
- Notion inline rich-text formatting (F9 from the previous spec, still open)

## Verification against spec success criteria

After Task 12, confirm each criterion from the spec §10:

1. A client can be sent the URL, enter a password, and generate content unaided — Task 11 Step 4
2. Live pipeline progress streams correctly through the deployed proxy — Task 11 Step 4, item 2
3. Drafts survive a machine restart — Task 11 Step 5
4. The machine is still running after an idle period — Task 11 Step 5
5. The dashboard reads well at three drafts — Task 9 Step 5
6. `public/index.html` deleted with `/run` at parity — Task 12 Steps 1–2
7. Hosting is roughly $3–6/month on a commercially-licensed plan, with OpenAI spend behind the password — Task 10 (`shared-cpu-1x`, 1 GB) and Task 3
