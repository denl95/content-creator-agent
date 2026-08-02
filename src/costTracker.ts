import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

/** The defaults are gpt-4o-mini's published rates, and only correct for it. */
const DEFAULT_PRICED_MODEL = 'gpt-4o-mini';
const DEFAULT_PRICE_INPUT_PER_1M = 0.15;
const DEFAULT_PRICE_OUTPUT_PER_1M = 0.6;

const PRICE_INPUT_PER_1M = Number(process.env.PRICE_INPUT_PER_1M ?? DEFAULT_PRICE_INPUT_PER_1M);
const PRICE_OUTPUT_PER_1M = Number(process.env.PRICE_OUTPUT_PER_1M ?? DEFAULT_PRICE_OUTPUT_PER_1M);

/**
 * Every reported cost is a lie when the model is priced differently from the
 * defaults and nobody set PRICE_*. That is not hypothetical: this project ran
 * for months on `gpt-5.6-luna` while reporting gpt-4o-mini rates, and the
 * dashboard's headline "Total spend" tile is the first number a client checks.
 *
 * Silence was the actual bug — a wrong price looks exactly like a right one.
 * Warning once at startup is cheap; a hard failure would be worse, since cost
 * reporting must never be able to stop a run.
 */
export function warnOnPriceMismatch(
  model = process.env.OPENAI_MODEL,
  log: (message: string) => void = console.warn,
): boolean {
  const configured =
    process.env.PRICE_INPUT_PER_1M !== undefined || process.env.PRICE_OUTPUT_PER_1M !== undefined;
  if (configured) return false;
  if (!model || model === DEFAULT_PRICED_MODEL) return false;

  log(
    `[costTracker] OPENAI_MODEL is "${model}" but PRICE_INPUT_PER_1M/PRICE_OUTPUT_PER_1M are unset, ` +
      `so costs are being reported at ${DEFAULT_PRICED_MODEL} rates ` +
      `($${DEFAULT_PRICE_INPUT_PER_1M}/$${DEFAULT_PRICE_OUTPUT_PER_1M} per 1M). Every figure shown is wrong. ` +
      'Set both to the rates for your model.',
  );
  return true;
}

warnOnPriceMismatch();

type UsageMetadata = { input_tokens?: number; output_tokens?: number };

export class CostTracker extends BaseCallbackHandler {
  name = 'cost_tracker';
  inputTokens = 0;
  outputTokens = 0;

  handleLLMEnd(output: LLMResult): void {
    const usage = output.llmOutput?.tokenUsage as
      | { promptTokens?: number; completionTokens?: number }
      | undefined;
    if (usage?.promptTokens || usage?.completionTokens) {
      this.inputTokens += usage.promptTokens ?? 0;
      this.outputTokens += usage.completionTokens ?? 0;
      return;
    }
    for (const generationList of output.generations) {
      for (const generation of generationList) {
        const meta = (generation as { message?: { usage_metadata?: UsageMetadata } }).message
          ?.usage_metadata;
        if (meta) {
          this.inputTokens += meta.input_tokens ?? 0;
          this.outputTokens += meta.output_tokens ?? 0;
        }
      }
    }
  }

  totalTokens(): number {
    return this.inputTokens + this.outputTokens;
  }

  costUsd(): number {
    return (
      (this.inputTokens * PRICE_INPUT_PER_1M + this.outputTokens * PRICE_OUTPUT_PER_1M) / 1_000_000
    );
  }

  overBudget(): boolean {
    const cap = Number(process.env.MAX_RUN_TOKENS ?? 0);
    return cap > 0 && this.totalTokens() > cap;
  }
}
