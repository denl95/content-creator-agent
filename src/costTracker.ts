import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';

const PRICE_INPUT_PER_1M = Number(process.env.PRICE_INPUT_PER_1M ?? 0.15);
const PRICE_OUTPUT_PER_1M = Number(process.env.PRICE_OUTPUT_PER_1M ?? 0.6);

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
