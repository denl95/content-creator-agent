import 'dotenv/config';
import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  isAuthEnabled,
  SESSION_COOKIE,
  sessionToken,
  verifyPassword,
  verifySessionCookie,
} from './auth';
import { getDraft, getStats, listDrafts, setDraftNotionUrl } from './db';
import { publishDraft } from './mcp/notion';
import { getRun, resumeRun, startRun, subscribe, sweepStaleRuns } from './runManager';
import { BriefSchema } from './schemas';

const ResumeSchema = z.union([
  z.object({ approved: z.literal(true) }),
  z.object({ approved: z.literal(false), feedback: z.string().min(1) }),
]);

export const app = new Hono();

// Bun.serve closes a connection that has sent and received nothing for
// `idleTimeout` seconds — and its default is 10. A run's SSE stream is silent
// between node completions, and a single node routinely runs far longer than
// that (the strategist alone does a brand lookup plus up to 10 web searches),
// so the socket was being killed mid-run and the Next rewrite proxy logged it
// as `socket hang up` / ECONNRESET. Two independent guards:
//   - a comment frame every SSE_KEEPALIVE_MS, so the connection is never idle;
//   - a raised idleTimeout, so one slow write can't undo it. Bun caps this at 255.
export const SSE_POLL_MS = 1000;
export const SSE_KEEPALIVE_MS = 5000;
export const SERVER_IDLE_TIMEOUT_S = 120;

/**
 * Holds an SSE connection open while `isOpen()` is true, emitting a comment
 * frame on the keepalive cadence. Comments (`:` lines) are discarded by
 * EventSource, so they never surface as a `RunEvent` on the client.
 */
export async function pumpKeepalive(
  stream: { write: (chunk: string) => Promise<unknown>; sleep: (ms: number) => Promise<unknown> },
  isOpen: () => boolean,
  { pollMs = SSE_POLL_MS, keepaliveMs = SSE_KEEPALIVE_MS } = {},
): Promise<void> {
  let sinceKeepalive = 0;
  while (isOpen()) {
    await stream.sleep(pollMs);
    sinceKeepalive += pollMs;
    if (sinceKeepalive >= keepaliveMs) {
      sinceKeepalive = 0;
      await stream.write(': keepalive\n\n');
    }
  }
}

const LoginSchema = z.object({ password: z.string() });

app.post('/auth/login', async (c) => {
  if (!isAuthEnabled()) return c.json({ ok: true });
  const body = await c.req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'password required' }, 400);
  if (!verifyPassword(parsed.data.password)) return c.json({ error: 'invalid password' }, 401);
  setCookie(c, SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return c.json({ ok: true });
});

app.get('/auth/check', (c) => {
  if (!isAuthEnabled()) return c.json({ ok: true });
  return verifySessionCookie(getCookie(c, SESSION_COOKIE))
    ? c.json({ ok: true })
    : c.json({ error: 'unauthorized' }, 401);
});

const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!isAuthEnabled()) return next();
  if (!verifySessionCookie(getCookie(c, SESSION_COOKIE))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
};

// Hono matches '/runs' and '/runs/*' separately — both must be registered.
for (const route of ['/runs', '/runs/*', '/drafts', '/drafts/*', '/stats']) {
  app.use(route, requireAuth);
}

if (process.env.ENABLE_SSE_DEBUG === 'true') {
  // Diagnostic only: emits 5 events 500ms apart so a proxy can be tested for
  // response buffering without spending money on a real pipeline run.
  app.get('/debug/sse-ping', (c) =>
    streamSSE(c, async (stream) => {
      for (let i = 0; i < 5; i++) {
        await stream.writeSSE({ data: JSON.stringify({ i, ts: Date.now() }) });
        await stream.sleep(500);
      }
    }),
  );
}

app.post('/runs', async (c) => {
  sweepStaleRuns();
  const body = await c.req.json().catch(() => null);
  const parsed = BriefSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const threadId = startRun(parsed.data);
  return c.json({ thread_id: threadId }, 201);
});

app.get('/runs/:id', (c) => {
  const run = getRun(c.req.param('id'));
  if (!run) return c.json({ error: 'run not found' }, 404);
  return c.json(run);
});

app.post('/runs/:id/resume', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ResumeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const ok = resumeRun(c.req.param('id'), parsed.data);
  if (!ok) return c.json({ error: 'run not found or not awaiting approval' }, 409);
  return c.json({ resumed: true });
});

app.get('/runs/:id/events', (c) => {
  const id = c.req.param('id');
  const run = getRun(id);
  if (!run) return c.json({ error: 'run not found' }, 404);
  return streamSSE(c, async (stream) => {
    for (const event of run.events) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }
    let open = true;
    stream.onAbort(() => {
      open = false;
    });
    const unsubscribe = subscribe(id, (event) => {
      void stream.writeSSE({ data: JSON.stringify(event) });
    });
    try {
      await pumpKeepalive(stream, () => {
        if (!open) return false;
        const current = getRun(id);
        return !!current && current.status !== 'done' && current.status !== 'error';
      });
    } finally {
      unsubscribe?.();
    }
  });
});

app.get('/drafts', (c) => c.json(listDrafts()));

app.get('/stats', (c) => c.json(getStats()));

app.get('/drafts/:id', (c) => {
  const draft = getDraft(c.req.param('id'));
  if (!draft) return c.json({ error: 'draft not found' }, 404);
  return c.json(draft);
});

app.post('/drafts/:id/publish', async (c) => {
  const draft = getDraft(c.req.param('id'));
  if (!draft) return c.json({ error: 'draft not found' }, 404);
  const databaseId = process.env.NOTION_DRAFTS_DATABASE_ID;
  if (!databaseId || !process.env.NOTION_TOKEN) {
    return c.json(
      { error: 'Notion is not configured (NOTION_TOKEN, NOTION_DRAFTS_DATABASE_ID)' },
      400,
    );
  }
  try {
    const page = await publishDraft({
      databaseId,
      title: draft.topic,
      content: draft.content,
      channel: draft.channel,
      wordCount: draft.word_count,
      status: draft.verdict === 'APPROVED' ? 'Approved' : 'Unapproved',
    });
    setDraftNotionUrl(draft.id, page.url);
    return c.json({ url: page.url });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// API only — the Next.js app in web/ serves the UI and proxies here via /api/*.
export default {
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: SERVER_IDLE_TIMEOUT_S,
  fetch: app.fetch,
};
