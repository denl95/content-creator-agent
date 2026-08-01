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
