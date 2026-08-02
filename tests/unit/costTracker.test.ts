import { describe, expect, test } from 'bun:test';
import type { LLMResult } from '@langchain/core/outputs';
import { CostTracker, warnOnPriceMismatch } from '../../src/costTracker';

function fakeResult(promptTokens: number, completionTokens: number): LLMResult {
  return {
    generations: [],
    llmOutput: { tokenUsage: { promptTokens, completionTokens } },
  };
}

describe('CostTracker', () => {
  test('accumulates token usage across calls', () => {
    const tracker = new CostTracker();
    tracker.handleLLMEnd(fakeResult(1000, 500));
    tracker.handleLLMEnd(fakeResult(200, 100));
    expect(tracker.inputTokens).toBe(1200);
    expect(tracker.outputTokens).toBe(600);
    expect(tracker.totalTokens()).toBe(1800);
  });

  test('computes cost from default gpt-4o-mini pricing', () => {
    const tracker = new CostTracker();
    tracker.handleLLMEnd(fakeResult(1_000_000, 1_000_000));
    expect(tracker.costUsd()).toBeCloseTo(0.15 + 0.6, 5);
  });

  test('falls back to usage_metadata on generation messages', () => {
    const tracker = new CostTracker();
    tracker.handleLLMEnd({
      generations: [
        [{ text: '', message: { usage_metadata: { input_tokens: 10, output_tokens: 5 } } }],
      ],
    } as unknown as LLMResult);
    expect(tracker.inputTokens).toBe(10);
    expect(tracker.outputTokens).toBe(5);
  });
});

describe('warnOnPriceMismatch', () => {
  test('warns when the model is not the one the defaults price', () => {
    const seen: string[] = [];
    expect(warnOnPriceMismatch('gpt-5.6-luna', (m) => seen.push(m))).toBe(true);
    expect(seen[0]).toContain('gpt-5.6-luna');
    expect(seen[0]).toContain('gpt-4o-mini rates');
  });

  test('stays quiet for the model the defaults actually price', () => {
    expect(warnOnPriceMismatch('gpt-4o-mini', () => {})).toBe(false);
  });

  test('stays quiet once prices are configured, whatever the model', () => {
    process.env.PRICE_INPUT_PER_1M = '1.25';
    expect(warnOnPriceMismatch('gpt-5.6-luna', () => {})).toBe(false);
    process.env.PRICE_INPUT_PER_1M = undefined as unknown as string;
    delete process.env.PRICE_INPUT_PER_1M;
  });

  test('stays quiet when no model is configured at all', () => {
    // Passing undefined would fall through to the default parameter and read
    // OPENAI_MODEL, so "unconfigured" has to be expressed on the environment.
    const saved = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    try {
      expect(warnOnPriceMismatch(undefined, () => {})).toBe(false);
    } finally {
      if (saved !== undefined) process.env.OPENAI_MODEL = saved;
    }
  });
});
