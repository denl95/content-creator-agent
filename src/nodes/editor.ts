import type { RunnableConfig } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';
import { traceOptions } from '../observability';
import { compileManagedPrompt, editorVariables } from '../prompts/managed';
import { EditFeedbackSchema } from '../schemas';
import type { GraphStateType } from '../state';

const editorLLM = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
}).withStructuredOutput(EditFeedbackSchema, { name: 'edit_feedback' });

export async function editor(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;

  if (!state.plan)
    throw new Error('editor: state.plan is missing — check routing from hitl/strategist');
  if (!state.draft?.content)
    throw new Error('editor: state.draft is missing — check routing from writer');
  const prompt = await compileManagedPrompt(
    'editor',
    editorVariables(state.plan, state.draft.content),
  );

  const editFeedback = await editorLLM.invoke(prompt.messages, {
    runName: `editor-iter-${state.iteration}`,
    tags: ['editor', `iteration:${state.iteration}`],
    ...traceOptions(threadId, {
      agent: 'editor',
      iteration: state.iteration,
      ...(prompt.langfusePrompt ? { langfusePrompt: prompt.langfusePrompt } : {}),
    }),
  });

  return { editFeedback };
}
