import type { RunnableConfig } from '@langchain/core/runnables';
import { createAgent } from 'langchain';
import { model } from '../model';
import { traceOptions } from '../observability';
import { compileManagedPrompt, writerVariables } from '../prompts/managed';
import { DraftContentSchema } from '../schemas';
import type { GraphStateType } from '../state';
import { searchTool } from '../tools/index';

export async function writer(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;

  if (!state.plan) throw new Error('writer: state.plan is missing — check HITL approval flow');

  const iteration = state.iteration + 1;
  const prior =
    state.draft && state.editFeedback ? { draft: state.draft, feedback: state.editFeedback } : null;
  const prompt = await compileManagedPrompt('writer', writerVariables(state.plan, prior));
  const systemPrompt = prompt.messages.find((message) => message.role === 'system')?.content;
  const messages = prompt.messages.filter((message) => message.role !== 'system');
  const writerAgent = createAgent({
    model,
    tools: [searchTool],
    responseFormat: DraftContentSchema,
    ...(systemPrompt ? { systemPrompt } : {}),
  });

  const result = await writerAgent.invoke(
    { messages },
    {
      runName: `writer-iter-${iteration}`,
      tags: ['writer', `iteration:${iteration}`],
      ...traceOptions(threadId, {
        agent: 'writer',
        iteration,
        ...(prompt.langfusePrompt ? { langfusePrompt: prompt.langfusePrompt } : {}),
      }),
    },
  );

  if (!result.structuredResponse)
    throw new Error('writer: LLM returned no structured response — check model and responseFormat');

  return {
    draft: result.structuredResponse,
    iteration,
  };
}
