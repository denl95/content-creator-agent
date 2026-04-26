import type { RunnableConfig } from '@langchain/core/runnables';
import { createAgent } from 'langchain';
import { model } from '../model';
import { traceOptions } from '../observability';
import { buildWriterMessage, WRITER_SYSTEM } from '../prompts/writer';
import { DraftContentSchema } from '../schemas';
import type { GraphStateType } from '../state';
import { searchTool } from '../tools/index';

const writerAgent = createAgent({
  model,
  tools: [searchTool],
  responseFormat: DraftContentSchema,
  systemPrompt: WRITER_SYSTEM,
});

export async function writer(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;

  if (!state.plan) throw new Error('writer: state.plan is missing — check HITL approval flow');

  const iteration = state.iteration + 1;
  const hasPriorDraft = state.draft && state.editFeedback;
  const prior = hasPriorDraft ? { draft: state.draft!, feedback: state.editFeedback! } : null;

  const result = await writerAgent.invoke(
    { messages: [{ role: 'user', content: buildWriterMessage(state.plan!, prior) }] },
    {
      runName: `writer-iter-${iteration}`,
      tags: ['writer', `iteration:${iteration}`],
      ...traceOptions(threadId, { agent: 'writer', iteration }),
    },
  );

  if (!result.structuredResponse) throw new Error('writer: LLM returned no structured response — check model and responseFormat');

  return {
    draft: result.structuredResponse,
    iteration,
  };
}
