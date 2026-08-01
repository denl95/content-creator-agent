# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup
- `bun install` — install dependencies
- Chroma must be running for the RAG brand-style lookup: `docker run -d -p 8000:8000 --name chroma chromadb/chroma` (or `docker start chroma` if the container already exists)

### Development
- `bun run dev` — CLI in watch mode
- `bun run start -- --topic "..." --channel blog --tone professional --audience "SMB owners" --word-count 1200` — CLI, one-shot run
- `bun run serve` — Hono HTTP server + static web UI at `http://localhost:3000` (`src/server.ts`)
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

SSE events (`RunEvent = {node, data, ts, seq}`) are deduped client-side (`public/index.html`) using `seq`, a monotonic per-run counter — **not** `ts`. `Date.now()` has millisecond resolution and two `emit()` calls with no async gap between them (e.g. the `strategist` chunk immediately followed by the `hitl` interrupt event) can share a timestamp; deduping on `ts` can silently drop one of them. There's no shared type between the Hono server and the static HTML client, so a change to `RunEvent`'s shape needs `handleEvent` in `public/index.html` updated by hand.

### Prompts have two sources, resolved per call
`src/prompts/managed.ts`'s `compileManagedPrompt()` tries Langfuse Prompt Management first (label from `LANGFUSE_PROMPT_LABEL`, default `"production"`), falling back to the hardcoded `MANAGED_PROMPTS[key].fallback` templates in the same file if Langfuse is unset or unreachable. `src/prompts/{strategist,writer,editor}.ts` only export the `*_SYSTEM` string constants now (the old template-building functions were dead code, removed) — those constants feed `managed.ts`'s fallback templates. Editing prompt behavior means editing the fallback text in `managed.ts`/the `*_SYSTEM` constants, then running `bun run upload-prompts` if Langfuse is configured — otherwise the deployed Langfuse-managed prompt silently wins over a local edit.

### RAG brand corpus, dual-sourced
`src/tools/rag.ts` builds a Chroma vector store from either Notion (if `NOTION_TOKEN` + `NOTION_BRAND_PAGE_ID` are set) or `data/brand/*.md` (fallback). The collection is content-hashed (`corpus_hash` in the Chroma collection's metadata) so it only rebuilds when the source content actually changes; `bun run reindex` forces a rebuild. `lookupBrandStyle()` is a plain async function used both by the Strategist's `brandStyleRetriever` tool (agentic call) and directly by the Editor node (no tool-calling agent there — it just retrieves style-guide excerpts once per invocation to judge tone against).

### Drafts persist to SQLite, not files, by default
`src/db.ts` (`bun:sqlite`) is the source of truth — `finalizer.ts` always inserts a row keyed by `thread_id`, so re-running the same topic never collides. Writing to `./output/*.md` is opt-in via `WRITE_OUTPUT_FILES=true`. Notion publishing is optional and best-effort: the `publisher` graph node auto-publishes only if `NOTION_TOKEN` + `NOTION_DRAFTS_DATABASE_ID` are set (and `SKIP_PUBLISH` isn't `true`); a failure there never loses the draft since the DB row already exists. `POST /drafts/:id/publish` lets the web UI publish on demand instead of relying on the automatic graph step.

### Reference docs for this MVP work
`docs/superpowers/specs/2026-07-15-mvp-client-demo-design.md` and `docs/superpowers/plans/2026-07-15-mvp-client-demo.md` capture the design rationale behind several non-obvious decisions (e.g. why the checkpointer is still `MemorySaver` and not a SQLite-backed one, why Notion became optional, the run-cleanup TTL policy) — check there before re-litigating something that looks like it should obviously be different.

### Runtime is Bun, not Node
Per `.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`: use `bun`/`bun test`/`bun install`/`bunx`, never `node`/`npm`/`yarn`/`pnpm`/`vite`/`jest`. `bun:sqlite` instead of `better-sqlite3`. Biome (not ESLint/Prettier) enforces style — single quotes, 2-space indent, semicolons, organized imports; `bun run check` auto-fixes most of this. `suspicious/noExplicitAny` is downgraded to `warn` in `biome.json`; most other rules (e.g. `style/noNonNullAssertion`) are error-level under the recommended ruleset and do fail `bunx biome ci .` — silence a deliberate one with a `// biome-ignore lint/<rule>: <reason>` comment rather than restructuring working code around it.
