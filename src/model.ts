import { ChatOpenAI } from '@langchain/openai';

export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 120_000);

export const model = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  timeout: LLM_TIMEOUT_MS,
});
