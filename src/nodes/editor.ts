import { mergeConfigs, type RunnableConfig } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';
import { LLM_TIMEOUT_MS } from '../model';
import { traceOptions } from '../observability';
import { compileManagedPrompt, editorVariables } from '../prompts/managed';
import { EditFeedbackSchema } from '../schemas';
import type { GraphStateType } from '../state';
import { lookupBrandStyle } from '../tools/rag';

const editorLLM = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  timeout: LLM_TIMEOUT_MS,
}).withStructuredOutput(EditFeedbackSchema, { name: 'edit_feedback' });

export async function editor(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;

  if (!state.plan)
    throw new Error('editor: state.plan is missing — check routing from hitl/strategist');
  if (!state.brief) throw new Error('editor: state.brief is missing');
  if (!state.draft?.content)
    throw new Error('editor: state.draft is missing — check routing from writer');
  const brandStyle = await lookupBrandStyle(
    `${state.brief.channel} tone of voice rules, forbidden phrases, style guide`,
  );
  const prompt = await compileManagedPrompt(
    'editor',
    editorVariables(state.plan, state.brief, state.draft.content, brandStyle),
  );

  const editFeedback = await editorLLM.invoke(
    prompt.messages,
    mergeConfigs(config, {
      runName: `editor-iter-${state.iteration}`,
      tags: ['editor', `iteration:${state.iteration}`],
      ...traceOptions(threadId, {
        agent: 'editor',
        iteration: state.iteration,
        ...(prompt.langfusePrompt ? { langfusePrompt: prompt.langfusePrompt } : {}),
      }),
    }),
  );

  return { editFeedback };
}
