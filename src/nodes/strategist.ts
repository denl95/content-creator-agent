import type { RunnableConfig } from '@langchain/core/runnables';
import { createAgent } from 'langchain';
import { model } from '../model';
import { traceOptions } from '../observability';
import { buildStrategistMessage, STRATEGIST_SYSTEM } from '../prompts/strategist';
import { ContentPlanSchema } from '../schemas';
import type { GraphStateType } from '../state';
import { brandStyleRetriever, searchTool } from '../tools/index';

const strategistAgent = createAgent({
  model,
  tools: [searchTool, brandStyleRetriever],
  responseFormat: ContentPlanSchema,
  systemPrompt: STRATEGIST_SYSTEM,
});

export async function strategist(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const isRevision = Boolean(state.userPlanFeedback);

  const result = await strategistAgent.invoke(
    {
      messages: [
        { role: 'user', content: buildStrategistMessage(state.brief, state.userPlanFeedback) },
      ],
    },
    {
      runName: isRevision ? 'strategist-revision' : 'strategist',
      tags: ['strategist', isRevision ? 'revision' : 'initial'],
      ...traceOptions(threadId, { agent: 'strategist', is_revision: isRevision }),
    },
  );

  return {
    plan: result.structuredResponse,
    userPlanFeedback: null,
  };
}
