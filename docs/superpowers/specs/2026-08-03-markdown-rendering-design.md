# Markdown Rendering, Copy and Download — Design Spec

**Date:** 2026-08-03
**Goal:** Show the pipeline's output as a document rather than as source, and give the reader a way to take it away.

---

## 1. Context

Four screens render markdown inside `<pre className="whitespace-pre-wrap">`: the brand profile, the brand style guide, brand exemplars, and the draft content.

The result is that every `#` and `**` is visible, and an `h1`, `h2` and `h3` render at identical size. A real draft currently reads:

```
# How an AI Assistant Can Save You 10 Hours a Week
...combine several small wins... **how AI saves time for SMB owners**
## Where the 10 Hours Come From: A Weekly Time-Savings Breakdown
### Inbox and customer-message triage — 2 hours
```

The structure the Editor scored 0.95 on is invisible on the screen that presents it, and the product's claim is "publication-ready content".

There is also no way to get a draft out of the dashboard except selecting text across a card. Rendering markdown makes that strictly worse, because the source is no longer selectable — so export stops being a nicety and becomes part of the same change.

## 2. Goals and non-goals

**In scope**

- Render the brand profile, brand style guide and draft content as formatted markdown
- Copy a draft to the clipboard as markdown source
- Download a draft as a `.md` file
- Style the output with EONYX tokens rather than browser defaults

**Explicitly out of scope**

- **Exemplars.** They are plain text, not markdown — see §3. They keep their `<pre>`.
- **Syntax highlighting.** Drafts are prose; a highlighter is a dependency for a case that does not arise.
- **Markdown editing.** Read-only rendering.
- **A sanitiser library.** Nothing ever becomes an HTML string, so there is nothing to sanitise — see §4.
- **Persisting the approved plan** on the draft, and **regenerating the stale rows** whose costs were computed at the wrong rates. Both are real problems with the drafts screen; neither is a rendering problem.

## 3. Exemplars stay as plain text

Checked against a real ingested brand rather than assumed:

| Document kind | Contains markdown syntax |
|---|---|
| `profile` | yes — `# EONYX — Brand overview`, `## Mission` |
| `style_guide` | yes — headings and `-` lists |
| `exemplar` | **no** — plain prose with newlines |

`profile` and `style_guide` are produced by `src/ingest/render.ts`, which emits markdown deliberately. Exemplars are copied verbatim out of `extractText()`, which strips HTML and yields plain prose.

Rendering an exemplar through a markdown parser would therefore *misinterpret* it: a `#` or `*` occurring in crawled prose would silently become a heading or emphasis. Exemplars exist to be verbatim evidence of how a brand writes, so altering their appearance defeats their purpose. They keep `<pre>`.

## 4. Raw HTML is never rendered

Two of the three rendered surfaces show text distilled from pages this project crawled. The ingest pipeline is, by construction, a channel for third-party content to reach the dashboard, and exemplars are copied verbatim by design.

`react-markdown` does not render raw HTML unless `rehype-raw` is added. It is not added. A crawled page containing `<img src=x onerror=alert(document.cookie)>` therefore renders as visible text rather than executing.

This is why `react-markdown` was chosen over `marked` + `DOMPurify`: the latter parses to an HTML string and then sanitises it, so safety depends on the sanitiser being configured correctly. `react-markdown` never constructs the dangerous string, which is a stronger position than cleaning one up.

## 5. Components

```
web/components/markdown.tsx        <Markdown source={string} />
web/components/draft-actions.tsx   copy + download, client island
web/app/globals.css                .eonyx-prose — spacing and type scale
```

**`<Markdown>`** is a Server Component: it renders `react-markdown` with `remark-gfm` (tables, strikethrough) and a component map binding output to EONYX tokens — headings on the existing type scale, `code` in JetBrains Mono, and `a` with `target="_blank" rel="noreferrer"` because links inside brand documents come from crawled sites.

Spacing lives in a scoped `.eonyx-prose` class rather than in the component map. Tailwind's typography plugin is the usual answer and is rejected here: it carries its own colour opinions that fight the EONYX variables, and overriding them is more work than a dozen lines of scoped CSS.

**`<DraftActions>`** is a Client Component, because the clipboard and a Blob download both need the browser. It sits beside the existing `PublishButton`, which is already a client island for the same reason.

- **Copy** writes `draft.content` — the markdown *source*, not the rendered text — since the point is pasting into a CMS or editor. It shows a transient confirmation and falls back to an error message when `navigator.clipboard` is unavailable, which is the case on plain HTTP origins other than localhost.
- **Download** builds a `Blob` and clicks a temporary anchor. The filename follows the convention already in `src/nodes/finalizer.ts`: `${slug(topic)}-${id.slice(0, 8)}.md`, using the same Unicode-aware pattern (`[^\p{L}\p{N}]+` → `-`) so Ukrainian topics produce real filenames rather than empty ones.

  The slug function is **duplicated** into `web/lib/format.ts` rather than shared. The two apps share no code by design — `web/` is a separate package with its own bundler root, and reaching into `src/` would break the boundary `web/AGENTS.md` establishes and the standalone build depends on. Four lines of pure string handling is a smaller cost than a cross-package import, and the duplication is noted in both copies so a change to one prompts a look at the other.

## 6. Copy

New catalogue entries in both locales under `drafts`: `copy`, `copied`, `copyFailed`, `download`. Nothing else changes in `web/i18n`.

## 7. Testing

**Unit:** the web-side slug gets a test alongside the other formatters — a Ukrainian topic produces a usable slug rather than an empty string, and an all-punctuation topic produces an empty one that the caller replaces with a fallback. `finalizer`'s copy is untouched and already covered.

**Unit:** the security assertion that matters — given a source string containing `<img src=x onerror=alert(1)>` and `<script>alert(1)</script>`, the rendered output contains that text and creates no `img` or `script` element.

**Manual:** both screens in both locales, confirming headings show hierarchy, lists render as lists, and the copy and download buttons work. The build and typecheck cover the rest.

## 8. Success criteria

- A draft renders with visible heading hierarchy and no literal `#` or `**`
- Brand profile and style guide render the same way
- Exemplars still render verbatim, unchanged
- Copy places markdown source on the clipboard; download produces a `.md` file named after the topic
- A crawled `<script>` renders as text and executes nothing
- `bun run typecheck`, `bunx biome ci .`, `bun run test:unit` and `cd web && bun run build` all pass
