import { afterEach, describe, expect, test } from 'bun:test';
import {
  getDb,
  getDraft,
  insertDraft,
  listDrafts,
  resetDbForTests,
  setDraftCost,
  setDraftNotionUrl,
} from '../../src/db';

afterEach(() => resetDbForTests());

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
  test('insert, get, list round-trip', () => {
    getDb(':memory:');
    insertDraft(sampleDraft('t1'));
    insertDraft(sampleDraft('t2'));
    expect(listDrafts()).toHaveLength(2);
    const row = getDraft('t1');
    expect(row?.topic).toBe('AI onboarding automation');
    expect(row?.notion_url).toBeNull();
    expect(JSON.parse(row?.issues ?? '[]')).toEqual([]);
  });

  test('re-running the same topic never overwrites (distinct ids)', () => {
    getDb(':memory:');
    insertDraft(sampleDraft('run-1'));
    insertDraft(sampleDraft('run-2'));
    expect(listDrafts()).toHaveLength(2);
  });

  test('cost and notion url write-backs', () => {
    getDb(':memory:');
    insertDraft(sampleDraft('t1'));
    setDraftCost('t1', 0.031);
    setDraftNotionUrl('t1', 'https://notion.so/x');
    const row = getDraft('t1');
    expect(row?.cost_usd).toBeCloseTo(0.031);
    expect(row?.notion_url).toBe('https://notion.so/x');
  });

  test('getDraft returns null for unknown id', () => {
    getDb(':memory:');
    expect(getDraft('missing')).toBeNull();
  });
});
