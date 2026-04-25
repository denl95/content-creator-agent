import { describe, expect, test } from 'bun:test';
import 'dotenv/config';
import { strategist } from '../../src/nodes/strategist';
import { makeInitialState } from '../../src/state';
import { blogBrief, linkedinBrief, twitterBrief } from '../fixtures/briefs';
import { makeJudge } from './schema';

const JUDGE_SYSTEM = `\
You are evaluating a ContentPlan produced by an AI content strategist for Lumen, a B2B SaaS accounting product.

Score the plan against these criteria (0.0–1.0 each):
- brief_alignment: Does the plan's tone, target_audience, and channel match the brief?
- outline_depth: Is the outline specific and sufficiently detailed for the given word count and channel?
- brand_safety: Does the plan avoid forbidden phrases and match Lumen's plainspoken, numbers-first voice?

Set pass=true only if ALL criteria score ≥ 0.7.`;

const judge = makeJudge(JUDGE_SYSTEM);

async function runStrategist(brief: Parameters<typeof makeInitialState>[0]) {
  const state = makeInitialState(brief);
  // @ts-expect-error — makeInitialState returns Partial; strategist accepts full state
  const patch = await strategist({
    ...state,
    plan: null,
    planApproved: false,
    userPlanFeedback: null,
    draft: null,
    editFeedback: null,
    iteration: 0,
    finalContent: null,
    messages: [],
  });
  return patch.plan!;
}

describe('Strategist judge', () => {
  test.concurrent('LinkedIn brief → plan matches tone and channel', async () => {
    const plan = await runStrategist(linkedinBrief);
    const verdict = await judge(
      `Brief:\n${JSON.stringify(linkedinBrief, null, 2)}\n\nContentPlan:\n${JSON.stringify(plan, null, 2)}`,
    );
    expect(verdict.pass).toBe(true);
  }, 60_000);

  test.concurrent('Blog brief → plan has appropriate depth', async () => {
    const plan = await runStrategist(blogBrief);
    const verdict = await judge(
      `Brief:\n${JSON.stringify(blogBrief, null, 2)}\n\nContentPlan:\n${JSON.stringify(plan, null, 2)}`,
    );
    expect(verdict.pass).toBe(true);
  }, 60_000);

  test.concurrent('Twitter brief → plan matches casual tone', async () => {
    const plan = await runStrategist(twitterBrief);
    const verdict = await judge(
      `Brief:\n${JSON.stringify(twitterBrief, null, 2)}\n\nContentPlan:\n${JSON.stringify(plan, null, 2)}`,
    );
    expect(verdict.pass).toBe(true);
  }, 60_000);
});
