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
- `bun run test:unit` — fast, free, deterministic tests in `tests/unit/`, no LLM/network calls; this is what CI runs
- Single file: `bun test tests/unit/<file>.test.ts`
- Single case: `bun test tests/unit/<file>.test.ts -t "<test name>"`
- `bun run test:judge` — LLM-as-a-judge tests in `tests/judge/`; makes real OpenAI calls, costs money (~$0.05–0.20/run), **not** run in CI. Override the judge model: `TEST_MODEL=gpt-4o bun run test:judge`

### Data / prompt maintenance
- `bun run reindex` — force-rebuild the Chroma brand-corpus collection
- `bun run upload-prompts` — push `src/prompts/*` fallback text to Langfuse Prompt Management
- `bun run upload-brand` — push the local brand corpus to a Notion parent page

## Architecture

### The pipeline is a LangGraph StateGraph, not a linear chain
`src/graph.ts` compiles: `START → strategist → hitl → writer ⇄ editor (loop) → finalizer → publisher → END` (see the Mermaid diagram in `README.md`). Two patterns compose here: prompt chaining (Strategist → HITL → Writer) and an evaluator-optimizer loop (Writer ↔ Editor), capped by `MAX_ITERATIONS` in `src/constants.ts` (default 5). Routing decisions live as pure functions in `src/routing/`.

State shape (`src/state.ts`) is the contract every node reads/writes: `brief`, `plan`, `draft`, `editFeedback`, `iteration`, `planApproved`, `userPlanFeedback`, `finalContent`, `notionUrl`. Node functions in `src/nodes/` take `(state, config?)` and return `Partial<GraphStateType>`; they throw on missing upstream state (e.g. `writer` throws if `!state.plan`, `editor` throws if `!state.brief`) rather than silently falling back.

`hitl.ts` is the human-approval gate — it calls LangGraph's `interrupt()` and returns a `Command` routing to `writer` (approved) or back to `strategist` (revision, carrying feedback). There is no iteration cap on the HITL loop, only on writer↔editor.

### Every node's LLM call must forward the parent `RunnableConfig`
`strategist.ts`, `writer.ts`, and `editor.ts` each build a `runName`/`tags`/`traceOptions(...)` object for their inner `.invoke()` call. This **must** be merged with the node's own `config` parameter via `mergeConfigs(config, {...})` (from `@langchain/core/runnables`) — passing a bare object instead silently drops any callback attached at the top-level `graph.stream()` call. Langfuse tracing still works either way (`traceOptions()` sets its own callbacks explicitly), but anything attached externally — like the `CostTracker` in `src/runManager.ts`/`src/cli.ts` — does not propagate without this merge. This was a real bug (token/cost tracking silently reported `$0` for every run) found only by running the pipeline live with real API keys, not by unit tests. If you add a node with its own LLM call, follow the same `mergeConfigs` pattern.

### Two independent drivers of the same graph
`src/cli.ts` drives the graph interactively (blocking `readline` prompt for HITL) for one run at a time. `src/runManager.ts` drives it for the HTTP server (`src/server.ts`): fire-and-forget `startRun()`/`resumeRun()`, an in-memory `Map<threadId, RunRecord>`, and an `emit()`/`subscribe()` pub-sub so an SSE endpoint can stream progress. Both paths attach a `CostTracker` to `config.callbacks` and both reset the per-thread search-rate-limit counter (`src/tools/search.ts`) when a run finishes — if you change one path's behavior (budget cap, cost write-back, search cleanup), check whether the other needs the matching change.

SSE events (`RunEvent = {node, data, ts, seq}`) are deduped client-side (`web/app/(dashboard)/run/page.tsx`) using `seq`, a monotonic per-run counter — **not** `ts`. `Date.now()` has millisecond resolution and two `emit()` calls with no async gap between them can share a timestamp; deduping on `ts` can silently drop one of them. This is not hypothetical: a live run logged the `strategist` and `hitl` events 5 ms apart. Dedup matters because the client reopens its `EventSource` after every resume, and the server replays the full event history on each connection — without it the just-approved plan card reappears. There's no shared type across the Hono/Next boundary, so a change to `RunEvent`'s shape needs `web/lib/types.ts` updated by hand.

### Prompts have two sources, resolved per call
`src/prompts/managed.ts`'s `compileManagedPrompt()` tries Langfuse Prompt Management first (label from `LANGFUSE_PROMPT_LABEL`, default `"production"`), falling back to the hardcoded `MANAGED_PROMPTS[key].fallback` templates in the same file if Langfuse is unset or unreachable. `src/prompts/{strategist,writer,editor}.ts` only export the `*_SYSTEM` string constants now (the old template-building functions were dead code, removed) — those constants feed `managed.ts`'s fallback templates. Editing prompt behavior means editing the fallback text in `managed.ts`/the `*_SYSTEM` constants, then running `bun run upload-prompts` if Langfuse is configured — otherwise the deployed Langfuse-managed prompt silently wins over a local edit.

### RAG brand corpus, dual-sourced
`src/tools/rag.ts` builds a Chroma vector store from either Notion (if `NOTION_TOKEN` + `NOTION_BRAND_PAGE_ID` are set) or `data/brand/*.md` (fallback). The collection is content-hashed (`corpus_hash` in the Chroma collection's metadata) so it only rebuilds when the source content actually changes; `bun run reindex` forces a rebuild. `lookupBrandStyle()` is a plain async function used both by the Strategist's `brandStyleRetriever` tool (agentic call) and directly by the Editor node (no tool-calling agent there — it just retrieves style-guide excerpts once per invocation to judge tone against).

### Drafts persist to SQLite, not files, by default
`src/db.ts` (`bun:sqlite`) is the source of truth — `finalizer.ts` always inserts a row keyed by `thread_id`, so re-running the same topic never collides. Writing to `./output/*.md` is opt-in via `WRITE_OUTPUT_FILES=true`. Notion publishing is optional and best-effort: the `publisher` graph node auto-publishes only if `NOTION_TOKEN` + `NOTION_DRAFTS_DATABASE_ID` are set (and `SKIP_PUBLISH` isn't `true`); a failure there never loses the draft since the DB row already exists. `POST /drafts/:id/publish` lets the web UI publish on demand instead of relying on the automatic graph step.

### Reference docs
`docs/superpowers/specs/` and `docs/superpowers/plans/` capture the design rationale behind several non-obvious decisions — check there before re-litigating something that looks like it should obviously be different:

- `2026-07-15-mvp-client-demo-*` — why the checkpointer is still `MemorySaver`, why Notion became optional, the run-cleanup TTL policy
- `2026-08-01-nextjs-dashboard-*` — why Next proxies rather than reading SQLite directly, why Fly.io over Railway (Railway's Hobby plan forbids commercial use), why single-instance is a hard constraint

### Runtime is Bun, not Node
Per `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`: use `bun`/`bun test`/`bun install`/`bunx`, never `node`/`npm`/`yarn`/`pnpm`/`vite`/`jest`. `bun:sqlite` instead of `better-sqlite3`. Biome (not ESLint/Prettier) enforces style — single quotes, 2-space indent, semicolons, organized imports; `bun run check` auto-fixes most of this. `suspicious/noExplicitAny` is downgraded to `warn` in `biome.json`; most other rules (e.g. `style/noNonNullAssertion`) are error-level under the recommended ruleset and do fail `bunx biome ci .` — silence a deliberate one with a `// biome-ignore lint/<rule>: <reason>` comment rather than restructuring working code around it.

### The dashboard lives in `web/` and is frontend-only
`web/` is a separate Next.js 16 app with its own `package.json`, `tsconfig.json` and ESLint config. It is **excluded from root Biome and root `tsc`** (`biome.json` ignores `web`, `tsconfig.json` excludes it) — run `cd web && bun run build` to typecheck it, not `bun run typecheck`.

**Everything backend is namespaced under `/api/*`.** `web/next.config.ts` rewrites `/api/:path*` → `${API_ORIGIN}/:path*`. Do **not** add rewrites for bare `/drafts` or `/runs`: those are page routes, and a rewrite would shadow them so the drafts screens never render. Server Components call `API_ORIGIN` directly via `web/lib/api.ts` (forwarding the auth cookie); client components fetch `/api/...`.

**Next 16 renamed `middleware.ts` to `proxy.ts`.** The file is `web/proxy.ts` and the exported function is `proxy`, not `middleware`. Its runtime is always `nodejs` (edge is unsupported), which is what lets it `fetch` the Hono server. The `matcher` is required, not optional — without it the proxy runs on `_next/static` too and blocks the login page's own CSS. `web/AGENTS.md` warns that this Next version differs from training data; the bundled docs in `web/node_modules/next/dist/docs/` are the source of truth.

**Dark mode is class-based, not media-query-based.** shadcn's tokens switch on `.dark`, so a `prefers-color-scheme` media query would darken brand colours while leaving `--background` light. A blocking inline script in `web/app/layout.tsx` sets the class from the OS preference before first paint. There is no toggle.

Route groups: `web/app/(dashboard)/` carries the nav shell; `web/app/login/` sits outside it so the login screen renders bare.

### Auth has one implementation, not two
`src/auth.ts` owns everything (HMAC session token, constant-time compare). Hono guards `/runs*`, `/drafts*`, `/stats` and serves `POST /auth/login` + `GET /auth/check`. Next's `proxy.ts` **delegates to `/auth/check`** rather than re-deriving the HMAC — don't duplicate that logic into `web/`, or the two can drift. Unset `DEMO_PASSWORD` makes both sides a no-op, which is the local-dev default.

### Vector store has two backends
`VECTOR_STORE=chroma` (default, local dev) or `memory`. The `memory` path (`src/tools/memoryVectorStore.ts`) embeds the corpus at startup and cosine-ranks in an array — LangChain 1.x ships no in-memory vector store, and the `@langchain/community` alternatives need native modules that fight containerization. Both sit behind the same `lookupBrandStyle(query)` signature, so callers never change.

**Do not set `NOTION_BRAND_PAGE_ID` in production.** `loadFromNotion()` spawns `npx -y @notionhq/notion-mcp-server`, which took minutes on a cold cache; with local brand files the same lookup takes ~1s. The corpus is baked into the container image, so production should use files and reserve Notion for publishing (`NOTION_DRAFTS_DATABASE_ID`).

### Deployment is one container, and two Fly settings are load-bearing
`Dockerfile` builds Next and the API into a single image on a `node:22-slim` base with Bun installed on top — Node is there because the Notion publisher shells out to `npx`. `docker-entrypoint.sh` runs both processes and **exits if either dies**, so the platform restarts rather than leaving a half-dead container answering HTTP.

In `fly.toml`, `auto_stop_machines = false` and a single machine (`fly scale count 1`) are correctness requirements, not tuning: run state is an in-memory `Map` and a run pauses mid-flight for human approval, so a stopped machine loses in-flight runs and a second machine would let a client approve a plan on a process that never heard of their run. Verify by observation (`fly status` after idling), not by reading the config back.

### The visual identity is EONYX, pulled from claude.ai/design
`web/app/globals.css` carries the EONYX Design System tokens (project `86b4adf4-9f78-46e9-9d4d-3eae41694ead`, type `PROJECT_TYPE_DESIGN_SYSTEM`). They were imported with the `DesignSync` tool's **read** methods — `get_project` → `list_files` → `get_file` on `tokens/*.css` — not by hand. Re-read those files to refresh the tokens; don't invent brand values.

The system is **dark-first** (`--bg: #0B0B14`), with brand indigo `#201848`, electric cyan `#08C0E8` and signal red `#E80828`. There is no light mode and no theme toggle — the brand book puts the identity on near-black indigo, so `app/layout.tsx` has no `prefers-color-scheme` script. It is also **angular, editorial and flat**: the brand explicitly rejects glow/gloss, radii are 2–10px (`--radius: 6px`), and pills are reserved for tags and status (verdict badges only).

Two collisions to know about when touching tokens:

- **`--brand` must stay defined.** `spend-chart.tsx` and `channel-chart.tsx` pass `var(--brand)` straight into SVG `fill`/`stroke` attributes. An undefined CSS variable makes SVG fall back to **black**, which is invisible on the dark canvas and passes every build and typecheck. This already happened once during the import.
- **`--accent` means different things in the two systems.** EONYX names it the cyan interactive colour; shadcn uses it for hover surfaces and its components depend on that. The cyan lives on `--brand`; `--accent` stays shadcn's.

Type treatment: Montserrat (display/UI) + JetBrains Mono (technical). The brand voice is wide-tracked uppercase mono for labels — `.eonyx-label` / `.eonyx-kicker` in `globals.css`, used on stat tiles, table headers, nav links and pipeline steps. `.eonyx-slash` is the persistent red corner chevron.
