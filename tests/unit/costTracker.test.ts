import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

  test('computes cost from the configured per-1M rates', () => {
    // Bun auto-loads .env, so the rates are pinned here rather than inherited
    // from whatever the developer has configured — and restored afterwards,
    // since warnOnPriceMismatch below keys on whether they are set at all.
    const saved = [process.env.PRICE_INPUT_PER_1M, process.env.PRICE_OUTPUT_PER_1M] as const;
    process.env.PRICE_INPUT_PER_1M = '0.15';
    process.env.PRICE_OUTPUT_PER_1M = '0.60';
    try {
      const tracker = new CostTracker();
      tracker.handleLLMEnd(fakeResult(1_000_000, 1_000_000));
      expect(tracker.costUsd()).toBeCloseTo(0.15 + 0.6, 5);
    } finally {
      for (const [key, value] of [
        ['PRICE_INPUT_PER_1M', saved[0]],
        ['PRICE_OUTPUT_PER_1M', saved[1]],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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
  // Bun auto-loads .env, and a developer with real rates configured would
  // otherwise make every one of these assertions vacuous. The suite owns the
  // variables outright and restores them afterwards.
  const KEYS = ['PRICE_INPUT_PER_1M', 'PRICE_OUTPUT_PER_1M'] as const;
  let saved: Array<string | undefined> = [];

  beforeEach(() => {
    saved = KEYS.map((key) => process.env[key]);
    for (const key of KEYS) delete process.env[key];
  });

  afterEach(() => {
    KEYS.forEach((key, i) => {
      const value = saved[i];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

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
  });

  test('stays quiet when no model is configured at all', () => {
    // Passing undefined would fall through to the default parameter and read
    // OPENAI_MODEL, so "unconfigured" has to be expressed on the environment.
    const savedModel = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    try {
      expect(warnOnPriceMismatch(undefined, () => {})).toBe(false);
    } finally {
      if (savedModel !== undefined) process.env.OPENAI_MODEL = savedModel;
    }
  });
});
