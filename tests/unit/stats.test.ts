import { afterEach, describe, expect, test } from 'bun:test';
import { getDb, getStats, insertDraft, resetDbForTests } from '../../src/db';

afterEach(() => resetDbForTests());

function draft(id: string, over: Partial<Parameters<typeof insertDraft>[0]> = {}) {
  return {
    id,
    topic: 'T',
    channel: 'blog',
    tone: 'professional',
    audience: 'SMB owners',
    content: 'body',
    word_count: 100,
    verdict: 'APPROVED' as string | null,
    tone_score: 0.9 as number | null,
    accuracy_score: 0.8 as number | null,
    structure_score: 0.7 as number | null,
    iterations: 2,
    issues: [] as string[],
    ...over,
  };
}

describe('getStats', () => {
  test('returns zeros on an empty database, never NaN', () => {
    getDb(':memory:');
    const s = getStats();
    expect(s.totalDrafts).toBe(0);
    expect(s.approvedCount).toBe(0);
    expect(s.approvalRate).toBe(0);
    expect(s.totalCostUsd).toBe(0);
    expect(s.avgIterations).toBe(0);
    expect(Number.isNaN(s.approvalRate)).toBe(false);
    expect(s.byChannel).toEqual([]);
    expect(s.spendByDay).toEqual([]);
  });

  test('computes totals, approval rate and average scores', () => {
    getDb(':memory:');
    insertDraft(draft('a'));
    insertDraft(draft('b', { verdict: 'REVISION_NEEDED', iterations: 4, tone_score: 0.5 }));
    const s = getStats();
    expect(s.totalDrafts).toBe(2);
    expect(s.approvedCount).toBe(1);
    expect(s.approvalRate).toBeCloseTo(0.5, 5);
    expect(s.avgIterations).toBeCloseTo(3, 5);
    expect(s.avgScores.tone).toBeCloseTo(0.7, 5);
  });

  test('groups by channel, most frequent first', () => {
    getDb(':memory:');
    insertDraft(draft('a', { channel: 'blog' }));
    insertDraft(draft('b', { channel: 'twitter' }));
    insertDraft(draft('c', { channel: 'twitter' }));
    const s = getStats();
    expect(s.byChannel[0]).toEqual({ channel: 'twitter', count: 2 });
    expect(s.byChannel[1]).toEqual({ channel: 'blog', count: 1 });
  });

  test('sums cost per day in ascending date order', () => {
    getDb(':memory:');
    insertDraft(draft('a'));
    insertDraft(draft('b'));
    const s = getStats();
    expect(s.spendByDay).toHaveLength(1);
    expect(s.spendByDay[0]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.spendByDay[0]?.costUsd).toBe(0);
  });
});
