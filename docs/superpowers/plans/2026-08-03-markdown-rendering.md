# Markdown Rendering, Copy and Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the brand profile, style guide and draft content as formatted documents, and let a reader copy or download a draft.

**Architecture:** One `<Markdown>` Server Component wrapping `react-markdown` with raw HTML left off, styled by a scoped `.eonyx-prose` class. A separate client island holds copy and download, because both need the browser. Exemplars keep their `<pre>` — they are plain text, not markdown.

**Tech Stack:** Next.js 16, React 19, `react-markdown`, `remark-gfm`, Bun, Tailwind v4, Biome.

## Global Constraints

Verified by spike on 2026-08-03 — trust these over recollection.

- **`rehype-raw` is never added.** It is the one line that would undo the security property. `react-markdown` escapes raw HTML by default; the ingest pipeline is a channel for third-party content reaching this UI, and exemplars are copied verbatim from crawled pages.
- **The escaped payload still contains the attacker's substrings.** A spike confirmed the output is `&lt;img src=x onerror=alert(1)&gt;` — so asserting `not.toContain('onerror')` **fails**, because the text is present and harmless. Assert on `<script` / `<img` (no element created) and on `&lt;script&gt;` (escaped as text).
- **Tests for these components live in `web/tests/`, not `tests/unit/`.** `react-markdown` resolves from `web/node_modules` and a root test cannot import it. They run with `cd web && bun test`.
- **Root CI does not run `web/` tests.** `.github/workflows/ci.yml` runs only the root suite, so a step must be added or the new tests never run in CI.
- `web/` is excluded from root Biome and root `tsc` — typecheck it with `cd web && bun run build`.
- Runtime is **Bun**: `bun`, `bun test`, `bunx`. Never `node`, `npm`, `npx`.
- Commits: Conventional Commits. Do **not** add a Claude co-author trailer.

---

### Task 1: The Markdown component

**Files:**
- Create: `web/components/markdown.tsx`, `web/tests/markdown.test.tsx`
- Modify: `web/app/globals.css`, `web/package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `<Markdown source={string} className?={string} />` — a Server Component rendering GFM markdown with raw HTML escaped.

- [ ] **Step 1: Install the dependencies**

```bash
cd web && bun add react-markdown remark-gfm
```

- [ ] **Step 2: Write the failing test**

Create `web/tests/markdown.test.tsx`:

```tsx
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/markdown';

const render = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe('Markdown', () => {
  test('renders heading levels as distinct elements', () => {
    const html = render('# One\n\n## Two\n\n### Three');
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('<h3');
  });

  test('renders emphasis and lists rather than their source characters', () => {
    const html = render('**bold**\n\n- first\n- second');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>');
    expect(html).not.toContain('**bold**');
  });

  test('renders GFM tables', () => {
    const html = render('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table');
  });

  test('escapes raw HTML instead of rendering it', () => {
    // The security property this component exists to hold. Brand documents are
    // distilled from crawled pages, so the source is attacker-influenced.
    const html = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>');
    // No element is created…
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    // …and the payload survives as visible, inert text. Asserting
    // not.toContain('onerror') would fail here: the substring is present and
    // harmless, which is the whole point.
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  test('opens links in a new tab without leaking the referrer', () => {
    const html = render('[x](https://example.com)');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  test('renders nothing for empty source rather than throwing', () => {
    expect(render('')).toBe('');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && bun test tests/markdown.test.tsx`
Expected: FAIL — `Cannot find module '../components/markdown'`.

- [ ] **Step 4: Write the component**

Create `web/components/markdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders markdown as a document.
 *
 * Raw HTML is escaped, not rendered, because `rehype-raw` is deliberately
 * absent. Brand profiles and style guides are distilled from crawled pages and
 * draft content is generated from that corpus, so the source is
 * attacker-influenced by construction. Adding `rehype-raw` would turn a crawled
 * `<img src=x onerror=…>` into stored XSS.
 *
 * A Server Component: nothing here is interactive.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  if (!source) return null;

  return (
    <div className={className ? `eonyx-prose ${className}` : 'eonyx-prose'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Links inside brand documents point at third-party sites.
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: Add the prose styles**

Append to `web/app/globals.css`. Tailwind's typography plugin is not used: it carries its own colour opinions that fight the EONYX variables, and overriding them costs more than this.

```css
/* Markdown output. Scoped so it can never leak into the app chrome, and built
   from EONYX tokens rather than browser defaults. */
.eonyx-prose {
  font-size: 0.875rem;
  line-height: 1.65;
  color: var(--foreground);
}
.eonyx-prose > :first-child {
  margin-top: 0;
}
.eonyx-prose > :last-child {
  margin-bottom: 0;
}
.eonyx-prose h1,
.eonyx-prose h2,
.eonyx-prose h3,
.eonyx-prose h4 {
  font-weight: 600;
  letter-spacing: -0.015em;
  margin: 1.5em 0 0.5em;
}
.eonyx-prose h1 {
  font-size: 1.5rem;
}
.eonyx-prose h2 {
  font-size: 1.2rem;
}
.eonyx-prose h3 {
  font-size: 1rem;
}
.eonyx-prose h4 {
  font-size: 0.9rem;
}
.eonyx-prose p {
  margin: 0.75em 0;
}
.eonyx-prose ul,
.eonyx-prose ol {
  margin: 0.75em 0;
  padding-left: 1.25rem;
}
.eonyx-prose ul {
  list-style: disc;
}
.eonyx-prose ol {
  list-style: decimal;
}
.eonyx-prose li {
  margin: 0.25em 0;
}
.eonyx-prose a {
  color: var(--brand);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.eonyx-prose strong {
  font-weight: 600;
  color: var(--foreground);
}
.eonyx-prose blockquote {
  border-left: 2px solid var(--brand);
  padding-left: 0.875rem;
  color: var(--muted-foreground);
  margin: 1em 0;
}
.eonyx-prose code {
  font-family: var(--font-jetbrains-mono), ui-monospace, monospace;
  font-size: 0.85em;
  background: var(--muted);
  border-radius: 2px;
  padding: 0.1em 0.3em;
}
.eonyx-prose pre {
  background: var(--muted);
  border-radius: 2px;
  padding: 0.75rem;
  overflow-x: auto;
  margin: 1em 0;
}
.eonyx-prose pre code {
  background: none;
  padding: 0;
}
.eonyx-prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  display: block;
  overflow-x: auto;
}
.eonyx-prose th,
.eonyx-prose td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.6rem;
  text-align: left;
}
.eonyx-prose hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 1.5em 0;
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && bun test tests/markdown.test.tsx`
Expected: PASS, 6 cases.

- [ ] **Step 7: Make CI run the web tests**

Root CI never runs anything in `web/`, so without this the new tests exist and never execute. In `.github/workflows/ci.yml`, after the existing `bun run test:unit` step:

```yaml
      # web/ has its own package and node_modules; react-markdown is not
      # resolvable from the root, so its tests live and run there.
      - run: bun install --frozen-lockfile
        working-directory: web
      - run: bun test
        working-directory: web
```

- [ ] **Step 8: Commit**

```bash
cd web && bun run build   # typecheck
cd .. && bunx biome ci . && bun run test:unit
git add web/components/markdown.tsx web/tests web/app/globals.css web/package.json web/bun.lock .github/workflows/ci.yml
git commit -m "feat: add a Markdown component that escapes raw HTML

rehype-raw is deliberately absent, which is what makes this safe: brand
profiles and style guides are distilled from crawled pages, so the source is
attacker-influenced and a rendered <img onerror=...> would be stored XSS.

The test asserts no script or img element is created and that the payload
survives as escaped text. Asserting the absence of 'onerror' would fail —
the substring is present and inert, which is exactly the property wanted.

Styling is a scoped .eonyx-prose class rather than Tailwind typography,
whose colour opinions fight the EONYX variables.

CI gains a step to run web/ tests; the root suite never touched them."
```

---

### Task 2: Render markdown on the brand and draft screens

**Files:**
- Modify: `web/app/[locale]/(dashboard)/brands/[id]/page.tsx`, `web/app/[locale]/(dashboard)/drafts/[id]/page.tsx`

**Interfaces:**
- Consumes: `<Markdown source={string} />` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Replace the three markdown `<pre>` blocks**

In `brands/[id]/page.tsx`, the profile and style-guide cards each hold:

```tsx
<pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
  {profile.content}
</pre>
```

Replace each with `<Markdown source={profile.content} />` and `<Markdown source={styleGuide.content} />`. Add `import { Markdown } from '@/components/markdown';`.

In `drafts/[id]/page.tsx`, replace the content card's `<pre>` with `<Markdown source={draft.content} />` and add the same import.

- [ ] **Step 2: Leave the exemplar `<pre>` exactly as it is**

The third `<pre>` in `brands/[id]/page.tsx` renders `doc.content` for each exemplar. **Do not change it.**

Exemplars come from `extractText()` as plain prose, not markdown — verified against a real ingested brand, where `profile` and `style_guide` contain heading syntax and exemplars contain none. Parsing them would let a `#` or `*` occurring in crawled prose become a heading or emphasis, and an exemplar exists to be verbatim evidence of how a brand writes.

Add a comment above it so the next reader does not "fix" the inconsistency:

```tsx
{/* Not <Markdown>: exemplars are plain text from extractText(), copied
    verbatim from a crawled page. Parsing them would let an incidental # or *
    become formatting and stop them being evidence. */}
```

- [ ] **Step 3: Build and look at both screens**

```bash
cd web && bun run build
cd .. && bun run dev:all
```

Open a draft and a brand. Expected: heading hierarchy visible, lists rendered, no literal `#` or `**`. The exemplar block still shows raw line breaks.

- [ ] **Step 4: Commit**

```bash
git add "web/app/[locale]/(dashboard)"
git commit -m "feat: render brand and draft markdown as documents

The profile, style guide and draft content were shown inside <pre>, so every
# and ** was visible and h1, h2 and h3 rendered at the same size — the
structure the editor scores was invisible on the screen presenting it.

Exemplars keep their <pre> and gained a comment saying why: they are plain
text from extractText(), and parsing them would turn an incidental # from a
crawled page into a heading."
```

---

### Task 3: Copy and download a draft

**Files:**
- Create: `web/components/draft-actions.tsx`, `web/tests/format.test.ts`
- Modify: `web/lib/format.ts`, `web/i18n/messages/en.ts`, `web/i18n/messages/uk.ts`, `web/app/[locale]/(dashboard)/drafts/[id]/page.tsx`

**Interfaces:**
- Consumes: `useMessages()` from `@/i18n/provider`.
- Produces: `slugifyTopic(text: string): string` in `web/lib/format.ts`; `<DraftActions topic={string} id={string} content={string} />`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/format.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { slugifyTopic } from '../lib/format';

describe('slugifyTopic', () => {
  test('keeps Ukrainian letters rather than stripping them to nothing', () => {
    // \p{L} not [a-z]: a Ukrainian topic must not produce an empty filename.
    expect(slugifyTopic('Як LLM-асистент замінив менеджера')).toBe(
      'як-llm-асистент-замінив-менеджера',
    );
  });

  test('lowercases and joins words with single hyphens', () => {
    expect(slugifyTopic('How an AI  Assistant Saves Time')).toBe(
      'how-an-ai-assistant-saves-time',
    );
  });

  test('trims leading and trailing separators', () => {
    expect(slugifyTopic('  —Hello, world!  ')).toBe('hello-world');
  });

  test('caps length so a long topic cannot produce an unusable filename', () => {
    expect(slugifyTopic('word '.repeat(50)).length).toBeLessThanOrEqual(60);
  });

  test('returns an empty string when nothing survives, for the caller to replace', () => {
    expect(slugifyTopic('!!! ???')).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && bun test tests/format.test.ts`
Expected: FAIL — `slugifyTopic` is not exported.

- [ ] **Step 3: Add the slug helper**

Append to `web/lib/format.ts`:

```ts
/**
 * Filename-safe slug for a draft download.
 *
 * Deliberately duplicated from `slugify` in `src/nodes/finalizer.ts` rather
 * than shared: the two apps share no code, `web/` has its own bundler root, and
 * importing across that boundary would break the standalone build. Four lines
 * is cheaper than the coupling — but if the convention changes, change both.
 *
 * `\p{L}\p{N}` rather than `[a-z0-9]`, so a Ukrainian topic yields a real
 * filename instead of an empty string.
 */
export function slugifyTopic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && bun test tests/format.test.ts`
Expected: PASS, 5 cases.

- [ ] **Step 5: Add the catalogue entries**

In `web/i18n/messages/en.ts`, inside `drafts`:

```ts
    copy: 'Copy markdown',
    copied: 'Copied',
    copyFailed: 'Could not copy. Select the text and copy it manually.',
    download: 'Download .md',
```

In `web/i18n/messages/uk.ts`, inside `drafts`:

```ts
    copy: 'Копіювати markdown',
    copied: 'Скопійовано',
    copyFailed: 'Не вдалося скопіювати. Виділіть текст і скопіюйте вручну.',
    download: 'Завантажити .md',
```

- [ ] **Step 6: Write the actions component**

Create `web/components/draft-actions.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useMessages } from '@/i18n/provider';
import { slugifyTopic } from '@/lib/format';

/**
 * Copy and download for a draft. A client island because both the clipboard
 * and a Blob download need the browser — the page itself is a Server Component.
 *
 * Rendering markdown removed the reader's ability to select the source, so
 * these are part of that change rather than an extra.
 */
export function DraftActions({
  topic,
  id,
  content,
}: {
  topic: string;
  id: string;
  content: string;
}) {
  const m = useMessages();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const filename = `${slugifyTopic(topic) || 'draft'}-${id.slice(0, 8)}.md`;

  async function copy() {
    try {
      // The markdown source, not the rendered text: the point is pasting into
      // a CMS or editor.
      await navigator.clipboard.writeText(content);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      // navigator.clipboard is undefined on non-secure origins other than
      // localhost, so this is a real path rather than defensive noise.
      setState('failed');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          {state === 'copied' ? m.drafts.copied : m.drafts.copy}
        </Button>
        <Button variant="secondary" onClick={download}>
          {m.drafts.download}
        </Button>
      </div>
      {state === 'failed' ? (
        <p className="text-sm text-destructive">{m.drafts.copyFailed}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: Put the actions on the draft page**

In `drafts/[id]/page.tsx`, import it and render it inside the content card, below `<Markdown>`:

```tsx
<Markdown source={draft.content} />
<div className="mt-4 border-t border-border/60 pt-4">
  <DraftActions topic={draft.topic} id={draft.id} content={draft.content} />
</div>
```

- [ ] **Step 8: Build, then check it in a browser**

```bash
cd web && bun run build
cd .. && bun run dev:all
```

Open a draft in both `/uk` and `/en`. Expected: copy places the **markdown source** on the clipboard (paste into an editor and confirm the `#` characters are there), and download produces a `.md` file named after the topic. A Ukrainian topic must produce a Cyrillic filename, not `-1a2b3c4d.md`.

- [ ] **Step 9: Commit**

```bash
cd web && bun run build
cd .. && bunx biome ci . && bun run test:unit
git add web
git commit -m "feat: copy and download a draft as markdown

Rendering markdown removed the reader's ability to select the source, so
export became part of that change rather than an addition. Copy writes the
markdown source, not the rendered text, since the point is pasting into a
CMS.

The slug is duplicated from finalizer rather than shared: the two apps share
no code and web/ has its own bundler root. It uses \\p{L}\\p{N} so a
Ukrainian topic produces a real filename."
```

---

## Verification before handoff

```bash
bun run typecheck && bunx biome ci . && bun run test:unit
cd web && bun test && bun run build
```

Then walk both screens in both locales:

- A draft shows heading hierarchy, rendered lists, and no literal `#` or `**`
- Brand profile and style guide render the same way
- **Exemplars still render verbatim** — if they gained formatting, Task 2 Step 2 was not followed
- Copy yields markdown source; download yields a `.md` named after the topic
- A draft whose content contains `<script>` shows it as text

## Out of scope

- **Syntax highlighting.** Drafts are prose.
- **Markdown editing.** Read-only.
- **`rehype-raw`.** Adding it would undo the security property this design rests on.
- **Persisting the approved plan** on the draft, and **regenerating rows** whose costs were computed at the old gpt-4o-mini rates. Both are real problems with the drafts screen; neither is a rendering problem.
