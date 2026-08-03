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
import { createBrand, getBrand, listBrands, setDefaultBrand, updateBrand } from './brands';
import { getDb, getDraft, getStats, listDrafts, setDraftNotionUrl } from './db';
import { publishDraft } from './mcp/notion';
import {
  getRun,
  isTerminal,
  resumeRun,
  startIngest,
  startRun,
  subscribe,
  sweepStaleRuns,
} from './runManager';
import { BriefSchema } from './schemas';

// `edits` is only sent by the brand-review gate, which lets a reviewer correct
// the distilled guide in place instead of rejecting it outright. The plan gate
// never sends it, and both share this schema because both resume the same way.
const ResumeSchema = z.union([
  z.object({ approved: z.literal(true), edits: z.record(z.string(), z.unknown()).optional() }),
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
// idleTimeout is per-server, not per-route, so ordinary requests hold an idle
// socket 12x longer too. That is the accepted cost of the second guard: this is
// a single-machine API behind Fly's proxy, not a high-fanout public endpoint.
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
  if (!parsed.success)
    return c.json({ error: 'password_required', message: 'password required' }, 400);
  if (!verifyPassword(parsed.data.password))
    return c.json({ error: 'invalid_password', message: 'invalid password' }, 401);
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
    : c.json({ error: 'unauthorized', message: 'unauthorized' }, 401);
});

const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!isAuthEnabled()) return next();
  if (!verifySessionCookie(getCookie(c, SESSION_COOKIE))) {
    return c.json({ error: 'unauthorized', message: 'unauthorized' }, 401);
  }
  return next();
};

// Hono matches '/runs' and '/runs/*' separately — both must be registered.
for (const route of [
  '/runs',
  '/runs/*',
  '/drafts',
  '/drafts/*',
  '/brands',
  '/brands/*',
  '/stats',
]) {
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
  // Reject up front rather than letting the strategist retrieve from a
  // collection that does not exist.
  const brand = await getBrand(parsed.data.brand_id);
  if (!brand || brand.status !== 'active') {
    return c.json({ error: 'brand_inactive', message: 'unknown or inactive brand' }, 400);
  }
  // BriefSchema defaults language to 'uk', which is only right for the seeded
  // brand. An ingested English brand would otherwise get Ukrainian drafts that
  // its own style guide then penalises. The default has to come from the brand,
  // so the schema default is overridden unless the caller asked explicitly.
  const explicitLanguage =
    typeof (body as { language?: unknown } | null)?.language === 'string' &&
    (body as { language: string }).language.length > 0;
  const brief = explicitLanguage ? parsed.data : { ...parsed.data, language: brand.language };

  const threadId = startRun(brief);
  return c.json({ thread_id: threadId }, 201);
});

app.get('/brands', async (c) => c.json(await listBrands()));

app.get('/brands/:id', async (c) => {
  const brand = await getBrand(c.req.param('id'));
  if (!brand) return c.json({ error: 'brand_not_found', message: 'brand not found' }, 404);
  const documents = await getDb().brandDocument.findMany({
    where: { brandId: brand.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, title: true, content: true, included: true },
  });
  return c.json({ ...brand, documents });
});

const BrandPatchSchema = z.object({
  name: z.string().min(1).optional(),
  is_default: z.literal(true).optional(),
});

app.patch('/brands/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await getBrand(id)))
    return c.json({ error: 'brand_not_found', message: 'brand not found' }, 404);
  const parsed = BrandPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  if (parsed.data.is_default) await setDefaultBrand(id);
  const updated = parsed.data.name
    ? await updateBrand(id, { name: parsed.data.name })
    : await getBrand(id);
  return c.json(updated);
});

app.get('/runs/:id', (c) => {
  const run = getRun(c.req.param('id'));
  if (!run) return c.json({ error: 'run_not_found', message: 'run not found' }, 404);
  return c.json(run);
});

app.post('/runs/:id/resume', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ResumeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
  const result = resumeRun(c.req.param('id'), parsed.data);
  if (!result.resumed) {
    // `status` is what lets the client tell a run that is gone from one that has
    // already moved past the gate — a retried resume needs that distinction, and
    // it is knowledge only this handler has.
    return c.json(
      {
        error: 'run_not_awaiting',
        message: 'run not found or not awaiting approval',
        status: result.status,
      },
      409,
    );
  }
  return c.json({ resumed: true });
});

app.get('/runs/:id/events', (c) => {
  const id = c.req.param('id');
  const run = getRun(id);
  if (!run) return c.json({ error: 'run_not_found', message: 'run not found' }, 404);
  // `no-transform` is what stops an intermediary from gzipping this stream.
  // Next's proxy compresses proxied responses when the client sends
  // Accept-Encoding: gzip — every browser does, curl does not — and the gzip
  // encoder buffers, so the browser held an open connection that delivered
  // nothing until the run ended. Verified by reading `content-encoding: gzip`
  // off the response in the page. Hono's streamSSE sets Cache-Control itself,
  // so this has to be applied to the Response it returns.
  const res = streamSSE(c, async (stream) => {
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
      // The poll does a second job beyond spotting a terminal status: a run
      // removed by sweepStaleRuns emits nothing, so closing on the done/error
      // event alone would leave that stream open forever.
      await pumpKeepalive(stream, () => {
        if (!open) return false;
        const current = getRun(id);
        return !!current && !isTerminal(current.status);
      });
    } finally {
      unsubscribe?.();
    }
  });
  // Augment rather than replace, so anything Hono sets here in future survives.
  res.headers.set(
    'Cache-Control',
    `${res.headers.get('Cache-Control') ?? 'no-cache'}, no-transform`,
  );
  // Belt and braces for the day this sits behind nginx, which buffers proxied
  // responses regardless of Cache-Control.
  res.headers.set('X-Accel-Buffering', 'no');
  return res;
});

const SourceSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('website'), locator: z.string().url() }),
  z.object({ kind: z.literal('rss'), locator: z.string().url() }),
  z.object({
    kind: z.literal('paste'),
    locator: z.string().default('pasted'),
    body: z.string().min(1),
  }),
]);

const CreateBrandSchema = z.object({
  name: z.string().min(1),
  sources: z.array(SourceSpecSchema).min(1),
});

/** Slugs key the vector collection, so they must be unique and Chroma-safe. */
async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'brand';
  const existing = new Set((await listBrands()).map((b) => b.slug));
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!existing.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}

app.post('/brands', async (c) => {
  sweepStaleRuns();
  const parsed = CreateBrandSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);

  const brand = await createBrand({
    name: parsed.data.name,
    slug: await uniqueSlug(parsed.data.name),
    // Replaced by the distiller's detected language when the indexer runs.
    language: 'en',
    status: 'draft',
  });
  const threadId = startIngest({ brandId: brand.id, sources: parsed.data.sources });
  return c.json({ brand_id: brand.id, thread_id: threadId }, 201);
});

app.post('/brands/:id/reingest', async (c) => {
  const brand = await getBrand(c.req.param('id'));
  if (!brand) return c.json({ error: 'brand_not_found', message: 'brand not found' }, 404);
  const stored = await getDb().brandSource.findMany({ where: { brandId: brand.id } });
  // A paste row written before bodies were persisted has nothing to replay.
  // Dropping it beats failing the whole re-ingest on one unusable source.
  const replayable = stored.filter((s) => s.kind !== 'paste' || (s.body ?? '').length > 0);
  if (replayable.length === 0) {
    return c.json(
      stored.length === 0
        ? {
            error: 'brand_has_no_sources',
            message: 'this brand has no stored sources to re-ingest',
          }
        : {
            error: 'brand_paste_only',
            message:
              'this brand has only pasted sources recorded before their text was stored — create it again',
          },
      409,
    );
  }
  const threadId = startIngest({
    brandId: brand.id,
    sources: replayable.map((s) =>
      // The stored body is what makes a paste source replayable at all.
      s.kind === 'paste'
        ? { kind: 'paste' as const, locator: s.locator, body: s.body ?? '' }
        : { kind: s.kind as 'website' | 'rss', locator: s.locator },
    ),
  });
  return c.json({ brand_id: brand.id, thread_id: threadId }, 201);
});

app.delete('/brands/:id', async (c) => {
  const brand = await getBrand(c.req.param('id'));
  if (!brand) return c.json({ error: 'brand_not_found', message: 'brand not found' }, 404);
  if (brand.is_default) {
    return c.json(
      {
        error: 'brand_is_default',
        message: 'cannot delete the default brand — make another brand default first',
      },
      409,
    );
  }
  // Sources and documents cascade; drafts keep their history with a null FK.
  await getDb().brand.delete({ where: { id: brand.id } });
  return c.json({ deleted: true });
});

app.get('/drafts', async (c) => c.json(await listDrafts()));

app.get('/stats', async (c) => c.json(await getStats()));

app.get('/drafts/:id', async (c) => {
  const draft = await getDraft(c.req.param('id'));
  if (!draft) return c.json({ error: 'draft_not_found', message: 'draft not found' }, 404);
  return c.json(draft);
});

app.post('/drafts/:id/publish', async (c) => {
  const draft = await getDraft(c.req.param('id'));
  if (!draft) return c.json({ error: 'draft_not_found', message: 'draft not found' }, 404);
  const databaseId = process.env.NOTION_DRAFTS_DATABASE_ID;
  if (!databaseId || !process.env.NOTION_TOKEN) {
    return c.json(
      {
        error: 'notion_not_configured',
        message: 'Notion is not configured (NOTION_TOKEN, NOTION_DRAFTS_DATABASE_ID)',
      },
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
    await setDraftNotionUrl(draft.id, page.url);
    return c.json({ url: page.url });
  } catch (err) {
    return c.json(
      { error: 'publish_failed', message: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
});

// API only — the Next.js app in web/ serves the UI and proxies here via /api/*.
export default {
  port: Number(process.env.PORT ?? 3000),
  idleTimeout: SERVER_IDLE_TIMEOUT_S,
  fetch: app.fetch,
};
