import { afterEach, describe, expect, test } from 'bun:test';
import {
  getDraft,
  insertDraft,
  listDrafts,
  resetDbForTests,
  setDraftCost,
  setDraftNotionUrl,
} from '../../src/db';
import { freshDb } from '../helpers/db';

afterEach(async () => {
  await resetDbForTests();
});

function sampleDraft(id: string) {
  return {
    id,
    topic: 'AI onboarding automation',
    channel: 'blog',
    tone: 'accessible',
    audience: 'SMB owners',
    content: '# Hello\n\nBody text.',
    word_count: 3,
    verdict: 'APPROVED' as string | null,
    tone_score: 0.9 as number | null,
    accuracy_score: 0.85 as number | null,
    structure_score: 0.9 as number | null,
    iterations: 2,
    issues: [] as string[],
  };
}

describe('drafts db', () => {
  test('insert, get, list round-trip', async () => {
    await freshDb();
    await insertDraft(sampleDraft('t1'));
    await insertDraft(sampleDraft('t2'));
    expect(await listDrafts()).toHaveLength(2);
    const row = await getDraft('t1');
    expect(row?.topic).toBe('AI onboarding automation');
    expect(row?.notion_url).toBeNull();
    expect(JSON.parse(row?.issues ?? '[]')).toEqual([]);
  });

  test('re-running the same topic never overwrites (distinct ids)', async () => {
    await freshDb();
    await insertDraft(sampleDraft('run-1'));
    await insertDraft(sampleDraft('run-2'));
    expect(await listDrafts()).toHaveLength(2);
  });

  test('cost and notion url write-backs', async () => {
    await freshDb();
    await insertDraft(sampleDraft('t1'));
    await setDraftCost('t1', 0.031);
    await setDraftNotionUrl('t1', 'https://notion.so/x');
    const row = await getDraft('t1');
    expect(row?.cost_usd).toBeCloseTo(0.031);
    expect(row?.notion_url).toBe('https://notion.so/x');
  });

  test('getDraft returns null for unknown id', async () => {
    await freshDb();
    expect(await getDraft('missing')).toBeNull();
  });

  test('rows keep their snake_case wire shape', async () => {
    await freshDb();
    await insertDraft(sampleDraft('shape-1'));
    const row = await getDraft('shape-1');
    expect(row).not.toBeNull();
    // web/lib/types.ts mirrors these names by hand — renaming any of them
    // breaks the dashboard silently, so they are asserted explicitly.
    for (const key of [
      'word_count',
      'tone_score',
      'accuracy_score',
      'structure_score',
      'cost_usd',
      'notion_url',
      'created_at',
    ]) {
      expect(Object.hasOwn(row as object, key)).toBe(true);
    }
    expect(row?.created_at).toBeTypeOf('string');
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('brand_id round-trips so the dashboard can attribute a draft', async () => {
    await freshDb();
    await insertDraft({ ...sampleDraft('b1'), brand_id: 'brand-xyz' });
    expect((await getDraft('b1'))?.brand_id).toBe('brand-xyz');
    await insertDraft(sampleDraft('b2'));
    expect((await getDraft('b2'))?.brand_id).toBeNull();
  });
});
