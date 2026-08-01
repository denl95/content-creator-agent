# Next.js Dashboard + Deployment — Design Spec

**Date:** 2026-08-01
**Goal:** Replace the single-file demo UI with a designed Next.js dashboard, and deploy it to a public URL so prospective clients can be shown — or sent — a working AI content pipeline.

---

## 1. Context

`content-creator-agent` currently ships a working LangGraph pipeline behind a Hono HTTP API (`src/server.ts`) and a single hand-written page (`public/index.html`). The pipeline, API, SQLite drafts store, cost tracking, and SSE progress streaming are all built, reviewed, and verified live (see `docs/superpowers/specs/2026-07-15-mvp-client-demo-design.md`).

The remaining gap is presentational and logistical: the UI reads as a prototype rather than an agency's product, clicking a draft does nothing, and there is no way to show it to anyone who isn't sitting at this machine.

**This is a polish-and-ship pass, not a re-architecture.** The pipeline, graph, DB layer, and API boundary stay as they are.

## 2. Scope

**In scope**
- A Next.js frontend in `web/`, replacing `public/index.html`
- Four screens: dashboard, run, drafts library, draft detail
- A designed visual system (typography, color, dark mode) using Tailwind + shadcn/ui
- One new backend endpoint: `GET /stats`
- A shared-password gate over the whole app
- Swapping Chroma for an in-process vector store in deployed environments
- Deployment to Railway as a single container

**Explicitly out of scope**
- Authentication with user accounts, roles, or multi-tenancy
- Moving run state out of memory, or a persistent LangGraph checkpointer
- Postgres migration (the Railway persistent volume keeps SQLite viable)
- Horizontal scaling — the in-memory run store means exactly one instance
- Editing drafts in the UI; publishing to Notion remains the only write action on a draft

## 3. Architecture

Next.js is a frontend only. `next.config.ts` rewrites `/runs/*`, `/drafts/*`, and `/stats` to the Hono server, so the browser sees a single origin and there is no CORS to configure. Hono keeps owning the pipeline, the SQLite database, run orchestration, and SSE.

```
browser ──▶ Next.js (:3001)
              │  rewrites /runs, /drafts, /stats
              ▼
           Hono (:3000) ──▶ LangGraph pipeline
                         └▶ SQLite (data/app.db)
```

In production both processes run in one container behind a single public port (see §7).

**Why proxy rather than let Next read SQLite directly:** two processes holding the same SQLite file open requires WAL mode and splits data access across two codebases. Proxying keeps one source of truth and leaves the API independently usable (`curl`-able), which matters for a technical audience.

**Data fetching per screen:** dashboard, drafts library, and draft detail are React Server Components fetching from the Hono API server-side. The run screen must be a Client Component — it owns an `EventSource`.

## 4. Screens

| Route | Contents | Rendering |
|---|---|---|
| `/` | Stat tiles (total drafts, spend, approval rate, avg iterations), spend-over-time chart, drafts-per-channel chart, recent drafts list | Server Component |
| `/run` | Brief form → live pipeline progress → plan approval → result | Client Component |
| `/drafts` | Table of all drafts, filterable by channel and verdict | Server Component |
| `/drafts/[id]` | Rendered Markdown content, editor scores, issue list, cost/tokens, Notion link or publish button | Server Component + client island for publish |

Feature parity with `public/index.html` is required on `/run` before that file is deleted: brief form, live node progress, plan approve/revise with feedback, editor scores per iteration, final result, and publish-to-Notion.

The draft detail screen is new. It is the highest-value addition: the current UI generates content and then effectively discards it from view. Being able to open a finished piece, read it, and see *why* the Editor scored it as it did is the most concrete demonstration of the quality loop.

## 5. Visual identity

Tailwind + shadcn/ui, with a defined token system rather than ad-hoc classes:

- **Type scale** with a deliberate display/body pairing — not system-ui defaults
- **Neutral palette + one accent**, expressed as CSS variables
- **Semantic state colors** for `APPROVED` / `REVISION_NEEDED`, reused everywhere those states appear
- **Dark mode** via the same variables
- **Charts** (Recharts) styled to the same tokens

Charts must look composed at low data volume. The database currently holds three drafts; a chart that looks broken with three points is worse than no chart. Sparse states are a design requirement, not an afterthought.

## 6. Backend changes

Three contained changes to the existing Bun/Hono codebase:

**`GET /stats`** — read-only aggregates computed in SQL in `src/db.ts`:
`totalDrafts`, `approvedCount`, `approvalRate`, `totalCostUsd`, `avgIterations`, `avgScores` (tone/accuracy/structure), `byChannel[]`, `spendByDay[]`.

**Shared-password gate** — enforced in two places, because two servers are involved:

- *Next.js middleware* protects pages. Unauthenticated requests redirect to `/login`, which POSTs the password and sets an HTTP-only, `Secure`, `SameSite=Lax` cookie.
- *Hono middleware* independently protects `/runs`, `/drafts`, and `/stats`, validating the same cookie.

Next is the only publicly exposed port in the container, so the Hono check is defense-in-depth — but it also means the API stays protected in local development, where Hono is directly reachable. The comparison uses a constant-time check against a `DEMO_PASSWORD` env var. When `DEMO_PASSWORD` is unset (local dev), both middlewares are no-ops, so existing workflows are unaffected.

At roughly $0.007–0.01 of OpenAI spend per generated draft, an unguarded public URL is the real financial exposure of deploying this — larger than the hosting bill.

**In-process vector store** — `src/tools/rag.ts` gains a `VECTOR_STORE=chroma|memory` switch, eliminating Chroma as a deployed service.

LangChain 1.x ships no in-memory vector store (`MemoryVectorStore` existed in 0.x; the surviving `@langchain/community` options, faiss and hnswlib, require native modules that complicate the container). The `memory` implementation is therefore ~40 lines written in-repo: embed the corpus chunks once at startup with the existing `OpenAIEmbeddings`, hold the vectors in an array, and rank by cosine similarity. The corpus is a handful of Markdown files, so startup cost is seconds and a fraction of a cent, and the whole thing is trivially unit-testable with stub vectors.

Chroma remains the local-dev default, so existing behavior, the corpus-hash caching, and the `reindex` script are unaffected. Both paths sit behind the existing `lookupBrandStyle(query)` signature — callers do not change.

## 7. Deployment

**Railway**, single container, roughly $5/month.

The pipeline's requirements rule out most cheaper options: runs take minutes and pause mid-flight awaiting human approval, and run state lives in an in-memory `Map`. Any platform that sleeps, scales to zero, or recycles instances destroys in-progress runs. Railway does not sleep by default and offers persistent volumes on the base plan — which is what lets SQLite survive and keeps Postgres out of scope.

Railway bills usage rather than per-service, so additional demo apps later cost overage rather than another full plan fee.

**Container shape:** one image, built with a Dockerfile, running Hono and Next together. SQLite lives on a mounted persistent volume via `DRAFTS_DB_PATH`. Secrets (`OPENAI_API_KEY`, `TAVILY_API_KEY`, `DEMO_PASSWORD`, optional Notion and Langfuse keys) are Railway environment variables, never baked into the image.

Rejected: Fly.io (machines auto-stop by default — precisely the failure mode that breaks in-memory runs), Render (per-service pricing; free tier has no persistent disk), Vercel (cannot host a long-running stateful backend at all).

## 8. Risks

**SSE through Next rewrites may buffer.** Next's proxy can buffer streamed responses, which would silently break live pipeline progress — the centerpiece of the demo. This must be verified in the first implementation task, not discovered at the end. Fallback: point `EventSource` directly at the API origin and enable CORS on Hono.

**Bun and Next.js.** The project rule (`.cursor/rules/`) is Bun everywhere; Next is Node-first. Plan: `bun install` and `bun run` throughout, and if a Next-specific runtime bug appears, `web/` alone falls back to Node while the pipeline stays pure Bun. Whatever the outcome, it gets recorded in `CLAUDE.md` rather than silently violating the stated rule.

**Notion MCP in a container.** The publisher spawns `npx -y @notionhq/notion-mcp-server`, which requires Node and network access inside the image. If this proves awkward to containerize, Notion publishing degrades gracefully — it is already optional and best-effort, and drafts are never lost when it fails.

**Single instance is a hard constraint.** In-memory run state means the container must never run more than one replica. This needs to be set explicitly in Railway, not assumed.

## 9. Testing

- Unit tests for the `/stats` SQL aggregation — pure, deterministic, fits the existing `tests/unit/` suite
- Unit tests for the password middleware: unset env is a no-op, wrong password rejected, correct password sets a cookie
- Unit tests for the in-process vector store's cosine ranking, using stub vectors so no embedding API call is made
- The existing 19 unit tests stay green; `bunx biome ci .` stays clean
- Frontend gets manual browser verification driving a real end-to-end run, not just typecheck. Every significant bug found in this project so far — the dropped cost-tracking callback, the SSE dedup collision, the reasoning-model rejection — surfaced only when the pipeline actually ran. UI correctness will be no different.
- Post-deploy smoke test on the live Railway URL: log in, run a brief end to end, confirm the draft persists across a container restart

## 10. Success criteria

1. A client can be sent a URL, enter a password, and generate a piece of content end to end without assistance
2. Live pipeline progress streams correctly through the deployed proxy
3. Drafts survive a container restart (persistent volume verified, not assumed)
4. The dashboard reads as designed at three drafts, not just at thirty
5. `public/index.html` is deleted, with `/run` at full parity
6. The whole thing costs about $5/month, with OpenAI spend gated behind the password

## 11. Implementation phases

1. **Backend prerequisites** — `GET /stats` + tests, password middleware + tests, `VECTOR_STORE` switch
2. **Next.js scaffold + SSE spike** — `web/`, Tailwind + shadcn, rewrites, and an immediate end-to-end SSE verification before building anything on top of it
3. **Design system** — tokens, type scale, dark mode, shared components
4. **Screens** — `/run` first (parity, unblocks deleting the old UI), then `/drafts` and `/drafts/[id]`, then `/`
5. **Containerize + deploy** — Dockerfile, Railway service, volume, env vars, live smoke test
6. **Cleanup** — delete `public/index.html`, update README and CLAUDE.md
