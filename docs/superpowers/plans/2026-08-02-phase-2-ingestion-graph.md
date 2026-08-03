# Phase 2 — Ingestion Graph & Brand Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a website URL into the dashboard and, about two minutes later, hold a reviewed and editable style guide that has become a first-class brand the pipeline can write for.

**Architecture:** A second LangGraph graph — `fetcher → distiller → review → indexer` — driven by the same `runManager` as the content graph, told apart by a `kind` discriminator. The distiller emits the same triple the hand-written corpus has always had (profile, style guide, exemplars), so retrieval, chunking and both prompts stay untouched: ingestion is a third way to *produce* a corpus, not a new way to consume one.

**Tech Stack:** Bun (`HTMLRewriter`, `Bun.Glob`), LangGraph, Zod 3, Prisma 7 + libSQL, Hono, Next.js 16.

## Global Constraints

Values below were verified by spike on 2026-08-02 — trust them over recollection.

- **`HTMLRewriter` does not decode HTML entities.** Live extraction returns `It&#x27;s`, and a Ukrainian style guide returns `&laquo;революційний&raquo;`. Every extracted string passes through `decodeEntities()` (Task 1) before it is stored. An undecoded exemplar is a corrupted exemplar.
- **Element filtering needs a depth counter, not a boolean.** `el.onEndTag()` fires per element; nested `nav > ul > li` would otherwise re-enable capture early. Task 1 shows the verified pattern.
- Runtime is **Bun**: `bun`, `bun test`, `bunx`. Never `node`, `npm`, `npx`.
- Root gates: `bun run typecheck`, `bunx biome ci .`, `bun run test:unit`. `web/` is excluded from both — build it with `cd web && bun run build`.
- **`src/activity.ts` must stay a leaf module.** `runManager → graph → nodes → tools`; a fetcher importing `runManager` closes an import cycle. Fetchers call `reportActivity(threadId, {...})` and nothing else.
- **Tools and fetchers omit `step`** and inherit it from the last step their thread reported — `config.metadata.langgraph_node` reads `'tools'` inside `createAgent`'s inner graph.
- **`prisma migrate dev` is never run against a database with real data** (see CLAUDE.md). Author with `migrate diff --from-config-datasource`, apply with `migrate deploy`.
- Every network fetch sets a `User-Agent` from `INGEST_USER_AGENT` (default `eonyx-brand-ingest/1.0`) and a 10 s timeout.
- Phase 2 ships **together with phase 1** in a single deploy.
- Commits: Conventional Commits. Do **not** add a Claude co-author trailer.

---

### Task 1: HTML text extraction

The foundation every fetcher stands on. Pure functions, no network — fully unit-testable.

**Files:**
- Create: `src/ingest/extract.ts`
- Test: `tests/unit/extract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `decodeEntities(s: string): string`; `extractText(html: string): { title: string; text: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/extract.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { decodeEntities, extractText } from '../../src/ingest/extract';

const PAGE = `<!doctype html><html><head><title>Acme — Home</title>
<style>.x{color:red}</style></head><body>
<nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>
<header><h1>Acme Co</h1></header>
<main><article>
<h2>What we do</h2>
<p>We build custom tools for small businesses.</p>
<ul><li>Chatbots</li><li>Document automation</li></ul>
<p>Our tone is plain &amp; direct &mdash; It&#x27;s honest.</p>
</article></main>
<aside><p>Subscribe to our newsletter!</p></aside>
<footer><p>© 2026 Acme. All rights reserved.</p></footer>
<script>console.log('tracking')</script>
</body></html>`;

describe('decodeEntities', () => {
  test('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('It&#x27;s awesome &amp; fast')).toBe("It's awesome & fast");
    expect(decodeEntities('caf&#233;')).toBe('café');
  });

  test('decodes the guillemets the Ukrainian style guide uses', () => {
    expect(decodeEntities('&laquo;революційний&raquo; &mdash; ні')).toBe(
      '«революційний» — ні',
    );
  });

  test('leaves an unknown entity untouched rather than mangling it', () => {
    expect(decodeEntities('&unknownentity; stays')).toBe('&unknownentity; stays');
  });
});

describe('extractText', () => {
  test('keeps the title', () => {
    expect(extractText(PAGE).title).toBe('Acme — Home');
  });

  test('keeps article prose', () => {
    const { text } = extractText(PAGE);
    expect(text).toContain('We build custom tools for small businesses.');
    expect(text).toContain('Chatbots');
  });

  test('drops nav, header, aside, footer, script and style', () => {
    const { text } = extractText(PAGE);
    for (const boilerplate of ['About', 'Subscribe', 'All rights reserved', 'tracking', 'color:red']) {
      expect(text).not.toContain(boilerplate);
    }
  });

  test('decodes entities in the extracted body', () => {
    const { text } = extractText(PAGE);
    expect(text).toContain("Our tone is plain & direct — It's honest.");
    expect(text).not.toContain('&amp;');
  });

  test('nested boilerplate does not re-enable capture early', () => {
    // A depth counter rather than a boolean: onEndTag fires for the inner </li>
    // and </ul> too, which would resume capture inside the nav.
    expect(extractText(PAGE).text).not.toContain('Home');
  });

  test('text across inline element boundaries is not glued together', () => {
    // Observed on a live crawl of eonyx.net: "студія" followed by "з" in a
    // sibling span came back as "студіяз", and "даних" + "б'є" as "данихб'є".
    // Glued words make an exemplar worthless as evidence of how a brand writes.
    const html = '<p><span>R&amp;D-студія</span> <span>з впровадження</span></p>';
    expect(extractText(html).text).toContain('R&D-студія з впровадження');
    expect(extractText(html).text).not.toContain('студіяз');
  });

  test('keeps text held in inline wrappers, not only in block elements', () => {
    const html = '<div><span>Сегменти</span></div>';
    expect(extractText(html).text).toContain('Сегменти');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/extract.test.ts`
Expected: FAIL — `Cannot find module '../../src/ingest/extract'`.

- [ ] **Step 3: Write the implementation**

Create `src/ingest/extract.ts`:

```ts
/** Elements whose subtree is boilerplate rather than content. */
const DROP = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg', 'form'];

/** Block elements: their text is worth keeping and they start a new line. */
const BLOCK = 'p, li, h1, h2, h3, h4, blockquote';

/** Everything whose text we keep, including the inline wrappers real sites use. */
const TEXT_FROM = `${BLOCK}, span, strong, em, a, div, td`;

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
};

/**
 * HTMLRewriter hands back raw source text, so `It&#x27;s` survives into the
 * corpus unless decoded here. Unknown entities are left alone rather than
 * dropped — mangling is worse than passing through.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

export function extractText(html: string): { title: string; text: string } {
  let title = '';
  const parts: string[] = [];
  // A counter, not a boolean: onEndTag fires for every nested element inside a
  // dropped subtree, and a boolean would resume capture at the first one.
  let dropDepth = 0;

  new HTMLRewriter()
    .on('title', {
      text(t) {
        title += t.text;
      },
    })
    .on(DROP.join(', '), {
      element(el) {
        dropDepth += 1;
        el.onEndTag(() => {
          dropDepth -= 1;
        });
      },
    })
    // Every element boundary contributes a space. Without this, text from
    // adjacent inline elements is concatenated and words are glued together —
    // a live crawl of eonyx.net produced "студіяз впровадження" and
    // "данихб'є по грошах", which would poison the corpus and make every
    // exemplar quoted from it unusable.
    .on('*', {
      element() {
        if (dropDepth === 0) parts.push(' ');
      },
    })
    .on('br', {
      element() {
        if (dropDepth === 0) parts.push('\n');
      },
    })
    .on(BLOCK, {
      element() {
        if (dropDepth === 0) parts.push('\n');
      },
    })
    .on(TEXT_FROM, {
      text(t) {
        if (dropDepth === 0 && t.text.trim()) parts.push(t.text);
      },
    })
    .transform(new Response(html));

  const text = decodeEntities(parts.join(''))
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  return { title: decodeEntities(title).trim(), text };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test tests/unit/extract.test.ts`
Expected: PASS, 8 cases.

- [ ] **Step 5: Run the gates and commit**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
git add src/ingest/extract.ts tests/unit/extract.test.ts
git commit -m "feat: add HTML text extraction for brand ingestion

HTMLRewriter returns raw source text, so entities survive undecoded — a
live page yields \"It&#x27;s\" and a Ukrainian style guide yields
\"&laquo;революційний&raquo;\". Both would reach the corpus verbatim and
corrupt any exemplar quoted from them.

Boilerplate filtering uses a depth counter rather than a boolean: onEndTag
fires for every nested element, so a boolean resumes capture at the first
</li> inside a <nav>."
```

---

### Task 2: URL helpers and the website fetcher

**Files:**
- Create: `src/ingest/urls.ts`, `src/ingest/fetchers/website.ts`, `src/ingest/types.ts`
- Test: `tests/unit/ingestUrls.test.ts`

**Interfaces:**
- Consumes: `extractText` (Task 1).
- Produces: `type RawDoc = { url: string; title: string; text: string; kind: 'page' | 'post' }`; `type SourceSpec`; `interface SourceFetcher`; `normalizeUrl(raw, base): string | null`; `sameOrigin(a, b): boolean`; `parseSitemap(xml): string[]`; `parseRobots(txt, ua): { disallow: string[] }`; `isAllowed(path, rules): boolean`; `websiteFetcher: SourceFetcher`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ingestUrls.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { isAllowed, normalizeUrl, parseRobots, parseSitemap, sameOrigin } from '../../src/ingest/urls';

describe('normalizeUrl', () => {
  test('resolves relative links against the base', () => {
    expect(normalizeUrl('/about', 'https://acme.com/blog/')).toBe('https://acme.com/about');
  });

  test('drops the fragment and trailing slash so one page is not crawled twice', () => {
    expect(normalizeUrl('https://acme.com/about/#team', 'https://acme.com')).toBe(
      'https://acme.com/about',
    );
  });

  test('strips tracking parameters but keeps meaningful query', () => {
    expect(normalizeUrl('https://acme.com/p?utm_source=x&id=7', 'https://acme.com')).toBe(
      'https://acme.com/p?id=7',
    );
  });

  test('rejects non-http schemes', () => {
    expect(normalizeUrl('mailto:hi@acme.com', 'https://acme.com')).toBeNull();
    expect(normalizeUrl('javascript:void(0)', 'https://acme.com')).toBeNull();
  });
});

describe('sameOrigin', () => {
  test('matches host and scheme, not path', () => {
    expect(sameOrigin('https://acme.com/a', 'https://acme.com/b')).toBe(true);
    expect(sameOrigin('https://acme.com', 'https://blog.acme.com')).toBe(false);
    expect(sameOrigin('https://acme.com', 'http://acme.com')).toBe(false);
  });
});

describe('parseSitemap', () => {
  test('reads urlset entries', () => {
    const xml = `<urlset><url><loc>https://acme.com/a</loc></url><url><loc>https://acme.com/b</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual(['https://acme.com/a', 'https://acme.com/b']);
  });

  test('reads sitemap-index entries too, so nested sitemaps are followed', () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.com/s1.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual(['https://acme.com/s1.xml']);
  });
});

describe('robots.txt', () => {
  test('collects Disallow rules for the wildcard agent', () => {
    const txt = ['User-agent: *', 'Disallow: /admin', 'Disallow: /cart', 'Allow: /'].join('\n');
    const rules = parseRobots(txt, 'eonyx-brand-ingest');
    expect(rules.disallow).toContain('/admin');
    expect(isAllowed('/admin/users', rules)).toBe(false);
    expect(isAllowed('/about', rules)).toBe(true);
  });

  test('a named group for our agent wins over the wildcard', () => {
    const txt = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: eonyx-brand-ingest',
      'Disallow: /private',
    ].join('\n');
    const rules = parseRobots(txt, 'eonyx-brand-ingest');
    expect(isAllowed('/about', rules)).toBe(true);
    expect(isAllowed('/private/x', rules)).toBe(false);
  });

  test('an empty file allows everything', () => {
    expect(isAllowed('/anything', parseRobots('', 'eonyx-brand-ingest'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/ingestUrls.test.ts`
Expected: FAIL — `Cannot find module '../../src/ingest/urls'`.

- [ ] **Step 3: Write the shared types**

Create `src/ingest/types.ts`:

```ts
export type RawDoc = {
  url: string;
  title: string;
  text: string;
  kind: 'page' | 'post';
};

export type SourceSpec =
  | { kind: 'website'; locator: string }
  | { kind: 'rss'; locator: string }
  | { kind: 'paste'; locator: string; body: string };

export interface SourceFetcher {
  kind: SourceSpec['kind'];
  /** False when a required token is unset — the API rejects the source kind. */
  available(): boolean;
  fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]>;
}

export const INGEST_USER_AGENT = process.env.INGEST_USER_AGENT ?? 'eonyx-brand-ingest/1.0';
export const INGEST_MAX_PAGES = Number(process.env.INGEST_MAX_PAGES ?? 25);
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2_000_000;
```

- [ ] **Step 4: Write the URL helpers**

Create `src/ingest/urls.ts`:

```ts
const TRACKING = /^(utm_|fbclid$|gclid$|mc_(cid|eid)$|ref$|source$)/i;

/**
 * Canonical form of a link, or null when it is not worth crawling. Fragment and
 * trailing slash are dropped so `/about`, `/about/` and `/about#team` are one
 * page rather than three.
 */
export function normalizeUrl(raw: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const out = url.toString();
  return out.endsWith('/') && url.pathname === '/' ? out.slice(0, -1) : out;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Handles both <urlset> and <sitemapindex> — the tags differ, <loc> does not. */
export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] ?? '').filter(Boolean);
}

export type RobotsRules = { disallow: string[] };

/**
 * Disallow rules that apply to us. A group naming our agent wins outright over
 * the wildcard group, which is what the standard specifies.
 */
export function parseRobots(txt: string, userAgent: string): RobotsRules {
  const agent = userAgent.split('/')[0]?.toLowerCase() ?? '';
  const groups = new Map<string, string[]>();
  let current: string[] = [];

  for (const line of txt.split('\n')) {
    const clean = line.split('#')[0]?.trim() ?? '';
    if (!clean) continue;
    const [rawKey, ...rest] = clean.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      current = groups.get(value.toLowerCase()) ?? [];
      groups.set(value.toLowerCase(), current);
    } else if (key === 'disallow' && value) {
      current.push(value);
    }
  }
  return { disallow: groups.get(agent) ?? groups.get('*') ?? [] };
}

export function isAllowed(pathname: string, rules: RobotsRules): boolean {
  return !rules.disallow.some((rule) => pathname.startsWith(rule));
}
```

- [ ] **Step 5: Run the URL tests**

Run: `bun test tests/unit/ingestUrls.test.ts`
Expected: PASS, 10 cases.

- [ ] **Step 6: Write the website fetcher**

Create `src/ingest/fetchers/website.ts`:

```ts
import { reportActivity } from '../../activity';
import { extractText } from '../extract';
import {
  FETCH_TIMEOUT_MS,
  INGEST_MAX_PAGES,
  INGEST_USER_AGENT,
  MAX_BYTES,
  type RawDoc,
  type SourceFetcher,
  type SourceSpec,
} from '../types';
import { isAllowed, normalizeUrl, parseRobots, parseSitemap, type RobotsRules, sameOrigin } from '../urls';

async function get(url: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: { 'user-agent': INGEST_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch {
    return null;
  }
}

async function loadRobots(origin: string): Promise<RobotsRules> {
  const res = await get(`${origin}/robots.txt`);
  if (!res?.ok) return { disallow: [] };
  return parseRobots(await res.text(), INGEST_USER_AGENT);
}

/** Sitemap first — it is the site's own list of what matters. */
async function fromSitemap(origin: string): Promise<string[]> {
  const res = await get(`${origin}/sitemap.xml`);
  if (!res?.ok) return [];
  const entries = parseSitemap(await res.text());
  const pages: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith('.xml')) {
      const nested = await get(entry);
      if (nested?.ok) pages.push(...parseSitemap(await nested.text()));
    } else {
      pages.push(entry);
    }
    if (pages.length >= INGEST_MAX_PAGES * 2) break;
  }
  return pages;
}

function linksFrom(html: string, base: string): string[] {
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1] ?? '');
  return hrefs.map((h) => normalizeUrl(h, base)).filter((u): u is string => u !== null);
}

async function readPage(url: string): Promise<{ doc: RawDoc; html: string } | null> {
  const res = await get(url);
  if (!res?.ok) return null;
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null;
  const html = (await res.text()).slice(0, MAX_BYTES);
  const { title, text } = extractText(html);
  if (text.length < 120) return null; // A nav-only shell teaches the distiller nothing.
  return { doc: { url, title: title || url, text, kind: 'page' }, html };
}

export const websiteFetcher: SourceFetcher = {
  kind: 'website',
  available: () => true,
  async fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]> {
    const root = normalizeUrl(spec.locator, spec.locator);
    if (!root) throw new Error(`"${spec.locator}" is not a usable http(s) URL`);
    const origin = new URL(root).origin;

    const robots = await loadRobots(origin);
    const seeded = await fromSitemap(origin);
    const queue = [root, ...seeded.map((u) => normalizeUrl(u, origin)).filter((u): u is string => !!u)];
    const seen = new Set<string>();
    const docs: RawDoc[] = [];

    while (queue.length > 0 && docs.length < INGEST_MAX_PAGES) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      if (!sameOrigin(url, root)) continue;
      if (!isAllowed(new URL(url).pathname, robots)) continue;

      const page = await readPage(url);
      reportActivity(threadId, {
        kind: page ? 'page_fetched' : 'page_skipped',
        detail: `${docs.length + (page ? 1 : 0)}/${INGEST_MAX_PAGES} ${url}`,
      });
      if (!page) continue;
      docs.push(page.doc);

      // Breadth-first: only follow links when the sitemap did not supply enough.
      if (queue.length < INGEST_MAX_PAGES) {
        for (const link of linksFrom(page.html, url)) {
          if (!seen.has(link) && sameOrigin(link, root)) queue.push(link);
        }
      }
    }

    if (docs.length === 0) {
      throw new Error(`Crawled ${origin} but found no readable pages — check the URL and robots.txt`);
    }
    return docs;
  },
};
```

- [ ] **Step 7: Run the gates and commit**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
git add src/ingest tests/unit/ingestUrls.test.ts
git commit -m "feat: add the website fetcher and its URL helpers

Sitemap first, falling back to same-origin breadth-first traversal, capped
at INGEST_MAX_PAGES with a 10s timeout and a 2MB ceiling per response.
robots.txt is honoured, with a group naming our agent winning over the
wildcard as the standard specifies.

URL normalisation drops fragments, trailing slashes and tracking
parameters, so /about, /about/ and /about#team are one page rather than
three. Pages under 120 characters of prose are skipped: a nav-only shell
teaches the distiller nothing."
```

---

### Task 3: RSS/Atom and paste fetchers

**Files:**
- Create: `src/ingest/fetchers/rss.ts`, `src/ingest/fetchers/paste.ts`, `src/ingest/fetchers/index.ts`
- Test: `tests/unit/ingestFeeds.test.ts`

**Interfaces:**
- Consumes: `RawDoc`, `SourceFetcher`, `SourceSpec` (Task 2); `decodeEntities`, `extractText` (Task 1).
- Produces: `parseFeed(xml): Array<{ title: string; link: string; body: string }>`; `splitPasted(body): string[]`; `rssFetcher`, `pasteFetcher`; `fetcherFor(kind): SourceFetcher | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ingestFeeds.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { splitPasted } from '../../src/ingest/fetchers/paste';
import { parseFeed } from '../../src/ingest/fetchers/rss';

const RSS = `<rss><channel>
  <item><title>First post</title><link>https://acme.com/1</link>
    <description>&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</description></item>
  <item><title>Second</title><link>https://acme.com/2</link>
    <content:encoded><![CDATA[<p>Body two</p>]]></content:encoded></item>
</channel></rss>`;

const ATOM = `<feed><entry><title>Atom one</title>
  <link href="https://acme.com/a"/><content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
</entry></feed>`;

describe('parseFeed', () => {
  test('reads RSS items, preferring content:encoded over description', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('First post');
    expect(items[0]?.body).toContain('Hello & welcome');
    expect(items[1]?.body).toContain('Body two');
  });

  test('strips markup from feed bodies', () => {
    expect(parseFeed(RSS)[0]?.body).not.toContain('<p>');
  });

  test('reads Atom entries and their href links', () => {
    const items = parseFeed(ATOM);
    expect(items[0]?.title).toBe('Atom one');
    expect(items[0]?.link).toBe('https://acme.com/a');
    expect(items[0]?.body).toContain('Atom body');
  });

  test('returns an empty list for unparseable input rather than throwing', () => {
    expect(parseFeed('not xml at all')).toEqual([]);
  });
});

describe('splitPasted', () => {
  test('splits on a --- delimiter line and trims', () => {
    expect(splitPasted('one\n---\ntwo\n---\n three ')).toEqual(['one', 'two', 'three']);
  });

  test('a single post with no delimiter is one entry', () => {
    expect(splitPasted('just one post')).toEqual(['just one post']);
  });

  test('ignores empty blocks from trailing delimiters', () => {
    expect(splitPasted('one\n---\n\n---\n')).toEqual(['one']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/ingestFeeds.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the RSS fetcher**

Create `src/ingest/fetchers/rss.ts`:

```ts
import { reportActivity } from '../../activity';
import { decodeEntities, extractText } from '../extract';
import {
  FETCH_TIMEOUT_MS,
  INGEST_USER_AGENT,
  type RawDoc,
  type SourceFetcher,
  type SourceSpec,
} from '../types';

const MAX_ENTRIES = 10;

function tag(block: string, name: string): string {
  const cdata = new RegExp(`<${name}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i').exec(block);
  if (cdata?.[1]) return cdata[1];
  const plain = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return plain?.[1] ?? '';
}

/** Feed bodies carry escaped HTML, so they are decoded then stripped of markup. */
function toPlainText(raw: string): string {
  const html = decodeEntities(raw);
  return html.includes('<') ? extractText(`<body>${html}</body>`).text : html.trim();
}

export function parseFeed(xml: string): Array<{ title: string; link: string; body: string }> {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.map((block) => {
    const href = /<link[^>]*href=["']([^"']+)["']/i.exec(block)?.[1];
    return {
      title: decodeEntities(tag(block, 'title')).trim(),
      link: (href ?? tag(block, 'link')).trim(),
      body: toPlainText(tag(block, 'content:encoded') || tag(block, 'content') || tag(block, 'description')),
    };
  });
}

export const rssFetcher: SourceFetcher = {
  kind: 'rss',
  available: () => true,
  async fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]> {
    const res = await fetch(spec.locator, {
      headers: { 'user-agent': INGEST_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => null);
    if (!res?.ok) throw new Error(`Could not read the feed at ${spec.locator}`);

    const items = parseFeed(await res.text()).filter((i) => i.body.length > 80).slice(0, MAX_ENTRIES);
    reportActivity(threadId, { kind: 'feed_read', detail: `${items.length} entries from ${spec.locator}` });
    if (items.length === 0) throw new Error(`The feed at ${spec.locator} had no readable entries`);

    return items.map((i) => ({
      url: i.link || spec.locator,
      title: i.title || 'Untitled',
      text: i.body,
      kind: 'post' as const,
    }));
  },
};
```

- [ ] **Step 4: Write the paste fetcher and the registry**

Create `src/ingest/fetchers/paste.ts`:

```ts
import { reportActivity } from '../../activity';
import type { RawDoc, SourceFetcher, SourceSpec } from '../types';

/** Blocks separated by a line containing only dashes. */
export function splitPasted(body: string): string[] {
  return body
    .split(/^\s*-{3,}\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);
}

export const pasteFetcher: SourceFetcher = {
  kind: 'paste',
  available: () => true,
  async fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]> {
    const body = spec.kind === 'paste' ? spec.body : '';
    const blocks = splitPasted(body);
    reportActivity(threadId, { kind: 'pasted_posts', detail: `${blocks.length} block(s)` });
    if (blocks.length === 0) throw new Error('No pasted content to read');
    return blocks.map((text, i) => ({
      url: `pasted#${i + 1}`,
      title: `Pasted post ${i + 1}`,
      text,
      kind: 'post' as const,
    }));
  },
};
```

Create `src/ingest/fetchers/index.ts`:

```ts
import type { SourceFetcher, SourceSpec } from '../types';
import { pasteFetcher } from './paste';
import { rssFetcher } from './rss';
import { websiteFetcher } from './website';

const FETCHERS: SourceFetcher[] = [websiteFetcher, rssFetcher, pasteFetcher];

/** Null when the kind is unknown or its dependencies are unavailable. */
export function fetcherFor(kind: SourceSpec['kind']): SourceFetcher | null {
  const found = FETCHERS.find((f) => f.kind === kind);
  return found?.available() ? found : null;
}

export { pasteFetcher, rssFetcher, websiteFetcher };
```

- [ ] **Step 5: Run the gates and commit**

```bash
bun test tests/unit/ingestFeeds.test.ts
bun run typecheck && bunx biome ci . && bun run test:unit
git add src/ingest tests/unit/ingestFeeds.test.ts
git commit -m "feat: add RSS/Atom and paste fetchers behind a shared registry

Feeds carry escaped HTML in their bodies, so entries are decoded then
stripped of markup rather than embedded as tag soup. content:encoded wins
over description when both are present, and Atom's href link form is
handled alongside RSS's element form. Unparseable XML yields an empty list
rather than throwing — a bad feed should not fail the whole ingest.

fetcherFor() returns null for an unavailable kind, which is what lets a
paid source degrade to hidden rather than broken."
```

---

### Task 4: Distillation schemas and the corpus renderer

**Files:**
- Create: `src/ingest/schemas.ts`, `src/ingest/render.ts`
- Test: `tests/unit/ingestRender.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BrandProfileSchema`, `StyleGuideSchema`, `ExemplarSelectionSchema` and their inferred types `BrandProfile`, `StyleGuide`, `ExemplarSelection`; `renderProfile(p): string`; `renderStyleGuide(g): string`; `assembleCorpusInput(docs, budget): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ingestRender.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { assembleCorpusInput, renderProfile, renderStyleGuide } from '../../src/ingest/render';

const profile = {
  name: 'Acme',
  mission: 'Make tools simple.',
  services: ['Chatbots', 'Automation'],
  audience_primary: 'SMB owners',
  audience_secondary: 'Ops managers',
  positioning: 'Cheaper than agencies.',
  channels: [{ channel: 'linkedin', description: 'Educational', word_range: '800-1200', cadence: 'Weekly' }],
};

const guide = {
  voice: ['Plain and direct'],
  forbidden_phrases: ['revolutionary'],
  preferred_constructions: ['Second person'],
  formatting_rules: ['H2 for sections'],
  language: 'en',
};

describe('renderProfile', () => {
  test('produces the brand.md shape the corpus has always used', () => {
    const md = renderProfile(profile);
    expect(md).toContain('# Acme');
    expect(md).toContain('Make tools simple.');
    expect(md).toContain('Chatbots');
    expect(md).toContain('linkedin');
  });
});

describe('renderStyleGuide', () => {
  test('lists forbidden phrases, which the editor checks against', () => {
    const md = renderStyleGuide(guide);
    expect(md).toContain('revolutionary');
    expect(md).toContain('Plain and direct');
  });

  test('an empty forbidden list renders without an empty heading dangling', () => {
    const md = renderStyleGuide({ ...guide, forbidden_phrases: [] });
    expect(md).not.toContain('## Forbidden');
  });
});

describe('assembleCorpusInput', () => {
  test('puts posts before pages, since posts are the better voice evidence', () => {
    const out = assembleCorpusInput(
      [
        { url: 'a', title: 'Page', text: 'PAGE TEXT', kind: 'page' },
        { url: 'b', title: 'Post', text: 'POST TEXT', kind: 'post' },
      ],
      10_000,
    );
    expect(out.indexOf('POST TEXT')).toBeLessThan(out.indexOf('PAGE TEXT'));
  });

  test('truncates at a document boundary rather than mid-document', () => {
    const docs = [
      { url: 'a', title: 'A', text: 'x'.repeat(300), kind: 'post' as const },
      { url: 'b', title: 'B', text: 'y'.repeat(300), kind: 'post' as const },
    ];
    const out = assembleCorpusInput(docs, 400);
    expect(out).toContain('x'.repeat(300));
    expect(out).not.toContain('y');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/ingestRender.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schemas**

Create `src/ingest/schemas.ts`:

```ts
import { z } from 'zod';

export const BrandProfileSchema = z.object({
  name: z.string().describe('The brand name as it refers to itself'),
  mission: z.string().describe('What the brand exists to do, in its own framing'),
  services: z.array(z.string()).describe('Concrete products or services offered'),
  audience_primary: z.string().describe('Who the brand mainly writes for'),
  audience_secondary: z.string().describe('A secondary audience, or an empty string'),
  positioning: z.string().describe('How the brand differs from its competitors'),
  channels: z
    .array(
      z.object({
        channel: z.string(),
        description: z.string(),
        word_range: z.string().describe("Observed length, e.g. '800-1200'; empty when unknown"),
        cadence: z.string().describe("Observed posting rhythm; empty when unknown"),
      }),
    )
    .describe('Channels the brand publishes on. Return an empty array when none are evident.'),
});

export const StyleGuideSchema = z.object({
  voice: z.array(z.string()).describe('Tone attributes, each with a short explanation'),
  forbidden_phrases: z
    .array(z.string())
    .describe(
      'Phrases the brand demonstrably avoids or explicitly bans. Ground each one in the corpus; an empty array is a valid answer.',
    ),
  preferred_constructions: z.array(z.string()).describe('Sentence and structure habits to imitate'),
  formatting_rules: z.array(z.string()).describe('Heading, list and length conventions'),
  language: z.string().describe("BCP-47 tag for the language the corpus is written in, e.g. 'uk'"),
});

export const ExemplarSelectionSchema = z.object({
  exemplars: z
    .array(
      z.object({
        title: z.string(),
        channel: z.string(),
        content: z.string().describe('Copied verbatim from the corpus, never paraphrased'),
        why_representative: z.string(),
      }),
    )
    .describe('Between three and seven of the most representative pieces'),
});

export const DistillationSchema = z.object({
  profile: BrandProfileSchema,
  style_guide: StyleGuideSchema,
  exemplars: ExemplarSelectionSchema.shape.exemplars,
});

export type BrandProfile = z.infer<typeof BrandProfileSchema>;
export type StyleGuide = z.infer<typeof StyleGuideSchema>;
export type Distillation = z.infer<typeof DistillationSchema>;
```

- [ ] **Step 4: Write the renderer**

Create `src/ingest/render.ts`:

```ts
import type { BrandProfile, StyleGuide } from './schemas';
import type { RawDoc } from './types';

function section(heading: string, lines: string[]): string {
  if (lines.length === 0) return '';
  return `\n## ${heading}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
}

/** Mirrors data/brand/brand.md, so downstream cannot tell the two apart. */
export function renderProfile(p: BrandProfile): string {
  const channels = p.channels.map(
    (c) => `**${c.channel}** — ${c.description}${c.word_range ? ` ${c.word_range} words.` : ''}${c.cadence ? ` ${c.cadence}.` : ''}`,
  );
  return [
    `# ${p.name} — Brand overview`,
    `\n## Mission\n\n${p.mission}`,
    section('Services', p.services),
    `\n## Audience\n\n${p.audience_primary}${p.audience_secondary ? `\n\nSecondary: ${p.audience_secondary}` : ''}`,
    `\n## Positioning\n\n${p.positioning}`,
    section('Channels', channels),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Mirrors data/brand/style_guide.md. */
export function renderStyleGuide(g: StyleGuide): string {
  return [
    '# Content style guide',
    section('Voice and tone', g.voice),
    section('Forbidden phrases', g.forbidden_phrases),
    section('Preferred constructions', g.preferred_constructions),
    section('Formatting rules', g.formatting_rules),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The distiller's input, assembled to a hard character budget. Posts come first
 * because real published copy is far better voice evidence than a marketing
 * page, and truncation happens at a document boundary so no exemplar can be
 * quoted from a half-document.
 */
export function assembleCorpusInput(docs: RawDoc[], budget: number): string {
  const ordered = [...docs].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'post' ? -1 : 1));
  const parts: string[] = [];
  let used = 0;
  for (const doc of ordered) {
    const block = `\n--- ${doc.kind.toUpperCase()}: ${doc.title} (${doc.url}) ---\n${doc.text}\n`;
    if (used + block.length > budget) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join('');
}
```

- [ ] **Step 5: Run the gates and commit**

```bash
bun test tests/unit/ingestRender.test.ts
bun run typecheck && bunx biome ci . && bun run test:unit
git add src/ingest tests/unit/ingestRender.test.ts
git commit -m "feat: add distillation schemas and the corpus renderer

renderProfile and renderStyleGuide emit the same markdown shape as
data/brand/brand.md and style_guide.md, which is what lets the strategist
prompt, editor prompt, chunking and retrieval stay untouched — an ingested
brand is indistinguishable from a hand-written one downstream.

The distiller's input is capped at a character budget with posts ordered
ahead of pages, and truncation lands on a document boundary so no exemplar
can be quoted out of a half-document."
```

---

### Task 5: The ingestion graph

**Files:**
- Create: `src/ingest/state.ts`, `src/ingest/nodes/{fetcher,distiller,review,indexer}.ts`, `src/ingest/graph.ts`, `src/prompts/distiller.ts`
- Modify: `src/prompts/managed.ts`
- Test: `tests/unit/ingestGraph.test.ts`

**Interfaces:**
- Consumes: `fetcherFor` (Task 3); `DistillationSchema`, `renderProfile`, `renderStyleGuide`, `assembleCorpusInput` (Task 4); `getBrand`, `createBrand`, `setBrandCorpusHash` from `src/brands.ts`; `reindex` from `src/tools/rag.ts`.
- Produces: `ingestGraph` (a compiled `StateGraph`); `makeIngestState(input): Partial<IngestStateType>`; `type IngestRequest = { brandId: string; sources: SourceSpec[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ingestGraph.test.ts` — routing only, so the suite stays free of network and LLM calls:

```ts
import { describe, expect, test } from 'bun:test';
import { routeAfterReview } from '../../src/ingest/nodes/review';

describe('routeAfterReview', () => {
  test('approval goes to the indexer', () => {
    expect(routeAfterReview({ approved: true })).toBe('indexer');
  });

  test('a revision goes back to the distiller', () => {
    expect(routeAfterReview({ approved: false, feedback: 'drop the third rule' })).toBe('distiller');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/ingestGraph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the graph state**

Create `src/ingest/state.ts`:

```ts
import { Annotation } from '@langchain/langgraph';
import type { Distillation } from './schemas';
import type { RawDoc, SourceSpec } from './types';

export type IngestRequest = { brandId: string; sources: SourceSpec[] };

const last = <T>(def: () => T) => ({ reducer: (_p: T, n: T) => n, default: def });

export const IngestState = Annotation.Root({
  request: Annotation<IngestRequest>({ reducer: (_p, n) => n }),
  rawDocs: Annotation<RawDoc[]>(last<RawDoc[]>(() => [])),
  distillation: Annotation<Distillation | null>(last<Distillation | null>(() => null)),
  reviewFeedback: Annotation<string | null>(last<string | null>(() => null)),
});

export type IngestStateType = typeof IngestState.State;

export function makeIngestState(request: IngestRequest): Partial<IngestStateType> {
  return { request };
}
```

- [ ] **Step 4: Write the fetcher and indexer nodes**

Create `src/ingest/nodes/fetcher.ts`:

```ts
import type { RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../../activity';
import { fetcherFor } from '../fetchers/index';
import type { IngestStateType } from '../state';
import type { RawDoc } from '../types';

export async function fetcher(
  state: IngestStateType,
  config?: RunnableConfig,
): Promise<Partial<IngestStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  reportActivity(threadId, {
    step: 'fetcher',
    kind: 'fetching',
    detail: `${state.request.sources.length} source(s)`,
  });

  const docs: RawDoc[] = [];
  for (const spec of state.request.sources) {
    const impl = fetcherFor(spec.kind);
    if (!impl) throw new Error(`Source kind "${spec.kind}" is not available`);
    docs.push(...(await impl.fetch(spec, threadId)));
  }
  if (docs.length === 0) throw new Error('No readable content was found in any source');

  reportActivity(threadId, { step: 'fetcher', kind: 'fetched', detail: `${docs.length} document(s)` });
  return { rawDocs: docs };
}
```

Create `src/ingest/nodes/indexer.ts`:

```ts
import type { RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../../activity';
import { getDb } from '../../db';
import { reindex } from '../../tools/rag';
import { renderProfile, renderStyleGuide } from '../render';
import type { IngestStateType } from '../state';

export async function indexer(
  state: IngestStateType,
  config?: RunnableConfig,
): Promise<Partial<IngestStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const { distillation, request, rawDocs } = state;
  if (!distillation) throw new Error('indexer: nothing distilled — check the review gate');

  const db = getDb();
  const brandId = request.brandId;

  // Re-ingestion replaces the corpus rather than appending to it.
  await db.brandDocument.deleteMany({ where: { brandId } });

  await db.brandDocument.create({
    data: {
      brandId,
      kind: 'profile',
      title: 'Brand overview',
      content: renderProfile(distillation.profile),
      included: true,
    },
  });
  await db.brandDocument.create({
    data: {
      brandId,
      kind: 'style_guide',
      title: 'Content style guide',
      content: renderStyleGuide(distillation.style_guide),
      included: true,
    },
  });
  for (const ex of distillation.exemplars) {
    await db.brandDocument.create({
      data: {
        brandId,
        kind: 'exemplar',
        title: ex.title,
        content: ex.content,
        included: true,
      },
    });
  }
  // Provenance: kept, never embedded.
  for (const doc of rawDocs) {
    await db.brandDocument.create({
      data: { brandId, kind: 'raw_page', title: doc.title, content: doc.text, included: false },
    });
  }

  await db.brand.update({
    where: { id: brandId },
    data: { status: 'active', language: distillation.style_guide.language },
  });

  reportActivity(threadId, {
    step: 'indexer',
    kind: 'indexing',
    detail: `${distillation.exemplars.length + 2} documents, ${rawDocs.length} kept for provenance`,
  });
  await reindex(brandId);
  reportActivity(threadId, { step: 'indexer', kind: 'indexed', detail: 'brand is active' });
  return {};
}
```

- [ ] **Step 5: Write the distiller prompt and node**

Create `src/prompts/distiller.ts`:

```ts
export const DISTILLER_SYSTEM = `\
You are a brand analyst. You are given raw text scraped from a brand's own website, feed or social posts, and you must infer how that brand writes.

Rules:
1. Produce a BrandProfile, a StyleGuide and a set of exemplars, all grounded in the supplied corpus. Never invent facts the corpus does not support.
2. Exemplars must be copied VERBATIM from the corpus. Never paraphrase, summarise or improve them — a paraphrased exemplar teaches your voice instead of the brand's.
3. forbidden_phrases must be grounded in something observable: a phrase the corpus explicitly bans, or a cliché conspicuously absent from otherwise similar copy. An empty array is a valid and honest answer.
4. Detect the language the corpus is written in and report it in style_guide.language as a BCP-47 tag.
5. Write every field except the verbatim exemplars in that same language.
6. Choose between three and seven exemplars, favouring real published posts over marketing pages.

If revision feedback is supplied, treat every point as a mandatory change and return a fully revised result.`;
```

Add to `MANAGED_PROMPTS` in `src/prompts/managed.ts` a fourth entry, following the existing three exactly:

```ts
  distiller: {
    key: 'distiller',
    source: 'src/prompts/distiller.ts',
    tags: [...commonTags, 'distiller'],
    placeholders: ['corpus', 'revision_feedback'],
    fallback: [
      { role: 'system', content: DISTILLER_SYSTEM },
      {
        role: 'user',
        content: ['--- CORPUS ---', '{{corpus}}', '', '{{revision_feedback}}'].join('\n'),
      },
    ],
  },
```

Widen `PromptKey` to `'strategist' | 'writer' | 'editor' | 'distiller'`, import `DISTILLER_SYSTEM`, and add:

```ts
export function distillerVariables(corpus: string, feedback?: string | null): Record<string, string> {
  return {
    corpus,
    revision_feedback: feedback ? `--- REVISION FEEDBACK (mandatory) ---\n${feedback}` : '',
  };
}
```

Create `src/ingest/nodes/distiller.ts`:

```ts
import { mergeConfigs, type RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../../activity';
import { makeChatModel } from '../../model';
import { traceOptions } from '../../observability';
import { compileManagedPrompt, distillerVariables } from '../../prompts/managed';
import { assembleCorpusInput } from '../render';
import { DistillationSchema } from '../schemas';
import type { IngestStateType } from '../state';

const CORPUS_BUDGET = 60_000;

const distillerLLM = makeChatModel().withStructuredOutput(DistillationSchema, {
  name: 'distillation',
});

export async function distiller(
  state: IngestStateType,
  config?: RunnableConfig,
): Promise<Partial<IngestStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const isRevision = Boolean(state.reviewFeedback);
  reportActivity(threadId, {
    step: 'distiller',
    kind: isRevision ? 'redistilling' : 'distilling',
    detail: isRevision
      ? `revising: "${state.reviewFeedback}"`
      : `reading ${state.rawDocs.length} document(s)`,
  });

  const corpus = assembleCorpusInput(state.rawDocs, CORPUS_BUDGET);
  const prompt = await compileManagedPrompt('distiller', distillerVariables(corpus, state.reviewFeedback));

  const distillation = await distillerLLM.invoke(
    prompt.messages,
    // Same mergeConfigs contract as every other node — without it the
    // CostTracker attached at graph.stream() never sees this call.
    mergeConfigs(config, {
      runName: isRevision ? 'distiller-revision' : 'distiller',
      tags: ['distiller', isRevision ? 'revision' : 'initial'],
      ...traceOptions(threadId, {
        agent: 'distiller',
        is_revision: isRevision,
        ...(prompt.langfusePrompt ? { langfusePrompt: prompt.langfusePrompt } : {}),
      }),
    }),
  );

  return { distillation, reviewFeedback: null };
}
```

- [ ] **Step 6: Write the review gate and the graph**

Create `src/ingest/nodes/review.ts`:

```ts
import { Command, interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import type { Distillation } from '../schemas';
import type { IngestStateType } from '../state';

const ReviewResumeSchema = z.discriminatedUnion('approved', [
  z.object({
    approved: z.literal(true),
    /** Corrections made in the review card, applied before indexing. */
    edits: z
      .object({
        profile: z.record(z.unknown()).optional(),
        style_guide: z.record(z.unknown()).optional(),
      })
      .optional(),
  }),
  z.object({ approved: z.literal(false), feedback: z.string().min(1) }),
]);

export type ReviewDecision = z.infer<typeof ReviewResumeSchema>;

/** Pure, so routing is testable without running the graph. */
export function routeAfterReview(decision: { approved: boolean }): 'indexer' | 'distiller' {
  return decision.approved ? 'indexer' : 'distiller';
}

export async function review(state: IngestStateType): Promise<Command> {
  if (!state.distillation) throw new Error('review: nothing distilled — check the distiller node');

  const resume = interrupt({
    kind: 'brand_approval',
    profile: state.distillation.profile,
    style_guide: state.distillation.style_guide,
    exemplars: state.distillation.exemplars,
    instructions:
      'Respond with { "approved": true } to index this brand, optionally with { "edits": { ... } }, or { "approved": false, "feedback": "<notes>" } to distil again.',
  });

  const parsed = ReviewResumeSchema.parse(resume);
  if (!parsed.approved) {
    return new Command({ goto: routeAfterReview(parsed), update: { reviewFeedback: parsed.feedback } });
  }

  const merged: Distillation = {
    ...state.distillation,
    profile: { ...state.distillation.profile, ...(parsed.edits?.profile ?? {}) },
    style_guide: { ...state.distillation.style_guide, ...(parsed.edits?.style_guide ?? {}) },
  };
  return new Command({ goto: routeAfterReview(parsed), update: { distillation: merged } });
}
```

Create `src/ingest/graph.ts`:

```ts
import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { distiller } from './nodes/distiller';
import { fetcher } from './nodes/fetcher';
import { indexer } from './nodes/indexer';
import { review } from './nodes/review';
import { IngestState } from './state';

const builder = new StateGraph(IngestState)
  .addNode('fetcher', fetcher)
  .addNode('distiller', distiller)
  // The review loop is uncapped, matching the plan-approval gate: the human
  // controls it. Only writer↔editor has an iteration limit.
  .addNode('review', review, { ends: ['indexer', 'distiller'] })
  .addNode('indexer', indexer, { ends: [END] })
  .addEdge(START, 'fetcher')
  .addEdge('fetcher', 'distiller')
  .addEdge('distiller', 'review');

export const ingestGraph = builder.compile({ checkpointer: new MemorySaver() });
```

- [ ] **Step 7: Run the gates and commit**

```bash
bun test tests/unit/ingestGraph.test.ts
bun run typecheck && bunx biome ci . && bun run test:unit
git add src/ingest src/prompts tests/unit/ingestGraph.test.ts
git commit -m "feat: add the ingestion graph — fetch, distil, review, index

Same interrupt() shape as the plan-approval gate, so the review loop is
uncapped and human-controlled. Approving can carry edits, which are merged
over the distilled result before indexing — the common case is 'right, but
drop that third forbidden phrase'.

The indexer replaces a brand's documents rather than appending, so
re-ingestion is idempotent, and keeps every raw page with included=false:
provenance without polluting retrieval.

The distiller forwards its RunnableConfig via mergeConfigs like every other
node; without it the CostTracker attached at graph.stream() would report
zero for the whole ingest."
```

---

### Task 6: Generalise `runManager` to drive both graphs

**Files:**
- Modify: `src/runManager.ts`
- Test: `tests/unit/runManagerIngest.test.ts`

**Interfaces:**
- Consumes: `ingestGraph`, `makeIngestState`, `IngestRequest` (Task 5).
- Produces: `startIngest(request: IngestRequest): string`; `RunRecord` gains `kind: 'content' | 'ingest'`; `resumeRun` accepts either decision shape unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/runManagerIngest.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { getRun } from '../../src/runManager';

describe('run kinds', () => {
  test('an unknown run is undefined regardless of kind', () => {
    expect(getRun('no-such-thread')).toBeUndefined();
  });
});
```

Then extend `tests/unit/runManagerActivity.test.ts`'s existing suite with:

```ts
test('a content run records its kind', async () => {
  const threadId = startRun(BRIEF);
  expect(getRun(threadId)?.kind).toBe('content');
  releaseStream();
  await settle(threadId, 'done');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/runManagerActivity.test.ts -t "records its kind"`
Expected: FAIL — `kind` does not exist on `RunRecord`.

- [ ] **Step 3: Generalise `drive`**

In `src/runManager.ts`, add the kind to the record and a spec describing each graph:

```ts
export type RunKind = 'content' | 'ingest';

export type RunRecord = {
  threadId: string;
  kind: RunKind;
  status: RunStatus;
  interruptPayload: unknown;
  events: RunEvent[];
  error?: string;
};
```

Replace the module-scope `graph` import and hard-wired `summarize`/`setDraftCost` with a per-kind spec:

```ts
type RunnerSpec = {
  // biome-ignore lint/suspicious/noExplicitAny: two compiled graphs with different state shapes
  graph: any;
  summarize: (node: string, value: unknown) => unknown;
  onDone?: (threadId: string, tracker: CostTracker) => Promise<void>;
};

function summarizeContent(node: string, value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if (node === 'strategist') return { plan: v.plan };
  if (node === 'writer') {
    const draft = v.draft as { content: string; word_count: number } | undefined;
    return draft ? { preview: draft.content.slice(0, 300), word_count: draft.word_count } : {};
  }
  if (node === 'editor') return { editFeedback: v.editFeedback };
  if (node === 'publisher') return { notionUrl: v.notionUrl ?? null };
  return {};
}

function summarizeIngest(node: string, value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if (node === 'fetcher') {
    const docs = v.rawDocs as unknown[] | undefined;
    return { documents: docs?.length ?? 0 };
  }
  if (node === 'distiller') return { distilled: Boolean(v.distillation) };
  return {};
}

const SPECS: Record<RunKind, RunnerSpec> = {
  content: {
    graph,
    summarize: summarizeContent,
    onDone: async (threadId, tracker) => {
      await setDraftCost(threadId, tracker.costUsd());
    },
  },
  ingest: { graph: ingestGraph, summarize: summarizeIngest },
};
```

`drive(run, input)` reads `const spec = SPECS[run.kind]` and uses `spec.graph.stream(...)`, `spec.summarize(...)` and `await spec.onDone?.(run.threadId, run.tracker)`. Everything else — the activity sink, the interrupt handling, the budget check, the `finally` cleanup — stays exactly as it is.

**The interrupt still emits as node `'hitl'`.** The payload's own `kind` field (`plan_approval` vs `brand_approval`) tells the client which card to render, so `/run`'s existing SSE handling is reused rather than duplicated.

- [ ] **Step 4: Add `startIngest`**

```ts
export function startIngest(request: IngestRequest): string {
  const threadId = crypto.randomUUID();
  runs.set(threadId, newRun(threadId, 'ingest'));
  void drive(runs.get(threadId) as InternalRun, makeIngestState(request));
  return threadId;
}
```

Extract the record construction shared with `startRun` into `newRun(threadId, kind)` so the two cannot drift.

- [ ] **Step 5: Run the gates and commit**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
git add src/runManager.ts tests
git commit -m "refactor: drive both graphs from one runManager

One runs map, one emit/subscribe, one SSE endpoint; a kind discriminator on
the record picks the graph, the summarizer and the completion hook. The
interrupt still emits as node 'hitl' and the payload's own kind field
distinguishes plan_approval from brand_approval, so the run page's existing
event handling is reused rather than duplicated."
```

---

### Task 7: Brand ingestion endpoints

**Files:**
- Modify: `src/server.ts`
- Test: `tests/unit/brands.test.ts`

**Interfaces:**
- Consumes: `startIngest` (Task 6); `createBrand`, `getBrand`, `getDb` from phase 1.
- Produces: `POST /brands`, `DELETE /brands/:id`, `POST /brands/:id/reingest`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/brands.test.ts`:

```ts
describe('ingestion endpoints', () => {
  test('POST /brands rejects a body with no sources', async () => {
    await freshDb();
    const { app } = await import('../../src/server');
    const res = await app.request('/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', sources: [] }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /brands rejects a website source that is not an http URL', async () => {
    await freshDb();
    const { app } = await import('../../src/server');
    const res = await app.request('/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Acme',
        sources: [{ kind: 'website', locator: 'not-a-url' }],
      }),
    });
    expect(res.status).toBe(400);
  });

  test('DELETE /brands/:id removes the brand and nulls its drafts', async () => {
    await freshDb();
    const brand = await createBrand({ name: 'Temp', slug: 'temp', language: 'en', status: 'active' });
    const { insertDraft, getDraft } = await import('../../src/db');
    await insertDraft({
      id: 'd-temp',
      topic: 'T',
      channel: 'blog',
      tone: 'x',
      audience: 'y',
      content: 'body',
      word_count: 1,
      verdict: 'APPROVED',
      tone_score: 0.9,
      accuracy_score: 0.9,
      structure_score: 0.9,
      iterations: 1,
      issues: [],
      brand_id: brand.id,
    });
    const { app } = await import('../../src/server');
    expect((await app.request(`/brands/${brand.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await getBrand(brand.id)).toBeNull();
    // The draft survives; only its attribution is cleared.
    expect((await getDraft('d-temp'))?.brand_id).toBeNull();
  });

  test('DELETE /brands/:id refuses to remove the default brand', async () => {
    await freshDb();
    const brand = await createBrand({ name: 'Only', slug: 'only', language: 'uk', status: 'active' });
    await setDefaultBrand(brand.id);
    const { app } = await import('../../src/server');
    expect((await app.request(`/brands/${brand.id}`, { method: 'DELETE' })).status).toBe(409);
  });
});
```

Add `getBrand` to the file's import from `../../src/brands`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/brands.test.ts -t "ingestion endpoints"`
Expected: FAIL — the routes 404.

- [ ] **Step 3: Add the routes**

In `src/server.ts`, import `startIngest` from `./runManager`, `createBrand` and `getDb`, then:

```ts
const SourceSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('website'), locator: z.string().url() }),
  z.object({ kind: z.literal('rss'), locator: z.string().url() }),
  z.object({ kind: z.literal('paste'), locator: z.string().default('pasted'), body: z.string().min(1) }),
]);

const CreateBrandSchema = z.object({
  name: z.string().min(1),
  sources: z.array(SourceSpecSchema).min(1),
});

/** Slugs must be unique and Chroma-safe; a collision gets a numeric suffix. */
async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'brand';
  const existing = new Set((await listBrands()).map((b) => b.slug));
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!existing.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}

app.post('/brands', async (c) => {
  sweepStaleRuns();
  const parsed = CreateBrandSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  const brand = await createBrand({
    name: parsed.data.name,
    slug: await uniqueSlug(parsed.data.name),
    language: 'en', // Replaced by the distiller's detected language on indexing.
    status: 'draft',
  });
  const threadId = startIngest({ brandId: brand.id, sources: parsed.data.sources });
  return c.json({ brand_id: brand.id, thread_id: threadId }, 201);
});

app.post('/brands/:id/reingest', async (c) => {
  const brand = await getBrand(c.req.param('id'));
  if (!brand) return c.json({ error: 'brand not found' }, 404);
  const sources = await getDb().brandSource.findMany({ where: { brandId: brand.id } });
  if (sources.length === 0) {
    return c.json({ error: 'this brand has no stored sources to re-ingest' }, 409);
  }
  const threadId = startIngest({
    brandId: brand.id,
    sources: sources.map((s) =>
      s.kind === 'paste'
        ? { kind: 'paste' as const, locator: s.locator, body: '' }
        : { kind: s.kind as 'website' | 'rss', locator: s.locator },
    ),
  });
  return c.json({ brand_id: brand.id, thread_id: threadId }, 201);
});

app.delete('/brands/:id', async (c) => {
  const brand = await getBrand(c.req.param('id'));
  if (!brand) return c.json({ error: 'brand not found' }, 404);
  if (brand.is_default) {
    return c.json({ error: 'cannot delete the default brand — make another brand default first' }, 409);
  }
  // Sources and documents cascade; drafts keep their history with a null FK.
  await getDb().brand.delete({ where: { id: brand.id } });
  return c.json({ deleted: true });
});
```

The fetcher node records each source it read, so `reingest` has something to replay. Add to `src/ingest/nodes/fetcher.ts`, after a source's documents are collected:

```ts
    await getDb().brandSource.create({
      data: {
        brandId: state.request.brandId,
        kind: spec.kind,
        locator: spec.locator,
        pageCount: fetched.length,
      },
    });
```

with `fetched` being that source's `RawDoc[]`, and clear prior rows once at the top of the node via `await getDb().brandSource.deleteMany({ where: { brandId: state.request.brandId } })`.

- [ ] **Step 4: Run the gates and commit**

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
git add src tests
git commit -m "feat: add brand creation, deletion and re-ingestion endpoints

POST /brands creates a draft-status brand and starts an ingest run; the
distiller's detected language replaces the placeholder when it indexes.
Slugs are derived from the name and de-duplicated with a numeric suffix,
since they key the vector collection.

DELETE refuses the default brand — losing it would leave /run with nothing
to select — and drafts keep their history with a null FK rather than
cascading away. Re-ingestion replays the sources the fetcher recorded."
```

---

### Task 8: Brand screens

**Files:**
- Create: `web/app/(dashboard)/brands/page.tsx`, `web/app/(dashboard)/brands/new/page.tsx`, `web/app/(dashboard)/brands/[id]/page.tsx`, `web/components/brand-review.tsx`
- Modify: `web/lib/types.ts`, `web/lib/api.ts`, `web/components/nav.tsx`

**Interfaces:**
- Consumes: `POST /brands`, `GET /brands`, `GET /brands/:id` (Task 7); `GET /runs/:id/events` (Task 6).
- Produces: nothing downstream.

- [ ] **Step 1: Add the types and fetchers**

In `web/lib/types.ts`:

```ts
export type BrandDocument = {
  id: string;
  kind: 'profile' | 'style_guide' | 'exemplar' | 'raw_page';
  title: string;
  content: string;
  included: boolean;
};

export type BrandProfilePayload = {
  name: string;
  mission: string;
  services: string[];
  audience_primary: string;
  audience_secondary: string;
  positioning: string;
  channels: Array<{ channel: string; description: string; word_range: string; cadence: string }>;
};

export type StyleGuidePayload = {
  voice: string[];
  forbidden_phrases: string[];
  preferred_constructions: string[];
  formatting_rules: string[];
  language: string;
};

/** Ingest steps, deliberately separate from NODES. */
export const INGEST_NODES = ['fetcher', 'distiller', 'review', 'indexer'];
```

In `web/lib/api.ts`, add `fetchBrand(id)` returning `Brand & { documents: BrandDocument[] } | null` from `/brands/:id`, mirroring `fetchDraft`'s shape. Extend `GET /brands/:id` in `src/server.ts` to include its documents:

```ts
app.get('/brands/:id', async (c) => {
  const brand = await getBrand(c.req.param('id'));
  if (!brand) return c.json({ error: 'brand not found' }, 404);
  const documents = await getDb().brandDocument.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, title: true, content: true, included: true },
  });
  return c.json({ ...brand, documents });
});
```

- [ ] **Step 2: Write the brands list screen**

Create `web/app/(dashboard)/brands/page.tsx` — a Server Component mirroring `drafts/page.tsx`:

```tsx
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { fetchBrands } from '@/lib/api';
import { formatDate } from '@/lib/format';

export default async function BrandsPage() {
  const brands = await fetchBrands();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Brands</h1>
        <Button asChild>
          <Link href="/brands/new">New brand</Link>
        </Button>
      </div>

      {brands.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No brands yet.{' '}
          <Link href="/brands/new" className="underline">
            Ingest one from a website →
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left">
              <tr>
                <th className="eonyx-label p-3 font-normal">Name</th>
                <th className="eonyx-label p-3 font-normal">Status</th>
                <th className="eonyx-label p-3 font-normal">Language</th>
                <th className="eonyx-label p-3 font-normal">Created</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr key={brand.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link href={`/brands/${brand.id}`} className="font-medium hover:underline">
                      {brand.name}
                    </Link>
                    {brand.is_default ? (
                      <span className="ml-2 text-xs text-muted-foreground">default</span>
                    ) : null}
                  </td>
                  <td className="p-3 text-muted-foreground">{brand.status}</td>
                  <td className="p-3 text-muted-foreground">{brand.language}</td>
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(brand.created_at)}
                  </td>
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

- [ ] **Step 3: Write the review card**

Create `web/components/brand-review.tsx`, a `PlanApproval` sibling with editable fields:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BrandProfilePayload, StyleGuidePayload } from '@/lib/types';

const AREA = 'min-h-24 w-full rounded-md border bg-transparent p-2 text-sm';

/** One line per entry keeps the round-trip lossless and obvious to edit. */
function toLines(values: string[]): string {
  return values.join('\n');
}

function fromLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export function BrandReview({
  profile,
  styleGuide,
  exemplarCount,
  onDecision,
}: {
  profile: BrandProfilePayload;
  styleGuide: StyleGuidePayload;
  exemplarCount: number;
  onDecision: (
    approved: boolean,
    payload?: { feedback?: string; edits?: Record<string, unknown> },
  ) => void;
}) {
  const [mission, setMission] = useState(profile.mission);
  const [voice, setVoice] = useState(toLines(styleGuide.voice));
  const [forbidden, setForbidden] = useState(toLines(styleGuide.forbidden_phrases));
  const [feedback, setFeedback] = useState('');

  return (
    <Card className="border-brand/40">
      <CardHeader>
        <CardTitle>
          {profile.name} — approve this brand?{' '}
          <span className="text-sm font-normal text-muted-foreground">
            {styleGuide.language} · {exemplarCount} exemplars
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">Mission</span>
          <textarea value={mission} onChange={(e) => setMission(e.target.value)} className={AREA} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">Voice — one per line</span>
          <textarea value={voice} onChange={(e) => setVoice(e.target.value)} className={AREA} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="eonyx-label">Forbidden phrases — one per line</span>
          <textarea value={forbidden} onChange={(e) => setForbidden(e.target.value)} className={AREA} />
        </label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Feedback (required to distil again)"
          className={AREA}
        />
        <div className="flex gap-2">
          <Button
            onClick={() =>
              onDecision(true, {
                edits: {
                  profile: { mission },
                  style_guide: { voice: fromLines(voice), forbidden_phrases: fromLines(forbidden) },
                },
              })
            }
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            disabled={feedback.trim().length === 0}
            onClick={() => onDecision(false, { feedback: feedback.trim() })}
          >
            Distil again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write the new-brand screen**

Create `web/app/(dashboard)/brands/new/page.tsx` as a Client Component. Copy the `listen`/`seq`-dedupe structure from `web/app/(dashboard)/run/page.tsx` verbatim — the two pages diverge in what they render, and abstracting over two call sites would be premature. The three parts that actually differ:

```tsx
const [review, setReview] = useState<{
  profile: BrandProfilePayload;
  styleGuide: StyleGuidePayload;
  exemplarCount: number;
} | null>(null);
const brandIdRef = useRef<string | null>(null);
const router = useRouter();

function handle(event: RunEvent) {
  if (INGEST_NODES.includes(event.node)) {
    setDone((prev) => new Set(prev).add(event.node));
  }
  // Same 'hitl' node as a content run — the payload's own kind is what
  // distinguishes a brand review from a plan approval.
  if (event.node === 'hitl' && event.data?.awaiting) {
    const payload = event.data.payload;
    if (payload?.kind === 'brand_approval') {
      setReview({
        profile: payload.profile,
        styleGuide: payload.style_guide,
        exemplarCount: payload.exemplars?.length ?? 0,
      });
    }
  }
  if (event.node === 'done') {
    setRunning(false);
    if (brandIdRef.current) router.push(`/brands/${brandIdRef.current}`);
  }
  if (event.node === 'error') {
    setError(event.data.message ?? 'Ingestion failed');
    setRunning(false);
  }
}

async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  // Only non-empty sources are sent; the API requires at least one.
  const sources: Array<Record<string, string>> = [];
  const website = String(form.get('website') ?? '').trim();
  const rss = String(form.get('rss') ?? '').trim();
  const pasted = String(form.get('pasted') ?? '').trim();
  if (website) sources.push({ kind: 'website', locator: website });
  if (rss) sources.push({ kind: 'rss', locator: rss });
  if (pasted) sources.push({ kind: 'paste', locator: 'pasted', body: pasted });
  if (sources.length === 0) {
    setError('Give at least one source: a website, a feed, or pasted posts.');
    return;
  }

  setError(null);
  setRunning(true);
  const res = await fetch('/api/brands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: form.get('name'), sources }),
  });
  if (!res.ok) {
    setError(`Could not start ingestion (${res.status})`);
    setRunning(false);
    return;
  }
  const { brand_id, thread_id } = (await res.json()) as { brand_id: string; thread_id: string };
  brandIdRef.current = brand_id;
  listen(thread_id);
}

async function decide(approved: boolean, payload?: { feedback?: string; edits?: unknown }) {
  const id = threadIdRef.current;
  if (!id) return;
  setReview(null);
  await fetch(`/api/runs/${id}/resume`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(approved ? { approved: true, edits: payload?.edits } : { approved: false, feedback: payload?.feedback }),
  });
  listen(id); // The client reopens after every resume; seq dedupe covers the replay.
}
```

The form collects name (required), website URL, RSS URL, and a pasted-posts textarea, and renders `<PipelineProgress done={done} active={active} nodes={INGEST_NODES} />`. `PipelineProgress` currently hard-codes `NODES` — give it an optional `nodes` prop defaulting to `NODES` so both pages can share it.

- [ ] **Step 5: Write the brand detail screen**

Create `web/app/(dashboard)/brands/[id]/page.tsx` — a Server Component rendering the profile and style-guide documents, the exemplar list, and a provenance section counting `raw_page` documents. `params` is a Promise in Next 16: `const { id } = await params`.

- [ ] **Step 6: Add the nav link**

In `web/components/nav.tsx`, add `{ href: '/brands', label: 'Brands' }` between `New run` and `Drafts`.

- [ ] **Step 7: Build and commit**

```bash
cd web && bun run build
git add web src/server.ts
git commit -m "feat: add the Brands screens

/brands/new reuses the run page's SSE plumbing: same seq dedupe, same
PipelineProgress and ActivityLog, with INGEST_NODES for the steps. The
review card is a PlanApproval sibling whose textareas edit the distilled
result in place, since the common correction is 'right, but drop that third
forbidden phrase' rather than a full rejection."
```

---

### Task 9: Prompts, docs and live verification

- [ ] **Step 1: Publish the distiller prompt**

```bash
bun run upload-prompts
```

Expected: four prompts now, with `content-creator-agent/distiller` uploaded for the first time. The three existing ones report `unchanged`.

- [ ] **Step 2: Ingest eonyx.net end to end**

Chroma must be running (`docker start chroma`). Verified live on 2026-08-02: `robots.txt` allows all agents, `sitemap.xml` returns 200, and the homepage extracts to ~6.6 KB of Ukrainian brand copy.

```bash
SKIP_PUBLISH=true DATABASE_URL="file:/tmp/ingest-verify.db" bun run src/server.ts &
sleep 3
bunx prisma migrate deploy   # against the same DATABASE_URL
TID=$(curl -s -X POST localhost:3000/brands -H 'content-type: application/json' \
  -d '{"name":"EONYX Live","sources":[{"kind":"website","locator":"https://eonyx.net/uk"}]}' \
  | bun -e 'const r=JSON.parse(await Bun.stdin.text());console.log(r.thread_id)')
```

Poll `curl -s localhost:3000/runs/$TID` until `awaiting_approval`, read the `brand_approval` payload, approve, then poll to `done`.

Expected: `style_guide.language` is `uk`, the profile describes an AI deployment studio for B2B rather than anything generic, and every exemplar's text appears verbatim in a crawled page.

**The sitemap lists only four URLs** — `/uk`, `/en`, `/uk/privacy`, `/en/privacy` — so a website-only ingest yields roughly two content pages. That is a thin base for exemplars, and it exercises a case worth checking deliberately: the distiller must return three to seven exemplars from a small corpus without inventing any. If it pads with paraphrase, tighten rule 2 in `DISTILLER_SYSTEM` rather than accepting the output.

Also confirm the crawl does **not** mix languages: `/uk` and `/en` are the same content in two languages, and `sameOrigin` admits both. If the run returns a bilingual corpus, add a language filter to the fetcher before shipping — a mixed corpus would defeat the `{{language}}` work from phase 0.

- [ ] **Step 2b: Ingest with pasted posts as well**

Repeat with a second source, to exercise the multi-source path and give the distiller real published copy rather than only landing-page marketing:

```bash
curl -s -X POST localhost:3000/brands -H 'content-type: application/json' \
  -d '{"name":"EONYX Social","sources":[
        {"kind":"website","locator":"https://eonyx.net/uk"},
        {"kind":"paste","locator":"linkedin","body":"<post one>\n---\n<post two>\n---\n<post three>"}]}'
```

Expected: exemplars are drawn from the pasted posts rather than the landing page, since `assembleCorpusInput` orders posts first.

- [ ] **Step 3: Generate against the ingested brand**

`POST /runs` with the new `brand_id`. Expected: the draft follows the ingested voice, and the Editor cites rules from the ingested style guide rather than EONYX's.

- [ ] **Step 4: Document it**

In `README.md`, add a "Brand ingestion" section covering `POST /brands`, the four source kinds, and the review gate. In `CLAUDE.md`, add to the brands section: the ingestion graph's shape, that `HTMLRewriter` does not decode entities (with the two live examples), that the review loop is uncapped by design, and that `raw_page` documents are provenance-only.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document brand ingestion and its constraints"
```

---

## Out of scope for this phase

- **Paid social sources.** Phase 3 adds an Apify-backed fetcher behind `APIFY_TOKEN`; `fetcherFor()` already returns null for an unavailable kind.
- **Scheduled re-crawling.** Re-ingestion is a button.
- **The Editor verdict bug** — `REVISION_NEEDED` on scores above its own 0.8 threshold. Tracked separately.
- **Editing exemplars in the review card.** Mission, voice and forbidden phrases are editable; exemplars are accept-or-redistil, because a hand-edited exemplar stops being evidence.
