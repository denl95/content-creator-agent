import { mergeConfigs, type RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../activity';
import { MAX_ITERATIONS } from '../constants';
import { makeChatModel } from '../model';
import { traceOptions } from '../observability';
import { compileManagedPrompt, editorVariables } from '../prompts/managed';
import { deriveVerdict } from '../routing/verdict';
import { EditorAssessmentSchema } from '../schemas';
import type { GraphStateType } from '../state';
import { lookupBrandStyle } from '../tools/rag';

const editorLLM = makeChatModel().withStructuredOutput(EditorAssessmentSchema, {
  name: 'edit_feedback',
});

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
  reportActivity(threadId, {
    step: 'editor',
    kind: 'reviewing',
    detail: `pass ${state.iteration} of ${MAX_ITERATIONS}`,
  });
  const brandStyle = await lookupBrandStyle(
    `${state.brief.channel} tone of voice rules, forbidden phrases, style guide`,
    state.brief.brand_id,
    threadId,
  );
  const prompt = await compileManagedPrompt(
    'editor',
    editorVariables(state.plan, state.brief, state.draft.content, brandStyle),
  );

  const assessment = await editorLLM.invoke(
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

  // The model scores; this codebase decides. See src/routing/verdict.ts.
  const editFeedback = { ...assessment, verdict: deriveVerdict(assessment) };

  reportActivity(threadId, {
    step: 'editor',
    kind: 'verdict',
    detail: `${editFeedback.verdict} · tone ${assessment.tone_score} · accuracy ${assessment.accuracy_score} · structure ${assessment.structure_score}`,
  });

  return { editFeedback };
}
