# Brand Ingestion & Multi-Brand Corpus — Design Spec

**Date:** 2026-08-02
**Goal:** Point the system at a website, RSS feed, or set of social posts and have it learn that brand's voice — producing a reviewed, editable style guide that becomes a first-class brand the pipeline can write for. Keep several brands side by side and pick one per run.

---

## 0. Prerequisite, shipped ahead of this work

`data/brand/*.md` is written in Ukrainian while the prompts, `/run` defaults and generated drafts are English. The Editor therefore receives Ukrainian style excerpts and is asked to score English copy against them, so brand alignment — the product's actual differentiator — silently does nothing in the default demo.

This is a live defect rather than a gap this design creates, and it is fixed on its own before phase 1 begins: add a `{{language}}` placeholder to the strategist, writer and editor prompts, drive it from the brief, and run `bun run upload-prompts`. That upload is required rather than an optional follow-up — the three prompts are Langfuse-managed, so a local edit is silently overridden by the deployed version until it is pushed.

This design then *reuses* that placeholder rather than introducing it: §9 detects each brand's language during distillation and stores it on the `Brand` row, so an ingested Ukrainian site produces Ukrainian drafts automatically.

## 1. Context

The brand corpus today is fixed at deploy time. `src/tools/rag.ts` loads `SourceDoc[]` from Notion (`loadFromNotion()`) or `data/brand/*.md` (`loadFromLocal()`), embeds it into a single vector store, and exposes one accessor: `lookupBrandStyle(query)`. There is exactly one brand, and changing it means editing files in the repo and redeploying.

That is the binding constraint on the sales motion. The demo that closes is "give me your website URL" → sixty seconds later → "here is a post in your voice, and here is the style guide it followed." Today that requires a developer, a text editor and a deploy.

Two properties of the existing system make this cheaper than it looks:

- **`SourceDoc = { source, content }` is a single, narrow seam.** Every corpus loader funnels through it. A new source is a new loader, not a new retrieval path.
- **`src/activity.ts` (added in `3a8cf89`) is a leaf sink registry** keyed by thread id. Any long-running work can call `reportActivity()` and have it stream to the dashboard. Crawl progress needs no new plumbing.

## 2. Goals and non-goals

**In scope**

- Prisma + libSQL replacing hand-written SQL in `src/db.ts`, with real migrations
- `Brand`, `BrandSource`, `BrandDocument` models; `Draft` gains a brand FK
- Per-brand vector collections; `lookupBrandStyle(query, brandId)`
- A second LangGraph graph for ingestion: fetch → distil → human review → index
- Source fetchers: website crawl, RSS/Atom, pasted posts, and paid social behind an optional token
- Brand screens in the dashboard; a brand selector on `/run`; brand attribution on drafts
- Per-brand corpus language detection, feeding the `{{language}}` prompt placeholder introduced by the prerequisite in §0

**Explicitly out of scope**

- User accounts, roles, or tenant isolation — brands are a content concept, not a security boundary. Anyone past `DEMO_PASSWORD` sees every brand.
- Per-brand prompt variants in Langfuse. All brands share the three managed prompts; the brand enters through retrieval and the language variable.
- Scheduled or automatic re-crawling. Re-ingestion is a button.
- Logo, colour or image extraction. Text only.
- Editing drafts in the UI. Unchanged.
- **Deriving the Editor's verdict in code from its three scores.** A separate live defect: on 2026-08-02 a run scored 0.95 / 0.90 / 0.90 — all above the prompt's own "APPROVED if ALL three ≥ 0.8, no exceptions" threshold — and returned `REVISION_NEEDED` anyway. It is why every draft in the library is red. Tracked separately; this design does not fix it, and §10 does not depend on it being fixed.
- Moving run state out of memory, or a persistent checkpointer. Still one machine (see `2026-08-01-nextjs-dashboard-design.md` §7).

## 3. Decisions taken during design

| Question | Decision | Reasoning |
|---|---|---|
| Where does ingestion live? | A Brand screen in the dashboard | The demo moment requires it to happen on the call, not in a terminal |
| One brand or many? | A library, selectable per run | Ingesting a prospect's brand must not destroy EONYX's own |
| Sources for v1 | Website, RSS, paste, and paid social | All four requested; social degrades to unavailable without a token |
| Ingestion engine | A second LangGraph graph | Inherits `interrupt()`, Langfuse tracing, `CostTracker` and the SSE pattern |
| SQLite driver | `@prisma/adapter-libsql` (class `PrismaLibSql`) | Official, no native module, and later swaps to hosted Turso. Verified on 7.9.1 under Bun |
| Language mismatch | Fixed separately and first, as §0 | The current demo is broken today; it should not wait for phase 2 |
| Deployment of phase 1 | Held until phase 2 is ready | One deploy rather than two on a machine that goes down on every deploy |
| Review gate | Mandatory, no skip path | It is the governance claim the product is sold on |
| Brief vs corpus conflict | Brief wins on the fields it names; surfaced at plan approval (§10) | Observed live; ingested brands will assert channel rules nobody has read |

Those four source kinds are final for this design. §8 defines the `SourceFetcher` interface, so a fifth kind — document upload, Notion promoted back to a live source, competitor-contrast crawling — plugs in later without reopening this spec.

## 4. Architecture

The insight that keeps this small: **the distilled output has the same shape as the hand-written corpus.** Today `data/brand/` holds a brand overview, a style guide, and exemplar posts. The distiller emits exactly that triple. Therefore the strategist prompt, the editor prompt, the chunking strategy and the retrieval call all stay as they are — ingestion is a third way to *produce* a corpus, not a new way to *consume* one.

```
                    ┌──────────── ingestion graph ────────────┐
POST /brands ──▶ fetcher ──▶ distiller ──▶ review ──▶ indexer ──▶ Brand(active)
                    │            ▲           │                        │
              raw pages/posts    └── revise ─┘                        │
                    │                  interrupt()                    ▼
                    ▼                                        vector collection
              BrandDocument(raw_page, included=false)          (per brand)
                                                                      │
POST /runs {brand_id} ──▶ content graph ── lookupBrandStyle(q, brandId)┘
```

Both graphs are driven by the same `runManager`, share one `runs` map and one SSE endpoint, and are told apart by a `kind` discriminator on the run record.

## 5. Data model

`DATABASE_URL` (a `file:` libSQL URL) replaces `DRAFTS_DB_PATH`.

Prisma 7 removed `url` from the `datasource` block: migration commands read it from `prisma.config.ts`, and the client receives an adapter instance instead. Verified against 7.9.1.

```ts
// prisma.config.ts
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"
}

model Brand {
  id             String   @id @default(uuid())
  name           String
  slug           String   @unique
  status         String   @default("draft")   // draft | active | archived
  isDefault      Boolean  @default(false)     @map("is_default")
  language       String   @default("en")      // BCP-47, detected during distillation
  collectionName String   @unique             @map("collection_name")
  corpusHash     String?                      @map("corpus_hash")
  createdAt      DateTime @default(now())     @map("created_at")
  updatedAt      DateTime @updatedAt          @map("updated_at")

  sources   BrandSource[]
  documents BrandDocument[]
  drafts    Draft[]

  @@map("brands")
}

model BrandSource {
  id        String   @id @default(uuid())
  brandId   String   @map("brand_id")
  kind      String   // website | rss | paste | social
  locator   String   // root URL, feed URL, "pasted", or profile URL
  network   String?  // linkedin | instagram | x | threads — social only
  pageCount Int      @default(0) @map("page_count")
  fetchedAt DateTime @default(now()) @map("fetched_at")

  brand     Brand           @relation(fields: [brandId], references: [id], onDelete: Cascade)
  documents BrandDocument[]

  @@index([brandId])
  @@map("brand_sources")
}

model BrandDocument {
  id        String   @id @default(uuid())
  brandId   String   @map("brand_id")
  sourceId  String?  @map("source_id")
  kind      String   // profile | style_guide | exemplar | raw_page
  title     String
  content   String
  included  Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")

  brand  Brand        @relation(fields: [brandId], references: [id], onDelete: Cascade)
  source BrandSource? @relation(fields: [sourceId], references: [id], onDelete: SetNull)

  @@index([brandId, kind])
  @@map("brand_documents")
}

model Draft {
  id             String   @id                              // still the thread_id
  brandId        String?  @map("brand_id")
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

  brand Brand? @relation(fields: [brandId], references: [id], onDelete: SetNull)

  @@index([brandId])
  @@map("drafts")
}
```

Four decisions embedded above:

**`corpusHash` moves out of Chroma's collection metadata into the `Brand` row.** It currently lives in Chroma metadata (`rag.ts:100-105`), which the `memory` backend cannot read — so production, which runs `VECTOR_STORE=memory`, re-embeds the entire corpus on every container start. Storing it in SQLite makes both backends behave identically and removes that cost.

**`raw_page` documents are stored with `included = false`.** Scraped pages are retained for provenance — "which page produced this rule" — but only `profile`, `style_guide` and `exemplar` documents are embedded. This is the mechanism that stops nav, footer and cookie-banner text from degrading retrieval.

**`Draft.brandId` is nullable with `onDelete: SetNull`.** The four existing rows genuinely were written against the EONYX corpus, so the migration backfills them. Nullable so that deleting a prospect's brand after a demo does not cascade away the drafts generated for them.

**Every column carries `@map` to its existing snake_case name** so the models describe the live tables rather than renaming them. This is *not* quite a no-op, though — a spike against a copy of the production database found one genuine divergence: the hand-written table declares `created_at TEXT NOT NULL DEFAULT (datetime('now'))` where Prisma models `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`. §13 handles it; the important consequence is that `prisma migrate dev` must never be run against a database holding real data, because it reads that divergence as drift and offers to reset. Prisma returns camelCase to TypeScript, so `src/db.ts` keeps a thin serializer emitting the current snake_case DTO — `web/lib/types.ts` and every screen stay untouched until §12 changes them deliberately.

## 6. Persistence layer

`src/db.ts` keeps its exported function signatures (`listDrafts`, `getDraft`, `insertDraft`, `setDraftCost`, `setDraftNotionUrl`, `getStats`) and swaps its body for Prisma calls, plus a `toDraftRow()` serializer preserving the wire shape. A new `src/brands.ts` holds brand/source/document repository functions. `getStats()` gains an optional `brandId` filter, unused in phase 1.

`resetDbForTests()` disappears; tests get a fresh database per suite via `DATABASE_URL`. A spike confirmed the libSQL adapter accepts `:memory:` and `file::memory:` as well as file paths, so `test:judge`'s existing in-memory database survives the migration unchanged — the schema simply has to be created explicitly, since migrations cannot have been applied to a database that starts empty.

## 7. Vector store: per-brand collections

`lookupBrandStyle(query: string, brandId: string)` gains a required second parameter. Both backends key on the brand:

- **Chroma** — one collection per brand, named `Brand.collectionName` (`brand_<slug>`)
- **Memory** — `Map<brandId, MemoryVectorStore>`, built lazily and cached per process

The corpus for a brand is now `BrandDocument where included = true`, read from SQLite. `loadFromNotion()` and `loadFromLocal()` stop being runtime loaders and become **seed-time importers** (§13) that create a Brand and its documents. This unifies three code paths into one and removes the startup `npx` hazard that `NOTION_BRAND_PAGE_ID` currently carries in production.

Two call sites change:

- **`editor.ts`** calls `lookupBrandStyle(query, state.brief.brand_id)` directly — a one-line change.
- **`brandStyleRetriever`** is a module-scope `tool()` bound into `createAgent` at `strategist.ts:32`, so it cannot see the brand. It becomes a factory, `makeBrandStyleRetriever(brandId)`, called inside the strategist node where `state.brief` is in scope. `src/tools/index.ts` re-exports the factory instead of the singleton.

## 8. Source fetchers

```ts
type RawDoc = { url: string; title: string; text: string; kind: 'page' | 'post' };

interface SourceFetcher {
  kind: 'website' | 'rss' | 'paste' | 'social';
  available(): boolean;                       // false when a required token is unset
  fetch(spec: SourceSpec, threadId: string): Promise<RawDoc[]>;
}
```

Each fetcher calls `reportActivity(threadId, { step: 'fetcher', kind: 'page_fetched', detail: '12/25 …' })`, so the crawl streams to the dashboard with no new plumbing.

**Website.** Fetch and honour `robots.txt`. Prefer `sitemap.xml` (following sitemap-index files); fall back to breadth-first traversal of same-origin links from the root. HTML→text uses **Bun's built-in `HTMLRewriter`** — streaming, zero dependencies, and consistent with the project's no-native-modules rule — dropping `script`, `style`, `nav`, `footer`, `header`, `aside`, and preferring `main`/`article` when present. Caps: `INGEST_MAX_PAGES` (default 25), 2 MB per response, 10 s per request, concurrency 4, `text/html` only. URLs normalised (drop fragment, trailing slash, common tracking params) and deduplicated.

**RSS/Atom.** Auto-discovered from `<link rel="alternate">` on the root page, or supplied directly. Parses both RSS 2.0 and Atom; takes the 10 most recent entries; strips HTML from `content:encoded`/`summary`. These become the best exemplar candidates — real long-form copy in the brand's own voice.

**Paste.** A textarea on the Brand form, split on lines containing only `---`. Each block becomes a post-kind `RawDoc`. This is the reliable path for LinkedIn, Instagram and X, and on a sales call the prospect can paste their own.

**Social.** Requires `APIFY_TOKEN`; actor ids per network come from env. `available()` returns false without it, the API rejects the source kind with a clear 400, and the UI hides the section — degrading exactly as Notion does today. The operator is responsible for the terms of service of any network they scrape; this is stated in the UI next to the field.

## 9. Distillation

One LLM call with structured output, given the fetched corpus assembled to a hard budget of 60 000 characters — RSS and social posts first (they are the best voice evidence), then site pages in crawl order, truncating at the boundary rather than mid-document:

```ts
BrandProfileSchema  { name, mission, services[], audience_primary,
                      audience_secondary?, positioning,
                      channels: [{ channel, description, word_range, cadence }] }

StyleGuideSchema    { voice[], forbidden_phrases[], preferred_constructions[],
                      formatting_rules[], language }

ExemplarSchema      { exemplars: [{ title, channel, content, why_representative }] }
```

Two rules the prompt enforces:

- **Exemplars are copied verbatim, never paraphrased.** They are evidence, and a paraphrased exemplar would teach the writer the model's voice rather than the brand's.
- **`forbidden_phrases` must be grounded in observed absence or explicit statement**, not invented. An empty list is a valid answer.

`language` is detected from the corpus and stored on `Brand`, then supplied to the `{{language}}` placeholder that §0 added to the three prompts. A run's language therefore comes from the brand it is written for rather than from the brief, and an ingested Ukrainian site produces Ukrainian drafts with no further configuration.

Rendering back to markdown reuses the existing corpus shape: profile → a `brand.md`-shaped document, style guide → a `style_guide.md`-shaped document, each exemplar → its own document. Downstream, nothing can tell the difference between an ingested brand and a hand-written one.

## 10. Brief-versus-corpus precedence

A live run on 2026-08-02 surfaced a conflict the system has no rule for. The brief asked for a 300-word LinkedIn post; `data/brand/brand.md` states LinkedIn posts are 800–1200 words. The Editor noticed and declined to resolve it, emitting an issue the Writer cannot act on:

> «LinkedIn-стильовий гайд вказує діапазон 800–1200 слів, тоді як затверджений контент-план окремо встановлює ціль у 300 слів. Якщо застосовується правило канального гайда, текст потребує розширення; якщо пріоритет має план, поточна довжина відповідає вимозі.»

This matters more after ingestion than before it. A hand-written corpus is authored alongside the people writing briefs, so contradictions are rare and obvious. A corpus distilled from a crawled website will assert channel rules nobody on the call has read, and every brief will risk contradicting one.

**The rule: the brief governs the dimensions it names; the corpus governs everything else.** `word_count`, `tone`, `target_audience` and `channel` come from the brief because a human typed them for this specific piece. Voice, forbidden phrases, formatting, structure, hashtag caps and CTA conventions come from the corpus, because the brief does not express them.

**Divergence is surfaced, not swallowed.** The Strategist already retrieves the channel's rules before planning, so it is the node positioned to notice. `ContentPlanSchema` gains:

```ts
conflicts: Array<{ dimension: string; brief_value: string; corpus_value: string }>  // default []
```

The `plan_approval` interrupt payload carries `conflicts`, and the approval card renders each as one line — *"Brief: 300 words · Brand guide: 800–1200 words for LinkedIn"*. Approving accepts the brief's values; requesting changes works exactly as it does today. No new interrupt kind, no new resume shape.

**The Editor is then told the answer.** `editorVariables()` passes the resolved targets plus the approved conflict list, and the editor prompt gains one rule: a divergence a human has already approved is not an issue and must not be raised. That converts the observation above from a defect into a decision the reviewer made deliberately.

Rejected alternatives: letting the brief win silently is one prompt line, but it discards a signal that — for an ingested brand — may mean the crawl misread the site's channel rules; letting the corpus win makes the `/run` form lie, since typing 300 would yield 1000 words.

## 11. Ingestion graph and API

```ts
IngestState = {
  brandId, request,           // IngestRequest: name + source specs
  rawDocs, profile, styleGuide, exemplars,
  reviewFeedback,             // set on revise, cleared on approve
}
```

`START → fetcher → distiller → review → indexer → END`, with `review` returning a `Command` to `indexer` on approval or back to `distiller` on revision — the same shape as `hitl.ts`. **The review loop is uncapped**, matching the plan-approval gate: the human controls it. Only the writer↔editor loop has an iteration cap.

`review` interrupts with `{ kind: 'brand_approval', profile, styleGuide, exemplars, sources }`. Resume accepts:

```ts
{ approved: true, edits?: { profile?, styleGuide?, exemplars? } }
| { approved: false, feedback: string }
```

`edits` lets a reviewer correct the distilled guide in place rather than only accepting or rejecting it — the common case is "right, but drop that third forbidden phrase."

**`runManager` generalises** from one hard-wired `graph` import to a runner spec:

```ts
type RunnerSpec = {
  graph: CompiledStateGraph;
  kind: 'content' | 'ingest';
  summarize: (node: string, value: unknown) => unknown;
  onDone?: (threadId: string, tracker: CostTracker) => Promise<void>;
};
```

One `runs` map, one `emit`/`subscribe`, one SSE endpoint serving both kinds; `RunRecord` gains `kind` so the client knows which UI to render. `onDone` carries what is currently the inline `setDraftCost` call for content runs, and marks the brand active for ingest runs.

New endpoints, all added to the `requireAuth` loop at `server.ts:59` — as **both** `/brands` and `/brands/*`, since Hono matches them separately:

| Endpoint | Purpose | Phase |
|---|---|---|
| `GET /brands` | List brands with source/document/draft counts | 1 |
| `GET /brands/:id` | One brand with its sources and distilled documents | 1 |
| `PATCH /brands/:id` | Rename; set as default | 1 |
| `POST /brands` | Create a brand and start an ingest run → `{ brand_id, thread_id }` | 2 |
| `DELETE /brands/:id` | Cascade sources and documents; null out draft FKs | 2 |
| `POST /brands/:id/reingest` | New ingest run over the stored source locators | 2 |

The two read endpoints and `PATCH` land in phase 1 because the `/run` brand selector depends on them; the rest arrive with ingestion.

`BriefSchema` gains `brand_id: z.string()`. `POST /runs` rejects an unknown or non-active brand with a 400.

## 12. UI

| Route | Contents |
|---|---|
| `/brands` | Table: name, status, sources, documents, drafts, default marker. "New brand" button. |
| `/brands/new` | Form (name, website URL, optional RSS, optional pasted posts, optional social) → live activity feed → editable review card → redirect on completion |
| `/brands/[id]` | Rendered profile and style guide, exemplar list, sources with fetch times, provenance list of raw pages, re-ingest button |
| `/run` | Gains a brand `<select>`, defaulting to the default brand |
| `/drafts`, `/drafts/[id]` | Gain a brand column and badge |

`/brands/new` reuses `/run`'s `EventSource` handling, `PipelineProgress` (with ingest step names) and the activity list wholesale. The review card is a `PlanApproval` sibling with editable textareas.

Nav gains a "Brands" link. `web/lib/types.ts` needs `Brand`, `BrandSource`, `BrandDocument` and the extended `RunEvent` added by hand — there is no shared type across the Hono/Next boundary.

## 13. Migration

**`prisma migrate dev` must never run against a database holding real data.** A spike against a copy of the production database confirmed it reads the `created_at` divergence (§5) as drift and offers to reset — *"All data will be lost."* Migrations are authored with `migrate diff` and applied with `migrate deploy`, which performs no drift detection. The whole sequence below was rehearsed on a copy of the live `app.db`; all five rows survived with their timestamps, verdicts and costs byte-identical.

1. **Baseline.** Model the *existing* `drafts` table with `@map` preserving every column name, then `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` into `prisma/migrations/0_init/migration.sql` and `prisma migrate resolve --applied 0_init`. This records the migration as done without executing it, leaving the live table untouched.
2. **Feature migration.** Extend the schema with `Brand`, `BrandSource`, `BrandDocument` and `Draft.brandId`, then author the SQL from the *actual* database state: `prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script`. Prisma emits a table redefinition with `INSERT INTO new_drafts … SELECT … FROM drafts`, which both preserves every row and resolves the `created_at` divergence as a side effect. Apply with `prisma migrate deploy`.
3. **Seed.** `scripts/seed-brand.ts` imports `data/brand/*.md` (or Notion, if configured) into an EONYX `Brand` with `isDefault = true`, `status = 'active'`, `language = 'uk'`, then backfills `drafts.brand_id` for every existing row.

Note the v7 CLI renames these commands depend on: `--to-schema-datamodel` became `--to-schema`, and `--from-url` became `--from-config-datasource`.

`docker-entrypoint.sh` runs `prisma migrate deploy` before starting the API, and exits non-zero if it fails — consistent with its existing "exit rather than serve half-dead" contract. Take a volume snapshot before the deploy carrying step 2.

**Phase 1 is not deployed on its own.** It is developed and merged, but the migration reaches production only in the deploy that also carries phase 2, so the machine goes down once rather than twice. The cost of that choice is that a migration problem and a new feature arrive together and are harder to attribute — which is why the sequence is rehearsed against a copy of the live database, and why the seeded brand is exercised end to end before the deploy rather than after it.

**Deployment changes.** The Dockerfile gains `prisma generate` in the `api-deps` stage and copies `prisma/` plus the generated client into the runtime stage; the libSQL adapter needs no binary. New environment: `DATABASE_URL` (replacing `DRAFTS_DB_PATH`), and optional `APIFY_TOKEN`, `INGEST_MAX_PAGES`, `INGEST_USER_AGENT`.

## 14. Risks

| Risk | Mitigation |
|---|---|
| A large site makes ingestion slow or expensive | Hard page/byte/time caps; only distilled documents are embedded; the activity feed makes progress visible; the review gate precedes any indexing |
| robots.txt and social terms of service | `robots.txt` honoured for crawling; social is opt-in behind a token with operator responsibility stated in the UI |
| Migrating a live volume | Baseline-then-migrate, rehearsed against a copy of `app.db`; volume snapshot before deploy |
| The distiller invents a style guide | Mandatory human review; exemplars copied verbatim; forbidden phrases must be grounded; raw pages kept for provenance |
| ~~Prisma + Bun + libSQL is a less-travelled combination~~ | **Retired 2026-08-02.** Spiked against 7.9.1: generate, migrate, relations, aggregates, raw SQL, `Date`/boolean mapping and `:memory:` all verified under Bun. The residual risk moved to the migration procedure, above |
| Two graphs sharing one runs map | `kind` discriminator; the client already ignores event nodes outside `NODES` |
| Prompt changes silently overridden | `bun run upload-prompts` is a required step in §0, not an optional follow-up |
| Migration and feature deploy together (§13) | Step 1 proven a zero-change no-op locally; the seeded brand exercised end to end before deploying, not after |

## 15. Testing

**Unit** (`tests/unit/`, no network, CI-gated): URL normalisation and dedup; same-origin filtering; sitemap and sitemap-index parsing; RSS and Atom parsing; `HTMLRewriter` extraction against fixture HTML asserting nav/footer/script removal; `robots.txt` parsing; paste splitting; per-brand corpus hashing; brand repository CRUD against a temp libSQL file; and a migration test asserting the baseline applies cleanly to a copy of the current `app.db` with all four rows intact.

**Judge** (`tests/judge/`, manual, costs money): the distiller against a fixture site with planted forbidden phrases and a known language — does it recover them; and a comparative check that a draft written against the correct brand outscores one written against a deliberately mismatched brand.

**Manual**: a full ingest of a real site on the deployed instance, followed by a content run against the resulting brand.

## 16. Success criteria

- Paste a URL into `/brands/new` and, within roughly two minutes, hold a reviewed and edited style guide with the brand active.
- Run `/run` against that brand and see the editor cite the brand's own rules in its issues.
- Switch brands between runs; every draft is attributed to the brand it was written for.
- The four existing drafts survive migration, attributed to EONYX.
- An ingested Ukrainian site produces Ukrainian drafts.
- `bun run test:unit`, `bunx biome ci .`, and `cd web && bun run build` all pass.

## 17. Implementation phases

Each phase is a separate implementation plan with a checkpoint between. Phases 1 and 2 are developed separately but **released in a single deploy** (§13); phase 0 ships on its own, immediately.

**Phase 0 — Prompt fixes.** Two content-pipeline changes that need neither Prisma nor ingestion, so they deploy on their own and immediately: the `{{language}}` placeholder in the three prompts driven from the brief (§0), and brief-versus-corpus precedence (§10) — the `conflicts` field on `ContentPlanSchema`, the line on the approval card, and the editor rule that an approved divergence is not an issue. Both require `bun run upload-prompts`. *Ships: brand grounding that functions, and an Editor that stops raising conflicts nobody can act on.*

**Phase 1 — Persistence foundation.** Spike Prisma+Bun+libSQL. Baseline and feature migrations. `src/db.ts` on Prisma behind the existing DTO. `src/brands.ts`. Seed script. Per-brand collections and `lookupBrandStyle(query, brandId)`. The three read/update brand endpoints. `brand_id` on the brief, a selector on `/run`, brand attribution on drafts. *Merged, not deployed. No LLM work.*

**Phase 2 — Ingestion graph and Brand screens.** Fetcher interface with website, RSS and paste. Distiller with the three schemas and per-brand language detection. Review gate. Indexer. `runManager` generalisation. `/brands` endpoints and screens. *Ships, together with phase 1: the demo moment.*

**Phase 3 — Social sources.** Apify-backed fetcher behind `APIFY_TOKEN`, per-network actors, graceful unavailability. *Ships: LinkedIn/Instagram/X exemplars.*
