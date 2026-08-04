# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
- `bun install` — install dependencies (root); `cd web && bun install` for the dashboard
- Chroma must be running for the default RAG path: `docker run -d -p 8000:8000 --name chroma chromadb/chroma` (or `docker start chroma`). Alternatively set `VECTOR_STORE=memory` and skip Chroma entirely.

### Development
- `bun run dev` — CLI in watch mode. **Requires all five flags**; running it bare exits 1 with a usage error, which is expected, not a bug.
- `bun run start -- --topic "..." --channel blog --tone professional --audience "SMB owners" --word-count 1200` — CLI, one-shot run
- `bun run serve` — Hono API only at `http://localhost:3000` (`src/server.ts`); it no longer serves any UI
- `bun run web` — Next.js dashboard at `http://localhost:3001`
- `bun run dev:all` — both of the above together (what you usually want)
- `bun run studio` — LangGraph Studio at `http://localhost:8123`

### Quality gates
- `bun run typecheck` — `tsc --noEmit`
- `bun run check` — `biome check --write` (formats, lints, organizes imports); run before committing
- `bun run lint` / `bun run format` — narrower subsets of `check`
- `bunx biome ci .` — read-only, CI-equivalent check (what `.github/workflows/ci.yml` runs)

### Tests
- `bun run test:unit` — fast, free, deterministic tests in `tests/unit/`, no LLM/network calls; CI also runs this
- Single file: `bun test tests/unit/<file>.test.ts`
- Single case: `bun test tests/unit/<file>.test.ts -t "<test name>"`
- `cd web && bun test` — dashboard component and helper tests in `web/tests/`, no LLM/network calls; CI also runs this as a dedicated step, since `web/` has its own `node_modules` (`react-markdown` isn't resolvable from root) and a separate test run
- `bun run test:judge` — LLM-as-a-judge tests in `tests/judge/`; makes real OpenAI calls, costs money (~$0.05–0.20/run), **not** run in CI. Override the judge model: `TEST_MODEL=gpt-4o bun run test:judge`

### Data / prompt maintenance
- `bun run seed-brand` — import data/brand/*.md into the default EONYX brand (idempotent; run once after migrating)
- `bun run reindex [brand-id-or-slug]` — force-rebuild one brand's collection (default brand if omitted)
- `bun run prisma:deploy` / `prisma:status` — apply or inspect migrations
- `bun run upload-prompts` — push `src/prompts/*` fallback text to Langfuse Prompt Management
- `bun run upload-brand` — push the local brand corpus to a Notion parent page

## Architecture

### The pipeline is a LangGraph StateGraph, not a linear chain
`src/graphBuilder.ts` wires `START → strategist → hitl → writer ⇄ editor (loop) → finalizer → END` and `src/graph.ts` compiles it with the checkpointer (see the Mermaid diagram in `README.md`). The split exists so the topology can be asserted without a checkpointer — and because `tests/unit/runManagerActivity` replaces `src/graph` with `mock.module`, which bun applies process-wide, so a test importing `src/graph` to check the node list silently gets the mock: green alone, red in the full suite. Two patterns compose here: prompt chaining (Strategist → HITL → Writer) and an evaluator-optimizer loop (Writer ↔ Editor), capped by `MAX_ITERATIONS` in `src/constants.ts` (default 5). Routing decisions live as pure functions in `src/routing/`.

State shape (`src/state.ts`) is the contract every node reads/writes: `brief`, `plan`, `draft`, `editFeedback`, `iteration`, `planApproved`, `userPlanFeedback`, `finalContent`, `notionUrl`. Node functions in `src/nodes/` take `(state, config?)` and return `Partial<GraphStateType>`; they throw on missing upstream state (e.g. `writer` throws if `!state.plan`, `editor` throws if `!state.brief`) rather than silently falling back.

`hitl.ts` is the human-approval gate — it calls LangGraph's `interrupt()` and returns a `Command` routing to `writer` (approved) or back to `strategist` (revision, carrying feedback). There is no iteration cap on the HITL loop, only on writer↔editor.

### Every node's LLM call must forward the parent `RunnableConfig`
`strategist.ts`, `writer.ts`, and `editor.ts` each build a `runName`/`tags`/`traceOptions(...)` object for their inner `.invoke()` call. This **must** be merged with the node's own `config` parameter via `mergeConfigs(config, {...})` (from `@langchain/core/runnables`) — passing a bare object instead silently drops any callback attached at the top-level `graph.stream()` call. Langfuse tracing still works either way (`traceOptions()` sets its own callbacks explicitly), but anything attached externally — like the `CostTracker` in `src/runManager.ts`/`src/cli.ts` — does not propagate without this merge. This was a real bug (token/cost tracking silently reported `$0` for every run) found only by running the pipeline live with real API keys, not by unit tests. If you add a node with its own LLM call, follow the same `mergeConfigs` pattern.

### Two independent drivers of the same graph
`src/cli.ts` drives the graph interactively (blocking `readline` prompt for HITL) for one run at a time. `src/runManager.ts` drives it for the HTTP server (`src/server.ts`): fire-and-forget `startRun()`/`resumeRun()`, an in-memory `Map<threadId, RunRecord>`, and an `emit()`/`subscribe()` pub-sub so an SSE endpoint can stream progress. Both paths attach a `CostTracker` to `config.callbacks` and both reset the per-thread search-rate-limit counter (`src/tools/search.ts`) when a run finishes — if you change one path's behavior (budget cap, cost write-back, search cleanup), check whether the other needs the matching change.

SSE events (`RunEvent = {node, data, ts, seq}`) are deduped client-side (`web/app/(dashboard)/run/page.tsx`) using `seq`, a monotonic per-run counter — **not** `ts`. `Date.now()` has millisecond resolution and two `emit()` calls with no async gap between them can share a timestamp; deduping on `ts` can silently drop one of them. This is not hypothetical: a live run logged the `strategist` and `hitl` events 5 ms apart. Dedup matters because the client reopens its `EventSource` after every resume, and the server replays the full event history on each connection — without it the just-approved plan card reappears. There's no shared type across the Hono/Next boundary, so a change to `RunEvent`'s shape needs `web/lib/types.ts` updated by hand.

**Fine-grained progress goes through `src/activity.ts`, not `console.log`.** The graph stream only reports a node *finishing*, so a 60-second strategist looked frozen in the dashboard. Tools and nodes call `reportActivity(threadId, {step, kind, detail})`, which logs to stdout **and** forwards to whichever run owns that thread; `runManager.startRun` registers the sink (adding the live `costUsd`/`tokens` from the `CostTracker`) and clears it when the run reaches a terminal state or gets swept. It emits as `node: 'activity'`, deliberately not a member of `NODES`, so it can never mark a pipeline step complete. **Tools must omit `step` and let it be inherited** — `config.metadata.langgraph_node` reads `'tools'` inside `createAgent`'s inner graph, not the owning pipeline node, and `searchTool` serves both the strategist and the writer so no constant is right either. `reportActivity` remembers the last step each thread reported and fills it in; every node reports on entry before invoking its agent, which makes that correct by construction. A live run caught this: every `web_search` arrived as `step: 'tools'`, so the dashboard highlighted nothing during exactly the long research phase the feature exists to show. Two constraints: it must stay a **leaf module** — `runManager → graph → nodes → tools`, so a tool importing `runManager` would close an import cycle — and reporting must never be load-bearing, hence the no-op on an unknown thread and the swallowed sink error. Kinds ending in `_failed` go to `console.error`, which is what keeps a best-effort failure like `web_search_failed` visible on stderr.

**The SSE response must carry `no-transform`, or the browser sees nothing.** Next's proxy gzips proxied responses when the client sends `Accept-Encoding: gzip` — every browser does, `curl` does not — and the gzip encoder buffers, so the browser held an open `EventSource` that delivered **zero** events until the run ended and the buffer flushed. That made short failing runs look fine and long healthy runs look frozen, which is exactly backwards. `GET /runs/:id/events` therefore overrides Hono's header with `Cache-Control: no-cache, no-transform` on the returned `Response`. Diagnose it **in the browser**, never with `curl`: `fetch(url)` then read `headers.get('content-encoding')` and pull chunks off `body.getReader()` with timings. `ENABLE_SSE_DEBUG=true`'s `/debug/sse-ping` is a working reproducer and is deliberately left without the header — measured from the page it returns all five frames as **one** chunk when the stream ends (`+2511ms bytes=170`), versus one chunk per frame once `no-transform` is set. Watching the `ts` values inside the frames will fool you, since those are stamped server-side and look correctly spaced either way.

**An SSE stream that goes quiet gets killed.** `Bun.serve` closes any connection idle for `idleTimeout` seconds and its default is **10** — far shorter than a single graph node (the strategist does a brand lookup plus up to 10 web searches before it emits anything), and shorter still than a plan sitting at the HITL gate. The stream was dying mid-run and Next's rewrite proxy logged it as `Failed to proxy … socket hang up` / `ECONNRESET`. Two guards in `src/server.ts` keep it up, and both matter: `pumpKeepalive()` writes a `: keepalive` comment frame every `SSE_KEEPALIVE_MS` (5s) so the socket is never idle, and the default export sets `idleTimeout: SERVER_IDLE_TIMEOUT_S` (Bun caps this at 255). The frame is an SSE **comment** — `EventSource` discards `:` lines, so it never reaches `onmessage` and can't be mistaken for a `RunEvent`. Any new long-lived stream needs the same treatment; don't lower the cadence to at or above the idle timeout.

### Prompts have two sources, resolved per call
`src/prompts/managed.ts`'s `compileManagedPrompt()` tries Langfuse Prompt Management first (label from `LANGFUSE_PROMPT_LABEL`, default `"production"`), falling back to the hardcoded `MANAGED_PROMPTS[key].fallback` templates in the same file if Langfuse is unset or unreachable. `src/prompts/{strategist,writer,editor}.ts` only export the `*_SYSTEM` string constants now (the old template-building functions were dead code, removed) — those constants feed `managed.ts`'s fallback templates. Editing prompt behavior means editing the fallback text in `managed.ts`/the `*_SYSTEM` constants, then running `bun run upload-prompts` if Langfuse is configured — otherwise the deployed Langfuse-managed prompt silently wins over a local edit.

**Two cross-cutting rules live inside those prompts.** All three carry a `{{language}}` placeholder fed from `Brief.language` (default `uk`, matching the shipped Ukrainian corpus in `data/brand/`) — before this existed, nothing named an output language and runs stayed coherent only because the model inferred one from the topic. And the brief's `topic`, `channel`, `tone`, `target_audience` and `word_count` override any contradicting brand-corpus rule: the Strategist records each divergence in `ContentPlan.conflicts`, the approval card renders it, and the Editor is forbidden to raise anything listed there. This exists because `brand.md` claims LinkedIn posts are 800–1200 words, so any shorter brief made the Editor emit an issue asking which rule applied — one the Writer could not act on. Note that `*_SYSTEM` constants are backtick-delimited template literals: a backtick in prompt text terminates the string.

### RAG brand corpus, dual-sourced
`src/tools/rag.ts` builds a Chroma vector store from either Notion (if `NOTION_TOKEN` + `NOTION_BRAND_PAGE_ID` are set) or `data/brand/*.md` (fallback). The collection is content-hashed (`corpus_hash` in the Chroma collection's metadata) so it only rebuilds when the source content actually changes; `bun run reindex` forces a rebuild. `lookupBrandStyle()` is a plain async function used both by the Strategist's `brandStyleRetriever` tool (agentic call) and directly by the Editor node (no tool-calling agent there — it just retrieves style-guide excerpts once per invocation to judge tone against).

### Persistence is Prisma + libSQL, and the migration rules are load-bearing

`src/db.ts` runs on Prisma with `@prisma/adapter-libsql`; `DATABASE_URL` (a `file:` URL) replaced `DRAFTS_DB_PATH`. Its exported functions are all **async** and deliberately keep the old **snake_case** wire shape — `toDraftRow()` is the single place Prisma's camelCase and `Date` objects meet the API, because `web/lib/types.ts` mirrors those key names by hand.

Three things were learned the hard way and must not be re-derived:

- **Never run `prisma migrate dev` against a database with real data.** The pre-Prisma table declares `created_at TEXT DEFAULT (datetime('now'))` where Prisma models `DATETIME DEFAULT CURRENT_TIMESTAMP`; `migrate dev` reads that as drift and offers to reset — *"All data will be lost."* Author migrations with `prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script`, then apply with `prisma migrate deploy`, which performs no drift detection. Rehearse against a copy of `data/app.db` first, and check the emitted SQL contains `INSERT INTO "new_drafts" … SELECT` before applying.
- **`setDraftCost`/`setDraftNotionUrl` use `updateMany`, not `update`.** Prisma's `update` throws P2025 when no row matches, while the hand-written `UPDATE … WHERE id = ?` they replaced was a silent no-op — and `runManager` calls `setDraftCost` after every run, so a missing row would flip a finished run to `error`.
- **Tests use a temp file per suite, never `:memory:`.** libSQL gives each pooled connection its own private in-memory database, so a `CREATE TABLE` on one connection is invisible to the next query on another. It surfaces as an intermittent `no such table: main.drafts` that passes per-file and fails in the full suite. `tests/helpers/db.ts` owns this.

Prisma 7 also removed `url` from the `datasource` block — it lives in `prisma.config.ts` — and the adapter class is `PrismaLibSql`, not `PrismaLibSQL`.

### Brands own the corpus, and every run names one

`BriefSchema.brand_id` is required, and `POST /runs` rejects an unknown or inactive brand. `lookupBrandStyle(query, brandId, threadId?)` reads a brand's corpus from `brand_documents where included = true` — **`data/brand/*.md` and Notion are seed-time importers now** (`bun run seed-brand`), not runtime loaders, which is what removed the startup `npx` hazard `NOTION_BRAND_PAGE_ID` carried in production. `corpus_hash` lives on the `Brand` row rather than in Chroma collection metadata, so the in-process `memory` backend can finally use it instead of re-embedding on every container start.

`brandStyleRetriever` is now `makeBrandStyleRetriever(brandId)`: `createAgent` binds tools at construction, so a module-scope tool cannot see which brand a run is for. Keep `reportActivity` **inside** `lookupBrandStyle` — the Editor calls it directly with no agent in between, so reporting from the tool wrapper would silence half the lookups.

### Brand ingestion is a second LangGraph graph

`src/ingest/graph.ts` compiles `fetcher → distiller → review → indexer`, driven by the same `runManager` as the content graph and told apart by a `kind` discriminator on the run record. The review gate emits as node **`'hitl'`**, exactly like plan approval — the payload's own `kind` (`plan_approval` vs `brand_approval`) is what tells the client which card to render, which is why `/brands/new` reuses `/run`'s SSE handling rather than duplicating it. The review loop is **uncapped**; only writer↔editor has an iteration limit.

The distiller emits the same triple the corpus has always had — profile, style guide, exemplars — rendered by `src/ingest/render.ts` into the shape of `data/brand/brand.md` and `style_guide.md`. That is what lets both prompts, the chunking and retrieval stay untouched: an ingested brand is indistinguishable from a hand-written one downstream.

Three things about extraction that a live crawl of eonyx.net taught, all of which look like details and are not:

- **`HTMLRewriter` does not decode entities.** The site returned `R&amp;D-студія`, and a Ukrainian style guide returns `&laquo;революційний&raquo;` — the guillemet form of a phrase that is literally on the forbidden list. `decodeEntities()` runs on everything before it is stored.
- **Text must be spaced at element boundaries.** Without it, adjacent inline elements concatenate: the same crawl produced `студіяз впровадження` and `данихб'є по грошах`. A glued exemplar is worthless as evidence of how a brand writes.
- **The URL's path scopes the crawl.** `eonyx.net/uk` stays in that section; `eonyx.net` takes everything. Unscoped, the crawl returned `/uk` in Ukrainian *and* `/en` in English plus two privacy policies — a mixed-language corpus that would defeat the `{{language}}` mechanism entirely. Legal and transactional paths are excluded outright.

`raw_page` documents are stored with `included = false`: provenance you can trace a claim back to, never embedded. Re-ingestion replaces a brand's documents rather than appending, so it is idempotent.

**`bun run upload-prompts` was not idempotent until 2026-08-02.** Prompt names contain a slash, `encodeURIComponent` made the lookup 404, and the 404 was caught as "does not exist yet" — so every run created a new version of every prompt regardless of changes. If you see version numbers climbing without edits, that regression is back.

### Drafts persist to the database, not files, by default
`src/db.ts` is the source of truth — `finalizer.ts` always inserts a row keyed by `thread_id`, so re-running the same topic never collides. Writing to `./output/*.md` is opt-in via `WRITE_OUTPUT_FILES=true`.

**Nothing publishes automatically.** The graph ends at `finalizer`; there is no `publisher` node and no `SKIP_PUBLISH` flag. A draft reaches Notion only when someone calls `POST /drafts/:id/publish` (the Publish button), which needs `NOTION_TOKEN` + `NOTION_DRAFTS_DATABASE_ID` and returns `notion_not_configured` without them. The route writes `notion_url` onto the row directly, which is why `notionUrl` is not in `src/state.ts` — publishing happens outside any run, so it was never graph state once the node went. If you add a step that publishes as part of a run, you are undoing a deliberate decision: a run costs money and creates a page, and the two should not be one keystroke.

### Reference docs
`ARCHITECTURE.md` is the authoritative map of how the pieces fit: the two graphs, the dependency rules between `src/` directories, the cross-cutting machinery, and one documented boundary crossing. Read it before adding a node, a fetcher or a vector backend — drift from it is a bug, and it should be regenerated after any structural change.

`docs/superpowers/specs/` and `docs/superpowers/plans/` capture the design rationale behind several non-obvious decisions — check there before re-litigating something that looks like it should obviously be different:

- `2026-07-15-mvp-client-demo-*` — why the checkpointer is still `MemorySaver`, why Notion became optional, the run-cleanup TTL policy
- `2026-08-01-nextjs-dashboard-*` — why Next proxies rather than reading SQLite directly, why Fly.io over Railway (Railway's Hobby plan forbids commercial use), why single-instance is a hard constraint

### Runtime is Bun, not Node
Per `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`: use `bun`/`bun test`/`bun install`/`bunx`, never `node`/`npm`/`yarn`/`pnpm`/`vite`/`jest`. `bun:sqlite` instead of `better-sqlite3`. Biome (not ESLint/Prettier) enforces style — single quotes, 2-space indent, semicolons, organized imports; `bun run check` auto-fixes most of this. `suspicious/noExplicitAny` is downgraded to `warn` in `biome.json`; most other rules (e.g. `style/noNonNullAssertion`) are error-level under the recommended ruleset and do fail `bunx biome ci .` — silence a deliberate one with a `// biome-ignore lint/<rule>: <reason>` comment rather than restructuring working code around it.

### The dashboard lives in `web/` and is frontend-only
`web/` is a separate Next.js 16 app with its own `package.json`, `tsconfig.json` and ESLint config. It is **excluded from root Biome and root `tsc`** (`biome.json` ignores `web`, `tsconfig.json` excludes it) — run `cd web && bun run build` to typecheck it, not `bun run typecheck`.

**Everything backend is namespaced under `/api/*`.** `web/next.config.ts` rewrites `/api/:path*` → `${API_ORIGIN}/:path*`. Do **not** add rewrites for bare `/drafts` or `/runs`: those are page routes, and a rewrite would shadow them so the drafts screens never render. Server Components call `API_ORIGIN` directly via `web/lib/api.ts` (forwarding the auth cookie); client components fetch `/api/...`.

**Next 16 renamed `middleware.ts` to `proxy.ts`.** The file is `web/proxy.ts` and the exported function is `proxy`, not `middleware`. Its runtime is always `nodejs` (edge is unsupported), which is what lets it `fetch` the Hono server. The `matcher` is required, not optional — without it the proxy runs on `_next/static` too and blocks the login page's own CSS. `web/AGENTS.md` warns that this Next version differs from training data; the bundled docs in `web/node_modules/next/dist/docs/` are the source of truth.

**Theming is class-based, not media-query-based.** shadcn's tokens switch on `.dark` and its components use `dark:` variants, so a `prefers-color-scheme` media query would recolour the brand variables while leaving shadcn's `--background` and every `dark:` utility untouched. A blocking inline script in `web/app/layout.tsx` puts `dark` or `light` on `<html>` before first paint, reading `localStorage.theme`; `components/theme-toggle.tsx` writes it. Dark is the default when nothing is stored — see the EONYX section below.

Route groups: `web/app/(dashboard)/` carries the nav shell; `web/app/login/` sits outside it so the login screen renders bare.

### Auth has one implementation, not two
`src/auth.ts` owns everything (HMAC session token, constant-time compare). Hono guards `/runs*`, `/drafts*`, `/stats` and serves `POST /auth/login` + `GET /auth/check`. Next's `proxy.ts` **delegates to `/auth/check`** rather than re-deriving the HMAC — don't duplicate that logic into `web/`, or the two can drift. Unset `DEMO_PASSWORD` makes both sides a no-op, which is the local-dev default.

### Vector store has two backends
`VECTOR_STORE=chroma` (default, local dev) or `memory`. The `memory` path (`src/tools/memoryVectorStore.ts`) embeds the corpus at startup and cosine-ranks in an array — LangChain 1.x ships no in-memory vector store, and the `@langchain/community` alternatives need native modules that fight containerization. Both sit behind the same `lookupBrandStyle(query)` signature, so callers never change.

**Do not set `NOTION_BRAND_PAGE_ID` in production.** `loadFromNotion()` spawns `npx -y @notionhq/notion-mcp-server`, which took minutes on a cold cache; with local brand files the same lookup takes ~1s. The corpus is baked into the container image, so production should use files and reserve Notion for publishing (`NOTION_DRAFTS_DATABASE_ID`).

### Deployment is one container, and two Fly settings are load-bearing
`Dockerfile` builds Next and the API into a single image on a `node:22-slim` base with Bun installed on top — Node is there because the Notion MCP client shells out to `npx`. `docker-entrypoint.sh` runs both processes and **exits if either dies**, so the platform restarts rather than leaving a half-dead container answering HTTP.

In `fly.toml`, `auto_stop_machines` must stay off and there must be exactly one machine (`fly scale count 1`). These are correctness requirements, not tuning: run state is an in-memory `Map` and a run pauses mid-flight for human approval, so a stopped machine loses in-flight runs and a second machine would let a client approve a plan on a process that never heard of their run. Verify by observation (`fly status` after idling), not by reading the config back.

**Pushing to `main` deploys.** `.github/workflows/fly-deploy.yml` runs `flyctl deploy --remote-only` on every push to `main`/`master`, using the `FLY_API_TOKEN` repo secret. Two consequences worth knowing: it does **not** gate on `ci.yml`, so a red build still deploys; and because there is one machine bound to one volume, each deploy briefly takes the app down — don't push to `main` during a client demo.

**Renaming the brand touches three places that don't rebuild themselves.** `src/prompts/*.ts` feed Langfuse-managed prompts, so a local edit is silently overridden until `bun run upload-prompts` runs. `data/brand/*.md` is the RAG corpus — content-hashed, so Chroma rebuilds on next use locally (`bun run reindex` forces it), and the in-process store rebuilds at container start. The judge tests in `tests/judge/` carry the brand name in their `JUDGE_SYSTEM` strings too.

### The visual identity is EONYX, pulled from claude.ai/design
`web/app/globals.css` carries the EONYX Design System tokens (project `86b4adf4-9f78-46e9-9d4d-3eae41694ead`, type `PROJECT_TYPE_DESIGN_SYSTEM`). They were imported with the `DesignSync` tool's **read** methods — `get_project` → `list_files` → `get_file` on `tokens/*.css` — not by hand. Re-read those files to refresh the tokens; don't invent brand values.

The system is **dark-first** (`--bg: #0B0B14`), with brand indigo `#201848`, electric cyan `#08C0E8` and signal red `#E80828`. It is also **angular, editorial and flat**: the brand explicitly rejects glow/gloss, radii are 2–10px (`--radius: 6px`), and pills are reserved for tags and status (verdict badges only).

**Both registers exist.** `:root` carries the dark values; `html.light` carries the light ones, ported from the DS's own `.eonyx-on-light` scope in `tokens/base.css`. Dark remains the default when nothing is stored, because the brand book puts the identity on near-black indigo. Two things differ beyond a straight inversion, and both are deliberate: the status colours are **darkened** in the light register (the dark-register green `#2BD49B` and amber `#F5B544` fail contrast on white), and shadows go from black-on-black to a soft indigo tint.

The `Logo` (`web/components/logo.tsx`) is ported verbatim from the DS's `components/core/Logo.jsx` — inline SVG paths, no asset dependency. It defaults to `tone="currentColor"`, which is why the wordmark inverts with the theme for free; don't hard-code a tone in the nav.

Two collisions to know about when touching tokens:

- **`--brand` must stay defined.** `spend-chart.tsx` and `channel-chart.tsx` pass `var(--brand)` straight into SVG `fill`/`stroke` attributes. An undefined CSS variable makes SVG fall back to **black**, which is invisible on the dark canvas and passes every build and typecheck. This already happened once during the import.
- **`--accent` means different things in the two systems.** EONYX names it the cyan interactive colour; shadcn uses it for hover surfaces and its components depend on that. The cyan lives on `--brand`; `--accent` stays shadcn's.

Type treatment: Montserrat (display/UI) + JetBrains Mono (technical). The brand voice is wide-tracked uppercase mono for labels — `.eonyx-label` / `.eonyx-kicker` in `globals.css`, used on stat tiles, table headers, nav links and pipeline steps. `.eonyx-slash` is the persistent red corner chevron.
