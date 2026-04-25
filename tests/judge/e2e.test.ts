import { describe, expect, test } from 'bun:test';
import 'dotenv/config';
import { Command } from '@langchain/langgraph';
import { graph } from '../../src/graph';
import { makeInitialState } from '../../src/state';
import { e2eBrief } from '../fixtures/briefs';
import { makeJudge } from './schema';

const JUDGE_SYSTEM = `\
You are evaluating a finished article produced by an AI content pipeline for Lumen, a B2B SaaS accounting product.

Score the article against these criteria (0.0–1.0 each):
- brief_alignment: Does the article match the topic, tone, and target audience from the brief?
- brand_voice: Does it follow Lumen's plainspoken, numbers-first voice? No forbidden phrases (revolutionary, game-changer, synergy, leverage-as-verb, in today's fast-paced world, seamless, robust)?
- completeness: Is the article a complete, publication-ready piece — not a stub or outline?

Set pass=true only if ALL criteria score ≥ 0.7.`;

const judge = makeJudge(JUDGE_SYSTEM);

describe('E2E judge', () => {
  test('Full pipeline produces on-brief, brand-safe content', async () => {
    const threadId = crypto.randomUUID();
    const config = { configurable: { thread_id: threadId } };
    const initialState = makeInitialState(e2eBrief);

    // Run until first interrupt (HITL gate after Strategist)
    let interrupted = false;
    for await (const _ of await graph.stream(initialState, config)) {
      // check for interrupt in the chunk
      if ('__interrupt__' in _) {
        interrupted = true;
        break;
      }
    }

    expect(interrupted).toBe(true);

    // Auto-approve the plan and run to completion
    for await (const _ of await graph.stream(
      // @ts-expect-error — Command type is intentionally untyped here
      new Command({ resume: { approved: true } }),
      config,
    )) {
      // drain the stream
    }

    const finalState = await graph.getState(config);
    const finalContent = finalState.values.finalContent as string | null;

    expect(finalContent).toBeTruthy();
    expect(typeof finalContent).toBe('string');

    const verdict = await judge(
      `Brief:\n${JSON.stringify(e2eBrief, null, 2)}\n\nFinal article:\n${finalContent}`,
    );

    expect(verdict.pass).toBe(true);
  }, 180_000); // 3-minute budget for full pipeline
});
