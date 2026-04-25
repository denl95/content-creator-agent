import { describe, expect, test } from 'bun:test';
import 'dotenv/config';
import { writer } from '../../src/nodes/writer';
import { writerFixturePlan } from '../fixtures/plans';
import { makeJudge } from './schema';

const JUDGE_SYSTEM = `\
You are evaluating a draft article produced by an AI writer for Lumen, a B2B SaaS accounting product.

Score the draft against these criteria (0.0–1.0 each):
- outline_coverage: Does the draft explicitly address every outline item from the plan?
- keyword_integration: Are the required keywords woven in naturally (not stuffed)?
- tone_match: Does the draft match the required tone and Lumen's plainspoken, numbers-first brand voice?

Set pass=true only if ALL criteria score ≥ 0.7.`;

const judge = makeJudge(JUDGE_SYSTEM);

function keywordsPresent(content: string, keywords: string[]): number {
  const lower = content.toLowerCase();
  const present = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
  return present.length / keywords.length;
}

describe('Writer judge', () => {
  test('Draft covers all outline items and uses keywords', async () => {
    const state = {
      brief: {
        topic: 'bookkeeping automation',
        target_audience: 'SMB owners',
        channel: 'blog' as const,
        tone: 'professional',
        word_count: 1200,
      },
      plan: writerFixturePlan,
      draft: null,
      editFeedback: null,
      iteration: 0,
      planApproved: true,
      userPlanFeedback: null,
      finalContent: null,
      messages: [],
    };

    // @ts-expect-error — partial state is fine for node invocation
    const patch = await writer(state);
    const draft = patch.draft!;

    // Harness check: keyword coverage ≥ 75% (no LLM needed)
    const coverage = keywordsPresent(draft.content, writerFixturePlan.keywords);
    expect(coverage).toBeGreaterThanOrEqual(0.75);

    // LLM judge: outline coverage + tone
    const verdict = await judge(
      `ContentPlan:\n${JSON.stringify(writerFixturePlan, null, 2)}\n\nDraft:\n${draft.content}`,
    );
    expect(verdict.pass).toBe(true);
  }, 90_000);
});
