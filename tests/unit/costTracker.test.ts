import { describe, expect, test } from 'bun:test';
import type { LLMResult } from '@langchain/core/outputs';

import { CostTracker } from '../../src/costTracker';

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

  test('computes cost from the configured per-1M rates', () => {
    // Bun auto-loads .env, so the rates are pinned here rather than inherited
    // from whatever the developer has configured.
    process.env.PRICE_INPUT_PER_1M = '0.15';
    process.env.PRICE_OUTPUT_PER_1M = '0.60';
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
