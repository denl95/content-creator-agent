import { ChatOpenAI } from '@langchain/openai';

export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 120_000);

// gpt-5.x reasoning models reject function tools over /v1/chat/completions unless
// reasoning_effort is 'none'. LangChain only forwards `reasoningEffort` as a *call-time*
// option (its constructor never reads it — see _getReasoningParams in
// @langchain/openai/dist/chat_models/base.js), so it has to be applied via withConfig().
// Leave OPENAI_REASONING_EFFORT unset for non-reasoning models like gpt-4o-mini.
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT as
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | undefined;

export function makeChatModel(): ChatOpenAI {
  const llm = new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    timeout: LLM_TIMEOUT_MS,
  });
  // withConfig() returns a RunnableBinding, which createAgent/bindTools both accept
  // (see _simpleBindTools in langchain/dist/agents/utils.js) — the cast keeps the
  // ChatOpenAI-shaped type its callers expect.
  return REASONING_EFFORT
    ? (llm.withConfig({ reasoningEffort: REASONING_EFFORT }) as unknown as ChatOpenAI)
    : llm;
}

export const model = makeChatModel();
