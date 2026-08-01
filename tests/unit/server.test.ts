import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb, insertDraft, resetDbForTests } from '../../src/db';
import { app } from '../../src/server';

beforeEach(() => {
  getDb(':memory:');
  insertDraft({
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

afterEach(() => resetDbForTests());

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
