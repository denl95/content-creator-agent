import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDraft, insertDraft, resetDbForTests, setDraftFacebookUrl } from '../../src/db';
import {
  app,
  pumpKeepalive,
  resetFacebookPageNameCache,
  SERVER_IDLE_TIMEOUT_S,
  SSE_KEEPALIVE_MS,
  SSE_POLL_MS,
} from '../../src/server';
import { freshDb } from '../helpers/db';

beforeEach(async () => {
  await freshDb();
  await insertDraft({
    id: 'd1',
    topic: 'T',
    channel: 'blog',
    tone: 'x',
    audience: 'y',
    content: '# Hi',
    word_count: 1,
    verdict: 'APPROVED',
    tone_score: 0.9,
    accuracy_score: 0.9,
    structure_score: 0.9,
    iterations: 1,
    issues: [],
  });
});

afterEach(async () => {
  await resetDbForTests();
});

describe('drafts endpoints', () => {
  test('GET /drafts lists rows', async () => {
    const res = await app.request('/drafts');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body[0]?.id).toBe('d1');
  });

  test('GET /drafts/:id returns the row, 404 when missing', async () => {
    expect((await app.request('/drafts/d1')).status).toBe(200);
    expect((await app.request('/drafts/nope')).status).toBe(404);
  });

  test('POST /drafts/:id/publish returns 400 when Notion unconfigured', async () => {
    delete process.env.NOTION_TOKEN;
    delete process.env.NOTION_DRAFTS_DATABASE_ID;
    const res = await app.request('/drafts/d1/publish', { method: 'POST' });
    expect(res.status).toBe(400);
  });
});

describe('runs endpoints', () => {
  test('GET /runs/:id 404s for unknown run', async () => {
    expect((await app.request('/runs/unknown')).status).toBe(404);
  });

  test('POST /runs validates the brief', async () => {
    const res = await app.request('/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: '' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('facebook publishing', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.FACEBOOK_PAGE_ID;
    delete process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    resetFacebookPageNameCache();
  });

  test('404 when the draft does not exist', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    const res = await app.request('/drafts/nope/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('draft_not_found');
  });

  test('400 when Facebook is unconfigured', async () => {
    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('facebook_not_configured');
  });

  test('posts the plain-text draft and stores the url', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    let sentBody = '';
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body);
      return new Response(JSON.stringify({ id: '1234_5678' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe('https://www.facebook.com/1234_5678');
    // d1's content is '# Hi' — the heading marker must not reach Facebook.
    expect(sentBody).toContain('message=Hi');
    expect((await getDraft('d1'))?.facebook_url).toBe('https://www.facebook.com/1234_5678');
  });

  test('409 on a second publish, without touching Graph', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    await setDraftFacebookUrl('d1', 'https://www.facebook.com/1_2');

    let called = false;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('facebook_already_published');
    // The whole point of the server-side guard: a stale tab must not double-post.
    expect(called).toBe(false);
  });

  test('two concurrent publish requests: exactly one posts, the other gets 409', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';

    let graphCalls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      graphCalls++;
      await gate;
      return new Response(JSON.stringify({ id: '1234_5678' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const first = app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    const second = app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    // Give both requests a chance to reach the in-flight check before either
    // Graph call resolves — this is what proves the guard, not just the outcome.
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const [firstRes, secondRes] = await Promise.all([first, second]);

    expect(graphCalls).toBe(1);
    const statuses = [firstRes.status, secondRes.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  test('502 carrying Meta’s message when Graph rejects the post', async () => {
    process.env.FACEBOOK_PAGE_ID = '1234';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: { message: 'Session has expired', code: 190 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const res = await app.request('/drafts/d1/publish/facebook', { method: 'POST' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('facebook_publish_failed');
    expect(body.message).toContain('Session has expired');
    expect((await getDraft('d1'))?.facebook_url).toBeNull();
  });

  test('status reports unconfigured without calling Graph', async () => {
    let called = false;
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const res = await app.request('/publish/facebook/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false, page_name: null });
    expect(called).toBe(false);
  });

  test('status reports the page name when configured', async () => {
    process.env.FACEBOOK_PAGE_ID = 'page-name-test';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ name: 'EONYX' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const res = await app.request('/publish/facebook/status');
    expect(await res.json()).toEqual({ configured: true, page_name: 'EONYX' });
  });

  test('a failed lookup is not cached — the next call retries', async () => {
    process.env.FACEBOOK_PAGE_ID = '61550123456789';
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = 'tok';

    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ error: { message: 'bad token', code: 190 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const first = await app.request('/publish/facebook/status');
    // A failed lookup falls back to the raw Page ID — never null, and never cached.
    expect(await first.json()).toEqual({ configured: true, page_name: '61550123456789' });

    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ name: 'EONYX' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const second = await app.request('/publish/facebook/status');
    expect(await second.json()).toEqual({ configured: true, page_name: 'EONYX' });
  });
});

describe('SSE keepalive', () => {
  function fakeStream() {
    const writes: string[] = [];
    return {
      writes,
      write: async (chunk: string) => {
        writes.push(chunk);
      },
      // Instant, so the cadence is asserted from the accounting, not wall clock.
      sleep: async () => {},
    };
  }

  test('writes a comment frame on the keepalive cadence, not every poll', async () => {
    const stream = fakeStream();
    let ticks = 0;
    await pumpKeepalive(stream, () => ticks++ < 20, { pollMs: 1000, keepaliveMs: 5000 });
    expect(stream.writes).toHaveLength(4);
    // A comment line: EventSource discards it, so it never reaches onmessage
    // and can never be mistaken for a RunEvent.
    expect(stream.writes[0]).toBe(': keepalive\n\n');
  });

  test('stops as soon as the stream closes', async () => {
    const stream = fakeStream();
    await pumpKeepalive(stream, () => false, { pollMs: 1000, keepaliveMs: 1000 });
    expect(stream.writes).toHaveLength(0);
  });

  test('cadence stays under the idle timeout that closes the socket', () => {
    // Bun.serve closes idle connections; this ordering is the whole fix.
    expect(SSE_KEEPALIVE_MS).toBeLessThan(SERVER_IDLE_TIMEOUT_S * 1000);
    expect(SSE_POLL_MS).toBeLessThanOrEqual(SSE_KEEPALIVE_MS);
  });
});
