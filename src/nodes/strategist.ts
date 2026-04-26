import type { RunnableConfig } from '@langchain/core/runnables';
import { createAgent } from 'langchain';
import { model } from '../model';
import { traceOptions } from '../observability';
import { compileManagedPrompt, strategistVariables } from '../prompts/managed';
import { ContentPlanSchema } from '../schemas';
import type { GraphStateType } from '../state';
import { brandStyleRetriever, searchTool } from '../tools/index';

export async function strategist(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const isRevision = Boolean(state.userPlanFeedback);
  const prompt = await compileManagedPrompt(
    'strategist',
    strategistVariables(state.brief, state.userPlanFeedback),
  );
  const systemPrompt = prompt.messages.find((message) => message.role === 'system')?.content;
  const messages = prompt.messages.filter((message) => message.role !== 'system');
  const strategistAgent = createAgent({
    model,
    tools: [searchTool, brandStyleRetriever],
    responseFormat: ContentPlanSchema,
    ...(systemPrompt ? { systemPrompt } : {}),
  });

  const result = await strategistAgent.invoke(
    {
      messages,
    },
    {
      runName: isRevision ? 'strategist-revision' : 'strategist',
      tags: ['strategist', isRevision ? 'revision' : 'initial'],
      ...traceOptions(threadId, {
        agent: 'strategist',
        is_revision: isRevision,
        ...(prompt.langfusePrompt ? { langfusePrompt: prompt.langfusePrompt } : {}),
      }),
    },
  );

  if (!result.structuredResponse)
    throw new Error(
      'strategist: LLM returned no structured response — check model and responseFormat',
    );

  return {
    plan: result.structuredResponse,
    userPlanFeedback: null,
  };
}
