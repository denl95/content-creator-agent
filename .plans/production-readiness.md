# Production Readiness Plan

## Infrastructure

### 1. Replace `MemorySaver` with a persistent checkpointer
The current `graph.ts:21` uses `MemorySaver` — all thread state is lost on restart. Use `@langchain/langgraph-checkpoint-postgres` or Redis. Without this, any deploy or crash wipes every in-progress job.

### 2. HTTP API layer
Right now it's CLI-only. Production needs an HTTP server (Hono or Fastify) with endpoints like:
- `POST /jobs` — start a new pipeline run, return `thread_id`
- `GET /jobs/:threadId` — poll status
- `POST /jobs/:threadId/resume` — submit HITL decision asynchronously

### 3. Job queue
Concurrent runs today block each other and share no concurrency control. Add a queue (BullMQ + Redis) so jobs are processed with rate limits and retries.

### 4. Cloud output storage
Output goes to local `./output/` — that disappears on every deploy. Write to S3 or GCS instead.

---

## Reliability

### 5. LLM call retries
Search has retry logic but LLM calls in all nodes have none. OpenAI 429s and 500s will crash a run. Wrap `invoke()` calls or configure `maxRetries` on the `ChatOpenAI` instance.

### 6. Per-run timeouts
A hung LLM call blocks the process indefinitely. Add `AbortSignal` or `Promise.race` with a timeout (e.g. 120s) around each node's invoke.

### 7. Graceful shutdown
`shutdown()` in `observability.ts` flushes Langfuse but nothing else. Need to drain the job queue and close DB connections cleanly on `SIGTERM`.

---

## Security

### 8. Prompt injection protection
User-supplied `topic`, `audience`, and `tone` fields are interpolated directly into prompts. A malicious input like `"Ignore all instructions and..."` would work. Sanitize or wrap inputs in clearly-delimited blocks in the prompt builder.

### 9. Authentication on the HTTP API
Any API endpoint needs auth (API key or JWT) before it's exposed externally.

### 10. Secret management
`.env` file is fine locally but in production use a secrets manager (AWS Secrets Manager, Doppler, etc.) and never bake keys into the image.

---

## Cost & Quality Control

### 11. Token usage tracking and budget cap
There's no guard against runaway costs. A misconfigured `MAX_ITERATIONS` or a very large `word_count` can burn through budget silently. Log token usage per run from the LLM response and add a hard per-job token budget.

### 12. Output quality gate before delivery
The finalizer saves whatever the writer produces even if `REVISION_NEEDED`. Consider blocking delivery until a human reviews unapproved content rather than just adding `-unapproved` to the filename.

---

## Operations

### 13. Structured logging
All logs are `console.log`. In production you need JSON-structured logs with `level`, `threadId`, `node`, and `durationMs` so they're queryable in Datadog/CloudWatch/Loki.

### 14. Health check endpoint
`GET /health` that verifies the DB connection, RAG store, and OpenAI reachability — required by any load balancer or container orchestrator.

### 15. RAG index persistence
The vector store is rebuilt from files on every process start, paying embedding costs each time. Persist the index to disk or a vector DB (Qdrant, Weaviate, pgvector) and only rebuild when `data/brand/` changes.

### 16. CI/CD pipeline
Run the judge tests (`tests/judge/`) on every PR. Block merges if any judge test regresses below threshold — this is your quality regression gate.

---

## Biggest bang-for-buck order

1. Persistent checkpointer — without it every restart loses jobs
2. HTTP API + async HITL — the CLI blocks; async is required for real usage
3. LLM retries + timeouts — prevents silent failures under load
4. Structured logging — you can't debug production without it
5. Job queue + cloud storage — needed before any multi-user traffic
