import type { RunnableConfig } from '@langchain/core/runnables';
import { createAgent } from 'langchain';
import { model } from '../model';
import { traceOptions } from '../observability';
import { buildWriterMessage, WRITER_SYSTEM } from '../prompts/writer';
import { DraftContentSchema } from '../schemas';
import type { GraphStateType } from '../state';
import { saveContent, searchTool } from '../tools/index';

const writerAgent = createAgent({
  model,
  tools: [searchTool, saveContent],
  responseFormat: DraftContentSchema,
  systemPrompt: WRITER_SYSTEM,
});

export async function writer(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
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

  return {
    draft: result.structuredResponse,
    iteration,
  };
}
