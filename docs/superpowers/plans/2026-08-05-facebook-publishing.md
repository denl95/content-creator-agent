# Facebook Page Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator post a finished draft to a Facebook Page they own, as a manual per-draft action alongside the existing Notion publish.

**Architecture:** A new leaf module `src/publishers/facebook.ts` calls the Graph API with plain `fetch`. A pure `markdownToPlainText()` converts the draft, since Facebook renders no formatting. A sibling route `POST /drafts/:id/publish/facebook` leaves the Notion route untouched, records the post URL in a new `facebook_url` column, and refuses a second post server-side. The dashboard gains a second link-or-button block with an inline two-step confirmation.

**Tech Stack:** Bun, TypeScript, Hono, Prisma 7 + libSQL, Next.js 16, Biome, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-05-facebook-publishing-design.md`

## Global Constraints

- **Runtime is Bun.** Use `bun`, `bun test`, `bunx`. Never `node`, `npm`, `yarn`, `pnpm`, `jest`.
- **No new dependencies.** Everything here uses `fetch` and what is already installed. In particular, do not add `@radix-ui/react-alert-dialog` or a Facebook SDK.
- **`bun run check` before every commit.** Biome enforces single quotes, 2-space indent, semicolons, organized imports.
- **`web/` is excluded from root Biome and root `tsc`.** Typecheck it with `cd web && bun run build`, not `bun run typecheck`.
- **Never run `prisma migrate dev`.** The pre-Prisma `created_at TEXT DEFAULT (datetime('now'))` reads as drift against Prisma's `DATETIME DEFAULT CURRENT_TIMESTAMP`, and `migrate dev` responds by offering to reset the database. Author migrations with `prisma migrate diff`, apply with `prisma migrate deploy`.
- **`updateMany`, never `update`, for draft writes.** `update` throws P2025 when no row matches; the hand-written SQL it replaced was a silent no-op.
- **Graph API version:** `v26.0`, held in `src/constants.ts` and overridable by `FACEBOOK_API_VERSION`.
- **Facebook message cap:** 63,206 characters.
- **Error codes are exact strings:** `facebook_not_configured`, `facebook_already_published`, `facebook_publish_failed`.
- **Both locales, always.** `tests/unit/i18n.test.ts` asserts en/uk key parity *and* that no Ukrainian string equals its English source (only `app.name` may match). A new key needs genuinely different text in `uk.ts`.
- **No test may make a live Graph call.** `fetch` is stubbed everywhere.

---

### Task 1: `markdownToPlainText()`

Drafts are markdown; Facebook renders none of it. This is a pure function so it can be tested without a network.

**Files:**
- Modify: `src/utils/text.ts` (currently only `countWords`)
- Test: `tests/unit/text.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: nothing
- Produces: `export function markdownToPlainText(md: string): string`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/text.test.ts`, and add `markdownToPlainText` to the existing import from `../../src/utils/text`:

```ts
describe('markdownToPlainText', () => {
  test('strips ATX heading markers, keeping the text', () => {
    expect(markdownToPlainText('# One\n\n## Two\n\n###### Six')).toBe('One\n\nTwo\n\nSix');
  });

  test('turns bullets into • and leaves numbered items alone', () => {
    expect(markdownToPlainText('- first\n* second\n+ third')).toBe('• first\n• second\n• third');
    expect(markdownToPlainText('1. first\n2. second')).toBe('1. first\n2. second');
  });

  test('unwraps emphasis, strong and inline code', () => {
    expect(markdownToPlainText('**bold** and *em* and __b__ and _e_ and `code`')).toBe(
      'bold and em and b and e and code',
    );
  });

  test('unwraps emphasis nested inside strong, leaving no stray asterisk', () => {
    // `[^*]+` cannot span the inner pair, so the outer `**` never matches and
    // the delimiters survive into a public post.
    expect(markdownToPlainText('**bold *italic* inside**')).toBe('bold italic inside');
    expect(markdownToPlainText('This is **bold with *nested* emphasis** here.')).toBe(
      'This is bold with nested emphasis here.',
    );
  });

  test('keeps a code span verbatim even when it contains emphasis characters', () => {
    expect(markdownToPlainText('Check out `*args` and `**kwargs` in Python.')).toBe(
      'Check out *args and **kwargs in Python.',
    );
  });

  test('renders links and images as text followed by the url', () => {
    expect(markdownToPlainText('See [our site](https://eonyx.net) today')).toBe(
      'See our site (https://eonyx.net) today',
    );
    expect(markdownToPlainText('![a logo](https://eonyx.net/logo.png)')).toBe(
      'a logo (https://eonyx.net/logo.png)',
    );
  });

  test('leaves underscores in urls alone, linked or bare', () => {
    // The emphasis rule would otherwise eat `_page_` and post a dead link.
    expect(markdownToPlainText('[read](https://eonyx.net/my_page_name)')).toBe(
      'read (https://eonyx.net/my_page_name)',
    );
    expect(markdownToPlainText('Visit https://eonyx.net/my_page_name today')).toBe(
      'Visit https://eonyx.net/my_page_name today',
    );
  });

  test('keeps fenced code contents and drops the fences', () => {
    expect(markdownToPlainText('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  test('drops quote markers and horizontal rules', () => {
    expect(markdownToPlainText('> quoted\n\n---\n\nafter')).toBe('quoted\n\nafter');
  });

  test('collapses runs of blank lines to one and trims', () => {
    expect(markdownToPlainText('\n\na\n\n\n\nb\n\n')).toBe('a\n\nb');
  });

  test('leaves Ukrainian prose untouched', () => {
    expect(markdownToPlainText('## Заголовок\n\n**жирний** текст')).toBe(
      'Заголовок\n\nжирний текст',
    );
  });

  test('converts a realistic draft without leaving markdown syntax behind', () => {
    const draft = [
      '# How AI Saves You 10 Hours',
      '',
      'Most owners **underestimate** this.',
      '',
      '## Where the hours go',
      '',
      '- Inbox triage — 2 hours',
      '- Reporting — 3 hours',
      '',
      'Read more at [our blog](https://eonyx.net/blog).',
    ].join('\n');
    const out = markdownToPlainText(draft);
    expect(out).not.toContain('#');
    expect(out).not.toContain('**');
    expect(out).not.toContain('](');
    expect(out).toContain('• Inbox triage — 2 hours');
    expect(out).toContain('our blog (https://eonyx.net/blog)');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/text.test.ts`
Expected: FAIL — `markdownToPlainText` is not exported from `src/utils/text`.

- [ ] **Step 3: Implement**

Append to `src/utils/text.ts`:

```ts
/**
 * Inline markdown → plain text.
 *
 * Anything whose content is verbatim — a code span, a URL — is parked as a
 * placeholder before the emphasis passes and restored after. Unwrapping it
 * early would feed it back through those passes: `` `*args` `` comes out as
 * `args`, and `.../my_page_name` comes out as `.../mypagename`, which is a
 * broken link in a public post.
 *
 * The emphasis patterns are lazy (`.+?`) rather than `[^*]+`, so a bold span
 * can contain an inner italic. With `[^*]+` the outer `**` never matches and
 * the italic pass eats the delimiters piecemeal, stranding literal asterisks
 * in the output — the exact thing this function exists to prevent.
 */
function stripInline(text: string): string {
  const verbatim: string[] = [];
  // U+0000 cannot occur in a draft, so a placeholder can never collide with
  // prose. The index makes restoration independent of replacement order.
  const park = (value: string): string => {
    verbatim.push(value);
    return `\u0000${verbatim.length - 1}\u0000`;
  };

  const parked = text
    .replace(/`([^`]+)`/g, (_match, code: string) => park(code))
    // Images before links: `![a](u)` would otherwise match the link pattern
    // and keep its leading `!`.
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
      (_match, alt: string, url: string) => `${alt} (${park(url)})`,
    )
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
      (_match, label: string, url: string) => `${label} (${park(url)})`,
    )
    // A bare URL is as vulnerable to the underscore rule as a linked one, and
    // drafts do carry them.
    .replace(/\bhttps?:\/\/\S+/g, (url: string) => park(url));

  return parked
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => verbatim[Number(index)] ?? '');
}

/**
 * Flatten a markdown draft for a destination that renders no formatting —
 * Facebook posts a `message` string and shows `##` and `**` literally.
 *
 * Line-oriented rather than a real parser: drafts are prose with headings,
 * bullets and links, and a parser would be a dependency for output nobody
 * round-trips.
 *
 * Known limitation: a bare word carrying two underscores (`snake_case_name`)
 * has the pair between them read as emphasis, so both are consumed and the
 * word comes back fused — `snakecasename`. URLs and code spans, where this
 * would do real damage, are protected in `stripInline`; loose identifiers in
 * prose are not, and do not occur in the drafts this pipeline writes.
 */
export function markdownToPlainText(md: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    // Inside a fence the text is verbatim — no heading or bullet rules apply.
    if (inFence) {
      out.push(line);
      continue;
    }
    // A horizontal rule carries no words, so it becomes nothing at all.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;

    let text = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    text = text.replace(/^\s{0,3}>\s?/, '');
    text = text.replace(/^(\s*)[-*+]\s+/, '$1• ');
    out.push(stripInline(text));
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/text.test.ts`
Expected: PASS, including the three pre-existing `countWords` tests.

- [ ] **Step 5: Format, typecheck, commit**

```bash
bun run check
bun run typecheck
git add src/utils/text.ts tests/unit/text.test.ts
git commit -m "feat: convert draft markdown to plain text for non-rendering destinations"
```

---

### Task 2: Graph API transport

**Files:**
- Create: `src/publishers/facebook.ts`
- Modify: `src/constants.ts`
- Test: `tests/unit/facebookPublisher.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `export const FACEBOOK_API_VERSION: string` and `export const FACEBOOK_MAX_MESSAGE_CHARS: number` from `src/constants.ts`
  - `export type FacebookPostArgs = { pageId: string; accessToken: string; message: string }`
  - `export type FacebookPostResult = { id: string; url: string }`
  - `export async function publishToFacebook(args: FacebookPostArgs): Promise<FacebookPostResult>`
  - `export async function fetchPageName(pageId: string, accessToken: string): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/facebookPublisher.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FACEBOOK_MAX_MESSAGE_CHARS } from '../../src/constants';
import { fetchPageName, publishToFacebook } from '../../src/publishers/facebook';

const realFetch = globalThis.fetch;

/** Records every call so the request itself can be asserted, not just the result. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('publishToFacebook', () => {
  test('posts the message to the page feed and returns the post url', async () => {
    const stub = stubFetch(() => json({ id: '1234_5678' }));

    const result = await publishToFacebook({
      pageId: '1234',
      accessToken: 'tok',
      message: 'Hello world',
    });

    expect(result).toEqual({ id: '1234_5678', url: 'https://www.facebook.com/1234_5678' });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toContain('/1234/feed');
    expect(stub.calls[0]?.init?.method).toBe('POST');
    const body = String(stub.calls[0]?.init?.body);
    expect(body).toContain('message=Hello+world');
    expect(body).toContain('access_token=tok');
  });

  test("surfaces Meta's own error message and code", async () => {
    stubFetch(() =>
      json(
        { error: { message: 'Error validating access token: Session has expired', code: 190 } },
        400,
      ),
    );

    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'stale', message: 'Hi' }),
    ).rejects.toThrow(/Session has expired.*190/);
  });

  test('falls back to the status when Meta returns no error body', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));
    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'tok', message: 'Hi' }),
    ).rejects.toThrow(/500/);
  });

  test('rejects an over-length message without calling the network', async () => {
    const stub = stubFetch(() => json({ id: 'never' }));

    await expect(
      publishToFacebook({
        pageId: '1234',
        accessToken: 'tok',
        message: 'x'.repeat(FACEBOOK_MAX_MESSAGE_CHARS + 1),
      }),
    ).rejects.toThrow(/at most/);
    expect(stub.calls).toHaveLength(0);
  });

  test('rejects an empty message without calling the network', async () => {
    const stub = stubFetch(() => json({ id: 'never' }));
    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'tok', message: '   \n ' }),
    ).rejects.toThrow(/empty/);
    expect(stub.calls).toHaveLength(0);
  });

  test('throws when Meta accepts the post but returns no id', async () => {
    stubFetch(() => json({}));
    await expect(
      publishToFacebook({ pageId: '1234', accessToken: 'tok', message: 'Hi' }),
    ).rejects.toThrow(/no id/);
  });
});

describe('fetchPageName', () => {
  test('returns the page name', async () => {
    stubFetch(() => json({ name: 'EONYX' }));
    expect(await fetchPageName('1234', 'tok')).toBe('EONYX');
  });

  test('returns null rather than throwing when the lookup fails', async () => {
    stubFetch(() => json({ error: { message: 'bad token', code: 190 } }, 400));
    expect(await fetchPageName('1234', 'tok')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/facebookPublisher.test.ts`
Expected: FAIL — cannot resolve `../../src/publishers/facebook`.

- [ ] **Step 3: Add the constants**

Append to `src/constants.ts`:

```ts
/**
 * Graph API version, pinned so a Meta deprecation is a config change rather
 * than a code change. v26.0 shipped 29 July 2026.
 */
export const FACEBOOK_API_VERSION = process.env.FACEBOOK_API_VERSION ?? 'v26.0';

/** Facebook's published cap on a post's `message`. */
export const FACEBOOK_MAX_MESSAGE_CHARS = 63206;
```

- [ ] **Step 4: Implement the publisher**

Create `src/publishers/facebook.ts`:

```ts
import { FACEBOOK_API_VERSION, FACEBOOK_MAX_MESSAGE_CHARS } from '../constants';

export type FacebookPostArgs = { pageId: string; accessToken: string; message: string };
export type FacebookPostResult = { id: string; url: string };

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
};

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${path}`;
}

/**
 * Meta's prose, verbatim, plus its numeric code.
 *
 * This app cannot tell a stale token from a wrong Page id from a missing
 * permission — the three have identical symptoms from here and only Meta names
 * which one it is. A generic "publish failed" would make the most likely
 * real-world failure undiagnosable.
 */
async function graphErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as GraphErrorBody | null;
  const error = body?.error;
  if (!error?.message) return `Facebook API error ${res.status}`;
  return error.code === undefined ? error.message : `${error.message} (code ${error.code})`;
}

export async function publishToFacebook(args: FacebookPostArgs): Promise<FacebookPostResult> {
  const message = args.message.trim();
  if (!message) throw new Error('Refusing to publish an empty message to Facebook');
  // Rejected here rather than by Meta: our own message names the limit and the
  // actual length, which its error does not.
  if (message.length > FACEBOOK_MAX_MESSAGE_CHARS) {
    throw new Error(
      `Message is ${message.length} characters; Facebook accepts at most ${FACEBOOK_MAX_MESSAGE_CHARS}`,
    );
  }

  const res = await fetch(graphUrl(`${args.pageId}/feed`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message, access_token: args.accessToken }),
  });

  if (!res.ok) throw new Error(await graphErrorMessage(res));

  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) throw new Error('Facebook accepted the post but returned no id');
  // The id is a `{page-id}_{post-id}` composite, which is itself a valid path.
  return { id: body.id, url: `https://www.facebook.com/${body.id}` };
}

/** Null rather than a throw: a missing name must never block the publish UI. */
export async function fetchPageName(pageId: string, accessToken: string): Promise<string | null> {
  const params = new URLSearchParams({ fields: 'name', access_token: accessToken });
  const res = await fetch(graphUrl(`${pageId}?${params}`)).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as { name?: string } | null;
  return body?.name ?? null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/unit/facebookPublisher.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Format, typecheck, commit**

```bash
bun run check
bun run typecheck
git add src/publishers/facebook.ts src/constants.ts tests/unit/facebookPublisher.test.ts
git commit -m "feat: add Facebook Graph API publisher"
```

---

### Task 3: `facebook_url` column

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/3_draft_facebook_url/migration.sql`
- Modify: `src/db.ts`
- Modify: `tests/helpers/db.ts`
- Modify: `web/lib/types.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2
- Produces:
  - `DraftRow` and `web/lib/types.ts`'s `DraftRow` both gain `facebook_url: string | null`
  - `export async function setDraftFacebookUrl(id: string, url: string): Promise<void>`

**Note:** `tests/helpers/db.ts` hand-writes the `drafts` schema and tests never run migrations. Missing that file means every db and server test fails with `no such column: facebook_url`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/db.test.ts` (match the file's existing `freshDb()` / `insertDraft` setup; add `setDraftFacebookUrl` and `getDraft` to the import from `../../src/db` if not already present):

```ts
describe('setDraftFacebookUrl', () => {
  test('writes the url onto the row', async () => {
    await freshDb();
    await insertDraft({
      id: 'fb1',
      topic: 'T',
      channel: 'blog',
      tone: 'x',
      audience: 'y',
      content: '# Hi',
      word_count: 1,
      verdict: 'APPROVED',
      tone_score: 0.9,
      accuracy_score: 0.9,
      structure_score: 0.9,
      iterations: 1,
      issues: [],
    });

    expect((await getDraft('fb1'))?.facebook_url).toBeNull();
    await setDraftFacebookUrl('fb1', 'https://www.facebook.com/1_2');
    expect((await getDraft('fb1'))?.facebook_url).toBe('https://www.facebook.com/1_2');
  });

  test('is a silent no-op for a missing row, not a P2025 throw', async () => {
    await freshDb();
    await setDraftFacebookUrl('nope', 'https://www.facebook.com/1_2');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/db.test.ts`
Expected: FAIL — `setDraftFacebookUrl` is not exported.

- [ ] **Step 3: Add the field to the Prisma schema**

In `prisma/schema.prisma`, in `model Draft`, immediately after the `notionUrl` line:

```prisma
  facebookUrl    String?  @map("facebook_url")
```

- [ ] **Step 4: Generate the migration and read it before applying**

```bash
bunx prisma migrate diff \
  --from-config-datasource prisma.config.ts \
  --to-schema prisma/schema.prisma \
  --script
```

Expected output — a single line, matching the shape of `prisma/migrations/2_source_body/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "drafts" ADD COLUMN "facebook_url" TEXT;
```

**Stop and inspect if the output is anything else.** If it emits an `INSERT INTO "new_drafts" … SELECT` table rebuild, read the column list in full and confirm every existing column is carried across, then rehearse against a copy of `data/app.db` before applying. Do **not** run `prisma migrate dev` under any circumstance.

Save the output to `prisma/migrations/3_draft_facebook_url/migration.sql`:

```bash
mkdir -p prisma/migrations/3_draft_facebook_url
bunx prisma migrate diff \
  --from-config-datasource prisma.config.ts \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/3_draft_facebook_url/migration.sql
```

- [ ] **Step 5: Apply the migration and regenerate the client**

```bash
bun run prisma:deploy
bunx prisma generate
bun run prisma:status
```

Expected: `prisma:status` reports no pending migrations.

- [ ] **Step 6: Thread the column through `src/db.ts`**

Four edits:

`DraftRow`, after `notion_url`:

```ts
  facebook_url: string | null;
```

`NewDraft`'s `Omit` list — a new draft is never born published:

```ts
export type NewDraft = Omit<
  DraftRow,
  'issues' | 'cost_usd' | 'notion_url' | 'facebook_url' | 'created_at' | 'brand_id'
> & {
  issues: string[];
  brand_id?: string | null;
};
```

`PrismaDraft`, after `notionUrl`:

```ts
  facebookUrl: string | null;
```

`toDraftRow`, after the `notion_url` line:

```ts
    facebook_url: d.facebookUrl,
```

And the new writer, next to `setDraftNotionUrl` so the shared `updateMany` comment above them covers both:

```ts
export async function setDraftFacebookUrl(id: string, url: string): Promise<void> {
  await getDb().draft.updateMany({ where: { id }, data: { facebookUrl: url } });
}
```

- [ ] **Step 7: Add the column to the test schema**

In `tests/helpers/db.ts`, inside `DRAFTS_SCHEMA`, immediately after the `notion_url TEXT,` line:

```sql
  facebook_url TEXT,
```

- [ ] **Step 8: Mirror the field in the dashboard's type**

In `web/lib/types.ts`, add to `DraftRow` immediately after `notion_url`:

```ts
  facebook_url: string | null;
```

- [ ] **Step 9: Run the full unit suite**

Run: `bun run test:unit`
Expected: PASS. Watch specifically for `no such column` in `db.test.ts` or `server.test.ts` — that means Step 7 was skipped.

- [ ] **Step 10: Format, typecheck, commit**

```bash
bun run check
bun run typecheck
git add prisma/schema.prisma prisma/migrations/3_draft_facebook_url src/db.ts tests/helpers/db.ts tests/unit/db.test.ts web/lib/types.ts
git commit -m "feat: record a draft's Facebook post url"
```

---

### Task 4: API routes

**Files:**
- Modify: `src/server.ts`
- Modify: `.env.example`
- Test: `tests/unit/server.test.ts`

**Interfaces:**
- Consumes: `markdownToPlainText` (Task 1); `publishToFacebook`, `fetchPageName`, `FacebookPostResult` (Task 2); `setDraftFacebookUrl` and `DraftRow.facebook_url` (Task 3)
- Produces:
  - `POST /drafts/:id/publish/facebook` → `200 { url }` | `404 draft_not_found` | `400 facebook_not_configured` | `409 facebook_already_published` | `502 facebook_publish_failed`
  - `GET /publish/facebook/status` → `200 { configured: boolean, page_name: string | null }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/server.test.ts`. The `beforeEach` there already inserts draft `d1`.

```ts
describe('facebook publishing', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.FACEBOOK_PAGE_ID;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  });

  test('404 when the draft does not exist', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    const res = await app.request('/drafts/nope/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('draft_not_found');
  });

  test('400 when Facebook is unconfigured', async () => {
    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('facebook_not_configured');
  });

  test('posts the plain-text draft and stores the url', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    let sentBody = '';
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body);
      return new Response(JSON.stringify({ id: '1234_5678' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe('https://www.facebook.com/1234_5678');
    // d1's content is '# Hi' — the heading marker must not reach Facebook.
    expect(sentBody).toContain('message=Hi');
    expect((await getDraft('d1'))?.facebook_url).toBe('https://www.facebook.com/1234_5678');
  });

  test('409 on a second publish, without touching Graph', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    await setDraftFacebookUrl('d1', 'https://www.facebook.com/1_2');

    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('facebook_already_published');
    // The whole point of the server-side guard: a stale tab must not double-post.
    expect(called).toBe(false);
  });

  test('502 carrying Meta’s message when Graph rejects the post', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Session has expired', code: 190 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('facebook_publish_failed');
    expect(body.message).toContain('Session has expired');
    expect((await getDraft('d1'))?.facebook_url).toBeNull();
  });

  test('status reports unconfigured without calling Graph', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const res = await app.request('/publish/facebook/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false, page_name: null });
    expect(called).toBe(false);
  });

  test('status reports the page name when configured', async () => {
    process.env.FACEBOOK_PAGE_ID = 'page-name-test';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: 'EONYX' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const res = await app.request('/publish/facebook/status');
    expect(await res.json()).toEqual({ configured: true, page_name: 'EONYX' });
  });
});
```

Add `getDraft` and `setDraftFacebookUrl` to the existing `../../src/db` import at the top of the file, and `afterEach` to the `bun:test` import if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/server.test.ts`
Expected: FAIL — the routes 404, and `setDraftFacebookUrl` may not be imported yet.

- [ ] **Step 3: Guard the new route prefix**

In `src/server.ts`, add to the auth route list (around line 116, after `'/stats'`):

```ts
  '/publish/*',
```

`/drafts/*` already covers `POST /drafts/:id/publish/facebook`.

- [ ] **Step 4: Add the imports**

Extend the existing import lines in `src/server.ts`:

```ts
import { getDb, getDraft, getStats, listDrafts, setDraftFacebookUrl, setDraftNotionUrl } from './db';
import { publishDraft } from './mcp/notion';
import { fetchPageName, publishToFacebook } from './publishers/facebook';
import { markdownToPlainText } from './utils/text';
```

- [ ] **Step 5: Implement the routes**

In `src/server.ts`, directly after the existing `app.post('/drafts/:id/publish', …)` handler:

```ts
/**
 * A sibling of the Notion route rather than a `destination` parameter on it:
 * the two have different config checks and different failure modes, and leaving
 * the working path untouched means it cannot regress.
 */
app.post('/drafts/:id/publish/facebook', async (c) => {
  const draft = await getDraft(c.req.param('id'));
  if (!draft) return c.json({ error: 'draft_not_found', message: 'draft not found' }, 404);

  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !accessToken) {
    return c.json(
      {
        error: 'facebook_not_configured',
        message: 'Facebook is not configured (FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN)',
      },
      400,
    );
  }

  // Checked before the Graph call, deliberately. A Page post is public and
  // cannot be recalled from here, so a stale browser tab must not double-post.
  if (draft.facebook_url) {
    return c.json(
      {
        error: 'facebook_already_published',
        message: 'this draft has already been posted to Facebook',
        url: draft.facebook_url,
      },
      409,
    );
  }

  try {
    const post = await publishToFacebook({
      pageId,
      accessToken,
      message: markdownToPlainText(draft.content),
    });
    await setDraftFacebookUrl(draft.id, post.url);
    return c.json({ url: post.url });
  } catch (err) {
    return c.json(
      {
        error: 'facebook_publish_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
});

// A Page's name does not change within a process lifetime, so one lookup is
// enough — and the status route is hit on every draft page render.
let cachedPageName: string | null = null;

/**
 * Lets the dashboard name the Page in its confirmation, and disable the button
 * outright when Facebook is unconfigured rather than failing after a click.
 */
app.get('/publish/facebook/status', async (c) => {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !accessToken) return c.json({ configured: false, page_name: null });

  if (cachedPageName === null) {
    cachedPageName = (await fetchPageName(pageId, accessToken)) ?? pageId;
  }
  return c.json({ configured: true, page_name: cachedPageName });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/unit/server.test.ts`
Expected: PASS.

Then run the whole suite, because the stubbed `globalThis.fetch` is process-wide:

Run: `bun run test:unit`
Expected: PASS. A failure elsewhere means an `afterEach` failed to restore `fetch`.

- [ ] **Step 7: Document the environment variables**

In `.env.example`, after the Notion block:

```
# Facebook Page publishing (optional — enables the Publish to Facebook button
# on a draft). Nothing posts automatically; this is a manual per-draft action.
#
# `pages_manage_posts` normally requires App Review and Business Verification.
# That is avoidable only because you own the Page and hold an admin or
# developer role on the app. Use a System User token from Business Manager:
# a Page token derived from a user token goes stale on a password change or a
# revoked session, and this app has no OAuth refresh to recover from that.
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_API_VERSION=v26.0
```

- [ ] **Step 8: Format, typecheck, commit**

```bash
bun run check
bun run typecheck
git add src/server.ts .env.example tests/unit/server.test.ts
git commit -m "feat: add Facebook publish and status endpoints"
```

---

### Task 5: Error codes and message catalogues

**Files:**
- Modify: `web/i18n/messages/en.ts`
- Modify: `web/i18n/messages/uk.ts`
- Modify: `web/lib/errors.ts`
- Test: `tests/unit/errorMessages.test.ts`

**Interfaces:**
- Consumes: the three error codes from Task 4
- Produces: `m.drafts.openFacebook`, `m.drafts.publishFacebook`, `m.drafts.publishingFacebook`, `m.drafts.confirmFacebook(page)`, `m.drafts.confirmFacebookPost`, `m.drafts.confirmFacebookCancel`, `m.drafts.facebookUnavailable`; `m.errors.facebookNotConfigured`, `m.errors.facebookAlreadyPublished`, `m.errors.facebookPublishFailed`

**Note:** `confirmFacebook` is a **function** taking the Page name. `tests/unit/i18n.test.ts` asserts a function in `en` is a function in `uk`, and that no Ukrainian string equals its English source — so every new `uk` string must be genuinely translated.

- [ ] **Step 1: Write the failing test**

In `tests/unit/errorMessages.test.ts`, add the three codes to the array in the "every code the server can return is mapped" test:

```ts
      'notion_not_configured',
      'publish_failed',
      'facebook_not_configured',
      'facebook_already_published',
      'facebook_publish_failed',
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/errorMessages.test.ts`
Expected: FAIL — `messageForCode('facebook_not_configured', uk)` is null.

- [ ] **Step 3: Add the English strings**

In `web/i18n/messages/en.ts`, inside `drafts`, after `publishing`:

```ts
    openFacebook: 'Open Facebook post →',
    publishFacebook: 'Publish to Facebook',
    publishingFacebook: 'Posting…',
    confirmFacebook: (page: string) => `Post publicly to ${page}?`,
    confirmFacebookPost: 'Post',
    confirmFacebookCancel: 'Cancel',
    facebookUnavailable: 'Facebook is not configured on the server.',
```

And inside `errors`, after `publishFailed`:

```ts
    facebookNotConfigured: 'Facebook is not configured on the server.',
    facebookAlreadyPublished: 'This draft has already been posted to Facebook.',
    facebookPublishFailed: 'Posting to Facebook failed.',
```

- [ ] **Step 4: Add the Ukrainian strings**

In `web/i18n/messages/uk.ts`, inside `drafts`, after `publishing`:

```ts
    openFacebook: 'Відкрити допис у Facebook →',
    publishFacebook: 'Опублікувати у Facebook',
    publishingFacebook: 'Публікація…',
    confirmFacebook: (page: string) => `Опублікувати публічно на ${page}?`,
    confirmFacebookPost: 'Опублікувати',
    confirmFacebookCancel: 'Скасувати',
    facebookUnavailable: 'Facebook не налаштовано на сервері.',
```

And inside `errors`, after `publishFailed`:

```ts
    facebookNotConfigured: 'Facebook не налаштовано на сервері.',
    facebookAlreadyPublished: 'Цю чернетку вже опубліковано у Facebook.',
    facebookPublishFailed: 'Не вдалося опублікувати у Facebook.',
```

- [ ] **Step 5: Map the codes**

In `web/lib/errors.ts`, add to `CODES` after `publish_failed`:

```ts
  facebook_not_configured: (m) => m.errors.facebookNotConfigured,
  facebook_already_published: (m) => m.errors.facebookAlreadyPublished,
  facebook_publish_failed: (m) => m.errors.facebookPublishFailed,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/unit/errorMessages.test.ts tests/unit/i18n.test.ts`
Expected: PASS. `i18n.test.ts` catches a key present in one locale only, and any Ukrainian string left as its English source.

- [ ] **Step 7: Format, typecheck, commit**

```bash
bun run check
bun run typecheck
git add web/i18n/messages/en.ts web/i18n/messages/uk.ts web/lib/errors.ts tests/unit/errorMessages.test.ts
git commit -m "feat: add Facebook publishing strings and error codes"
```

---

### Task 6: The dashboard button

**Files:**
- Create: `web/components/facebook-publish-button.tsx`
- Modify: `web/lib/api.ts`
- Modify: `web/app/[locale]/(dashboard)/drafts/[id]/page.tsx`
- Test: `web/tests/facebook-publish-button.test.tsx`

**Interfaces:**
- Consumes: `GET /publish/facebook/status` and `POST /drafts/:id/publish/facebook` (Task 4); the message keys (Task 5); `DraftRow.facebook_url` (Task 3)
- Produces:
  - `export type FacebookStatus = { configured: boolean; page_name: string | null }`
  - `export async function fetchFacebookStatus(): Promise<FacebookStatus>` in `web/lib/api.ts`
  - `export function FacebookPublishButton({ draftId, configured, pageName }: { draftId: string; configured: boolean; pageName: string | null }): JSX.Element`

**Deviation from spec §8, deliberate:** the spec had the component fetch its own status on mount. It takes them as **props from the Server Component** instead. `web/tests/` renders with `renderToStaticMarkup` and has no DOM environment, so a `useEffect` fetch would be untestable without adding `happy-dom` and `@testing-library/react` — which the no-new-dependencies constraint forbids. Props also match how the page already loads `fetchBrands()` server-side. The confirm toggle remains `useState` and is therefore **not** covered by a test; the two prop-driven states are.

- [ ] **Step 1: Write the failing test**

Create `web/tests/facebook-publish-button.test.tsx`:

The component calls `useRouter()` and `useMessages()`, both of which throw
without an ancestor providing their context. The test supplies both rather than
the component guarding against their absence — a test harness must not dictate
the shape of production code. `MessagesProvider` is the app's own public
provider; `AppRouterContext` comes from a Next internal path, which is
acceptable in a test and is the standard way to render a client component that
uses the router outside the App Router.

```tsx
import { describe, expect, test } from 'bun:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacebookPublishButton } from '../components/facebook-publish-button';
import en from '../i18n/messages/en';
import { MessagesProvider } from '../i18n/provider';

// Only `refresh` is ever called; the rest satisfy the context's type.
const routerStub = {
  refresh: () => {},
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

const render = (props: { draftId: string; configured: boolean; pageName: string | null }) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={routerStub as never}>
      <MessagesProvider locale="en">
        <FacebookPublishButton {...props} />
      </MessagesProvider>
    </AppRouterContext.Provider>,
  );

describe('FacebookPublishButton', () => {
  // Assert the `disabled=""` attribute, never the bare word: the shadcn Button's
  // base class string contains `disabled:pointer-events-none disabled:opacity-50`,
  // so `toContain('disabled')` passes for every render and asserts nothing.
  test('offers the publish action when Facebook is configured', () => {
    const html = render({ draftId: 'd1', configured: true, pageName: 'EONYX' });
    expect(html).toContain(en.drafts.publishFacebook);
    expect(html).not.toContain('disabled=""');
  });

  test('is disabled and explains itself when Facebook is unconfigured', () => {
    const html = render({ draftId: 'd1', configured: false, pageName: null });
    expect(html).toContain('disabled=""');
    expect(html).toContain(en.drafts.facebookUnavailable);
  });

  test('does not show the confirmation until the button is pressed', () => {
    const html = render({ draftId: 'd1', configured: true, pageName: 'EONYX' });
    expect(html).not.toContain(en.drafts.confirmFacebook('EONYX'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test tests/facebook-publish-button.test.tsx`
Expected: FAIL — cannot resolve `../components/facebook-publish-button`.

- [ ] **Step 3: Add the status fetcher**

In `web/lib/api.ts`, after `fetchDraft`:

```ts
export type FacebookStatus = { configured: boolean; page_name: string | null };

export async function fetchFacebookStatus(): Promise<FacebookStatus> {
  return (
    (await get<FacebookStatus>('/publish/facebook/status')) ?? {
      configured: false,
      page_name: null,
    }
  );
}
```

- [ ] **Step 4: Implement the component**

Create `web/components/facebook-publish-button.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMessages } from '@/i18n/provider';
import { errorMessage } from '@/lib/errors';

/**
 * Publish a draft to the configured Facebook Page.
 *
 * The confirmation is an inline two-step state rather than a modal: a Page post
 * is public and cannot be recalled from here, so it needs a gate — but
 * `components/ui/` has no dialog primitive, and one confirmation does not
 * justify a Radix dependency. An inline flat control also suits the EONYX
 * register, which rejects overlays and glow.
 *
 * `configured` and `pageName` arrive as props from the Server Component: the
 * page already loads its data server-side, and this keeps the component's
 * states pure enough to assert without a DOM.
 */
export function FacebookPublishButton({
  draftId,
  configured,
  pageName,
}: {
  draftId: string;
  configured: boolean;
  pageName: string | null;
}) {
  const router = useRouter();
  const m = useMessages();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (!configured) {
    return (
      <div className="space-y-2">
        <Button disabled>{m.drafts.publishFacebook}</Button>
        <p className="text-sm text-muted-foreground">{m.drafts.facebookUnavailable}</p>
      </div>
    );
  }

  async function publish() {
    setPending(true);
    setError('');
    const res = await fetch(`/api/drafts/${draftId}/publish/facebook`, { method: 'POST' });
    setPending(false);
    setConfirming(false);
    if (res.ok) {
      // The server now holds the post url, so the page re-renders into a link.
      router.refresh();
      return;
    }
    setError(await errorMessage(res, m.errors.facebookPublishFailed, m));
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{m.drafts.confirmFacebook(pageName ?? '')}</span>
          <Button onClick={publish} disabled={pending}>
            {pending ? m.drafts.publishingFacebook : m.drafts.confirmFacebookPost}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            {m.drafts.confirmFacebookCancel}
          </Button>
        </div>
      ) : (
        <Button onClick={() => setConfirming(true)}>{m.drafts.publishFacebook}</Button>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && bun test tests/facebook-publish-button.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Wire it into the draft page**

In `web/app/[locale]/(dashboard)/drafts/[id]/page.tsx`:

Add the import:

```tsx
import { FacebookPublishButton } from '@/components/facebook-publish-button';
```

Extend the existing import from `@/lib/api`:

```tsx
import { fetchBrands, fetchDraft, fetchFacebookStatus } from '@/lib/api';
```

Extend the parallel fetch:

```tsx
  const [draft, brands, facebook] = await Promise.all([
    fetchDraft(id),
    fetchBrands(),
    fetchFacebookStatus(),
  ]);
```

Replace the trailing Notion block with both destinations:

```tsx
      <div className="flex flex-wrap items-start gap-6">
        {draft.notion_url ? (
          <a
            href={draft.notion_url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm underline"
          >
            {m.drafts.openNotion}
          </a>
        ) : (
          <PublishButton draftId={draft.id} />
        )}

        {draft.facebook_url ? (
          <a
            href={draft.facebook_url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm underline"
          >
            {m.drafts.openFacebook}
          </a>
        ) : (
          <FacebookPublishButton
            draftId={draft.id}
            configured={facebook.configured}
            pageName={facebook.page_name}
          />
        )}
      </div>
```

- [ ] **Step 7: Typecheck the dashboard and run its tests**

```bash
cd web && bun run build && bun test
```

Expected: build succeeds, all `web/tests/` pass. Root `bun run typecheck` does **not** cover `web/`.

- [ ] **Step 8: Commit**

From the repo root (Step 7 left the shell in `web/`):

```bash
bun run check
git add web/components/facebook-publish-button.tsx web/lib/api.ts "web/app/[locale]/(dashboard)/drafts/[id]/page.tsx" web/tests/facebook-publish-button.test.tsx
git commit -m "feat: publish a draft to Facebook from the dashboard"
```

`bun run check` at the root does not touch `web/` — Biome ignores it. The command is here to catch anything the earlier tasks left unformatted.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing code depends on

- [ ] **Step 1: Update CLAUDE.md**

In the "Drafts persist to the database, not files, by default" section, replace the **Nothing publishes automatically** paragraph with:

```markdown
**Nothing publishes automatically.** The graph ends at `finalizer`; there is no `publisher` node and no `SKIP_PUBLISH` flag. A draft reaches an outside system only when someone presses a button on it. `POST /drafts/:id/publish` needs `NOTION_TOKEN` + `NOTION_DRAFTS_DATABASE_ID` and returns `notion_not_configured` without them; `POST /drafts/:id/publish/facebook` needs `FACEBOOK_PAGE_ID` + `FACEBOOK_PAGE_ACCESS_TOKEN` and returns `facebook_not_configured` without them. Both write their URL (`notion_url`, `facebook_url`) onto the row directly, which is why neither is in `src/state.ts` — publishing happens outside any run. If you add a step that publishes as part of a run, you are undoing a deliberate decision: a run costs money and creates a page, and the two should not be one keystroke.

Facebook adds two rules Notion does not need. The publish route checks `facebook_url` **before** calling Graph and returns 409 — a Page post is public and irreversible, so a stale browser tab must not be able to double-post. And `src/publishers/facebook.ts` surfaces Meta's own error prose verbatim, because a stale token, a wrong Page ID and a missing `pages_manage_posts` permission are indistinguishable from inside this app. Use a **System User token** from Business Manager: a Page token derived from a user token goes stale on a password change, and there is no OAuth refresh here to recover from that.
```

- [ ] **Step 2: Update ARCHITECTURE.md**

Add a row to the dependency-rules table in the "Dependency rules" section, after the `src/prompts/` row:

```markdown
| `src/publishers/` | outbound destination adapters | `constants` | `db`, `nodes`, `runManager` |
```

And after the table's following paragraphs, before "### Documented deviation":

```markdown
`src/publishers/facebook.ts` calls the Graph API with plain `fetch` while `src/mcp/notion.ts` goes through an MCP server, so the two publishers sit in different directories. That asymmetry is accepted rather than accidental: relocating working Notion code buys tidiness and risks a regression. A third destination is the moment to move Notion into `src/publishers/` and introduce a shared `Publisher` interface — at two, the registry is indirection that makes each publisher harder to read than the flat function it replaces.
```

- [ ] **Step 3: Verify the whole suite one last time**

From the repo root:

```bash
bun run check
bun run typecheck
bun run test:unit
bunx biome ci .
```

Then the dashboard, which the root tools deliberately exclude:

```bash
cd web && bun run build && bun test
```

Expected: all pass. `bunx biome ci .` is the read-only, CI-equivalent check that `.github/workflows/ci.yml` runs — a rule like `style/noNonNullAssertion` is error-level there even though `bun run check` auto-fixed everything it could.

- [ ] **Step 4: Commit**

From the repo root (Step 3 left the shell in `web/`):

```bash
git add CLAUDE.md ARCHITECTURE.md
git commit -m "docs: record Facebook publishing and the two-publisher split"
```

---

## Manual verification (not automated)

No test posts to a real Page. Before calling this done, with `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_ACCESS_TOKEN` set to a real Page and a System User token:

1. `bun run dev:all`, open a draft, confirm the button reads "Publish to Facebook" and the confirmation names the real Page.
2. Post it. Confirm the post appears on the Page and the page re-renders into an "Open Facebook post →" link that resolves.
3. Reload. Confirm the button does not come back.
4. `curl -X POST` the same draft's endpoint and confirm a 409, not a second post.
5. Unset `FACEBOOK_PAGE_ACCESS_TOKEN`, reload another draft, confirm the button is disabled with the explanation rather than failing on click.
