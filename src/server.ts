import 'dotenv/config';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { getDraft, listDrafts, setDraftNotionUrl } from './db';
import { publishDraft } from './mcp/notion';
import { getRun, resumeRun, startRun, subscribe } from './runManager';
import { BriefSchema } from './schemas';

const ResumeSchema = z.union([
  z.object({ approved: z.literal(true) }),
  z.object({ approved: z.literal(false), feedback: z.string().min(1) }),
]);

export const app = new Hono();

app.post('/runs', async (c) => {
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
      while (open) {
        const current = getRun(id);
        if (!current || current.status === 'done' || current.status === 'error') break;
        await stream.sleep(1000);
      }
    } finally {
      unsubscribe?.();
    }
  });
});

app.get('/drafts', (c) => c.json(listDrafts()));

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

app.use('/*', serveStatic({ root: './public' }));

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
