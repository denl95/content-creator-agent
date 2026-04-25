import type { RunnableConfig } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';
import { traceOptions } from '../observability';
import { buildEditorMessage, EDITOR_SYSTEM } from '../prompts/editor';
import { EditFeedbackSchema } from '../schemas';
import type { GraphStateType } from '../state';

const editorLLM = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  temperature: 0,
}).withStructuredOutput(EditFeedbackSchema, { name: 'edit_feedback' });

export async function editor(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;

  const editFeedback = await editorLLM.invoke(
    [
      { role: 'system', content: EDITOR_SYSTEM },
      { role: 'user', content: buildEditorMessage(state.plan!, state.draft!.content) },
    ],
    {
      runName: `editor-iter-${state.iteration}`,
      tags: ['editor', `iteration:${state.iteration}`],
      ...traceOptions(threadId, { agent: 'editor', iteration: state.iteration }),
    },
  );

  return { editFeedback };
}
