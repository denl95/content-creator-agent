import { describe, expect, test } from 'bun:test';
import 'dotenv/config';
import { editor } from '../../src/nodes/editor';
import { writerFixturePlan } from '../fixtures/plans';

const BAD_DRAFT_PATH = new URL('../fixtures/bad-draft.md', import.meta.url).pathname;

describe('Editor judge', () => {
  test('Editor flags a deliberately bad draft as REVISION_NEEDED with low scores', async () => {
    const badDraftContent = await Bun.file(BAD_DRAFT_PATH).text();

    const state = {
      brief: {
        topic: 'bookkeeping',
        target_audience: 'SMB owners',
        channel: 'blog' as const,
        tone: 'professional',
        word_count: 1200,
      },
      plan: writerFixturePlan,
      draft: { content: badDraftContent, word_count: 150, keywords_used: [] },
      editFeedback: null,
      iteration: 1,
      planApproved: true,
      userPlanFeedback: null,
      finalContent: null,
      messages: [],
    };

    // @ts-expect-error — partial state is fine for node invocation
    const patch = await editor(state);
    const fb = patch.editFeedback!;

    expect(fb.verdict).toBe('REVISION_NEEDED');
    expect(fb.issues.length).toBeGreaterThanOrEqual(3);
    expect(fb.tone_score).toBeLessThan(0.6);
    expect(fb.accuracy_score).toBeLessThan(0.6);
  }, 30_000);
});
