# MVP Client-Demo Readiness — Design Spec

**Date:** 2026-07-15
**Goal:** Turn `content-creator-agent` into a demo-ready MVP that convinces potential clients of an AI agency that "we can build a content pipeline in your brand voice, with human control, quality gates, and full observability."

---

## 1. Context: what the demo must prove

The audience is prospective agency clients (SMB owners, marketing leads — mostly non-technical). The demo must show, in under 10 minutes:

1. **It writes in *your* brand voice** — not generic AI slop (RAG over brand corpus).
2. **You stay in control** — human approval of the plan (and ideally the final draft).
3. **It self-checks quality** — the Writer↔Editor loop with visible scores.
4. **It lands where you work** — Notion publishing.
5. **It's cheap and measurable** — cost per article, traces, evals.

The current project already has the *engine* for all five. What it lacks is (a) correctness fixes in the prompt/data flow, and (b) a demo surface a non-technical client can watch without reading a terminal.

## 2. Current state (verified against source)

Working: LangGraph pipeline (Strategist → HITL → Writer ↔ Editor → Finalizer → Publisher), structured outputs via Zod, Chroma RAG with corpus-hash caching, Notion MCP (brand fetch + publish with auto-column creation), Tavily search with per-run cap, Langfuse tracing + prompt management + LLM-judge evaluators, judge test suite, good README.

Known gaps already documented in `.plans/production-readiness.md` (API layer, persistent checkpointer, queue, secrets, etc.). This spec deliberately overlaps with only the items needed for a *demo*; the rest stays in that plan.

## 3. Flaws to fix (Phase 1 — correctness)

Ordered by demo impact:

### F1. Brand identity mismatch in all three system prompts — **critical**
`src/prompts/strategist.ts`, `writer.ts`, `editor.ts` all open with *"Lumen, a B2B SaaS product for SMB accounting automation"*, but the brand corpus (`data/brand/brand.md`) defines Lumen as an **AI development agency for small businesses**. The agents' core identity contradicts the RAG corpus they retrieve — exactly the kind of inconsistency a prospective client would notice ("wait, why is it talking about accounting?").
**Fix:** Update all three system prompts to the AI-agency identity, or better: remove the hardcoded company description and instruct the agent to derive identity from `brand_style_lookup`. Re-run `bun run upload-prompts` afterward (Langfuse-managed prompts override local ones at runtime — the stale text lives there too).

### F2. Writer and Editor never receive the target word count or channel — **critical**
`writerVariables()` in `src/prompts/managed.ts` passes outline/keywords/key_messages/audience/tone only. `ContentPlan` doesn't carry `word_count` or `channel` either. So the Writer's rule "Stay within ±10% of the target word count" is unenforceable — it literally never sees the number — and the Editor can't check length or channel-format compliance (280-char Twitter limit, etc.).
**Fix:** Pass `brief.word_count` and `brief.channel` into `writerVariables` and `editorVariables` (nodes already have `state.brief`), add `{{word_count}}`/`{{channel}}` placeholders to both prompts, and add a `length_score` or explicit length/format check to the Editor rubric. Re-upload prompts.

### F3. `word_count` is self-reported by the LLM
`DraftContent.word_count` is whatever the model claims. Shown in CLI and written into the Notion database — often wrong.
**Fix:** Compute it from `content` (`content.split(/\s+/).length`) after parsing; drop or overwrite the LLM-reported field.

### F4. Editor judges "brand voice" blind
The rubric scores "matches brand voice" but the Editor has no `brand_style_lookup` tool and no brand excerpt in its prompt — it can only compare against the one-word tone string.
**Fix:** Inject the top brand-style chunks (retrieved once per run against the plan tone/channel) into the editor prompt as a `{{brand_style}}` variable. Cheaper and more deterministic than giving the Editor tools.

### F5. Output files silently overwrite
`finalizer.ts` derives the filename from the topic slug only — re-running the same topic (which happens constantly in demos) overwrites the previous result.
**Fix:** Append a short timestamp or thread-id suffix when the file already exists. (Largely superseded by F16 — once drafts live in SQLite, the `./output/` file write becomes an optional export; each DB row is keyed by thread id so re-runs never collide.)

### F6. HITL typo-approves
In `cli.ts`, any answer other than `r`/`q` counts as approve. A typo at the gate approves the plan — bad look mid-demo.
**Fix:** Only `a` approves; anything else re-prompts.

### F7. No timeout on LLM calls
LangChain retries transient OpenAI errors by default, but a hung call blocks the run indefinitely.
**Fix:** Set `timeout` (e.g. 120s) on the shared `ChatOpenAI` instances in `src/model.ts` and `src/nodes/editor.ts`.

### F8. Dead code
`buildStrategistMessage`/`buildWriterMessage`/`buildEditorMessage` (superseded by `managed.ts`) and the `save_content` tool (finalizer writes directly) are unused. **Fix:** delete them — a client's technical advisor may read this repo.

### F9. Notion publish loses inline formatting
`markdownToBlocks` handles headings/lists/quotes but leaves `**bold**`, links, and multi-line code fences as raw text, so published pages show literal asterisks. **Fix (nice-to-have):** minimal inline rich-text parsing for bold/italic/links; treat fenced code as one block.

## 4. Features to add

### Phase 2 — demo surface (the biggest gap)

**F16. SQLite drafts store (primary destination; Notion becomes optional)**
Drafts are persisted to a local SQLite database via Bun's built-in `bun:sqlite` — no new dependencies, one file (`data/app.db`), and the same engine as the `SqliteSaver` checkpointer planned in F10.

- Schema (single `drafts` table):
  `id` (thread_id), `topic`, `channel`, `tone`, `audience`, `content` (Markdown), `word_count` (computed, per F3), `verdict`, `tone_score`, `accuracy_score`, `structure_score`, `iterations`, `cost_usd` / `tokens` (from F12), `notion_url` (nullable), `created_at`.
- The Finalizer writes the row; this replaces `./output/` files as the source of truth. Keep the file write behind an env flag (`WRITE_OUTPUT_FILES=true`) as an optional export for anyone who wants Markdown on disk.
- A thin `src/db.ts` module owns the connection and queries; the CLI prints "Saved draft <id>" instead of "saved to ./output/".
- **Notion is unchanged but explicitly demoted to an optional destination**: the Publisher runs only when `NOTION_TOKEN` + `NOTION_DRAFTS_DATABASE_ID` are set (as today), and on success writes `notion_url` back onto the draft row. A publish failure never loses content — the DB row already exists.
- Migration note: the judge tests and README examples that reference `./output/` need updating.

*Alternatives considered:* Postgres is the production answer but demands Docker/hosting for a demo; JSON files avoid a schema but can't power the drafts-library UI (filtering, sorting) cleanly. SQLite is the right MVP cut.

**F10. HTTP API (Hono, ~150 LOC)**
- `POST /runs` → starts a pipeline run, returns `thread_id`
- `GET /runs/:id` → current state (node, plan, draft, scores, iteration, status)
- `POST /runs/:id/resume` → HITL decision `{approved, feedback?}`
- `GET /drafts` + `GET /drafts/:id` → list/read saved drafts from the F16 store
- `POST /drafts/:id/publish` → push an existing draft to Notion on demand (replaces automatic publishing as the default demo flow)
- Streams node updates via SSE (`GET /runs/:id/events`) so the UI can show live progress.
- Reuses the existing compiled graph; `MemorySaver` is acceptable for a single-process demo, but swapping to `SqliteSaver` (~5 lines) makes runs survive restarts and is worth doing here.
- Make the search counter per-run (keyed by thread id) instead of the current module-level global — required once two runs can overlap.

**F11. Minimal web demo UI (single page, no framework ceremony)**
The one thing that changes how the demo lands with non-technical clients. One page:
1. Brief form (topic / channel / tone / audience / word count).
2. Live pipeline view — the same node names as the Mermaid diagram lighting up as SSE events arrive; Editor scores shown per iteration.
3. Plan approval card — approve / request changes with a feedback box (drives the existing interrupt).
4. Final result — rendered Markdown, word count, cost, plus a "Publish to Notion" button (calls `POST /drafts/:id/publish`; hidden when Notion isn't configured).
5. Drafts library — a list view over `GET /drafts` (topic, channel, verdict, scores, cost, date) so the client sees accumulated output, not just one run.

*Alternatives considered:* LangGraph Studio (already wired via `bun run studio`) is fine for technical audiences but too raw for SMB owners; a full Next.js app is over-scoped. A single static page + the Hono API is the right MVP cut.

**F12. Cost & token reporting per run**
Agencies sell ROI. Capture `usage_metadata` from each LLM response (already flowing through LangChain), sum per run, and show "Article generated for $0.03 in 1m 42s" in the CLI summary and the UI result card. Also acts as the budget guard from the production plan (abort the run past a `MAX_RUN_TOKENS` env cap).

### Phase 3 — pitch features (pick per client meeting)

**F13. Multi-channel repurposing** — one topic → blog + LinkedIn + Twitter variants in a single run (fan out Writer/Editor per channel after one shared plan). This is the classic agency upsell and demos extremely well. Requires state to hold a map of channel→draft; scope as its own graph iteration.

**F14. Final-draft HITL** — a second interrupt between Finalizer and Publisher: approve / edit / regenerate the finished text before it hits Notion. Answers the inevitable "what if I don't like the result?" question. Cheap: the interrupt machinery already exists.

**F15. "Bring your own brand" onboarding script** — `bun run onboard --notion-page <id>` (or `--dir ./client-brand/`) that reindexes Chroma into a per-client collection (`CHROMA_COLLECTION=<client>`). Turns the demo from "look at our fictional brand" into "we ingested *your* site this morning" — the strongest possible pitch. Mostly plumbing that already exists (`reindex.ts` + collection env var).

**Deliberately out of scope for MVP** (stays in `.plans/production-readiness.md`): job queue, Postgres checkpointer, cloud storage, secrets manager, auth, structured logging, health checks. None of them change what a prospect sees.

## 5. Testing & quality gates

- Unit tests (fast, free, deterministic) for the pure logic that currently has none: `slugify`, `markdownToBlocks`, `routeAfterEditor`, word-count computation, HITL resume schema, and the `src/db.ts` draft queries (against an in-memory `bun:sqlite` database). Run with plain `bun test`.
- Keep judge tests as-is; add a length-compliance assertion to `writer.test.ts` once F2 lands (it will fail today — that's the point).
- GitHub Actions: `typecheck` + `biome check` + unit tests on every push; judge tests manual/nightly (they cost money).

## 6. Success criteria

- A cold `git clone` → running demo in ≤ 5 commands, with **no Notion keys required** — drafts land in SQLite; Notion is a one-click optional publish when configured.
- Full run from brief to saved draft, driven entirely from the web UI, with live progress and cost shown; the draft then appears in the drafts library and can be pushed to Notion on demand.
- Same topic re-run twice → two draft rows, nothing overwritten.
- A 300-word LinkedIn brief produces a draft within ±10% of 300 words (F2 verification).
- All three agents describe Lumen as an AI agency (F1 verification).

## 7. Suggested implementation order

1. Phase 1 fixes F1–F8 (one PR, mostly prompt/plumbing changes + prompt re-upload)
2. F12 cost tracking (small, benefits CLI immediately)
3. F16 SQLite drafts store (finalizer + publisher rewiring; unblocks the drafts endpoints)
4. F10 API + SqliteSaver, then F11 UI (one PR each)
5. Phase 3 features on demand per client meeting: F15 → F14 → F13 (in order of effort-to-wow ratio)
