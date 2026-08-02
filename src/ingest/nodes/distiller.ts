import { mergeConfigs, type RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../../activity';
import { makeChatModel } from '../../model';
import { traceOptions } from '../../observability';
import { compileManagedPrompt, distillerVariables } from '../../prompts/managed';
import { assembleCorpusInput } from '../render';
import { DistillationSchema } from '../schemas';
import type { IngestStateType } from '../state';

const CORPUS_BUDGET = 60_000;

const distillerLLM = makeChatModel().withStructuredOutput(DistillationSchema, {
  name: 'distillation',
});

export async function distiller(
  state: IngestStateType,
  config?: RunnableConfig,
): Promise<Partial<IngestStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const isRevision = Boolean(state.reviewFeedback);

  reportActivity(threadId, {
    step: 'distiller',
    kind: isRevision ? 'redistilling' : 'distilling',
    detail: isRevision
      ? `revising: "${state.reviewFeedback}"`
      : `reading ${state.rawDocs.length} document(s)`,
  });

  const corpus = assembleCorpusInput(state.rawDocs, CORPUS_BUDGET);
  const prompt = await compileManagedPrompt(
    'distiller',
    distillerVariables(corpus, state.reviewFeedback),
  );

  const distillation = await distillerLLM.invoke(
    prompt.messages,
    // Same mergeConfigs contract as every other node — without it the
    // CostTracker attached at graph.stream() never sees this call.
    mergeConfigs(config, {
      runName: isRevision ? 'distiller-revision' : 'distiller',
      tags: ['distiller', isRevision ? 'revision' : 'initial'],
      ...traceOptions(threadId, {
        agent: 'distiller',
        is_revision: isRevision,
        ...(prompt.langfusePrompt ? { langfusePrompt: prompt.langfusePrompt } : {}),
      }),
    }),
  );

  reportActivity(threadId, {
    step: 'distiller',
    kind: 'distilled',
    detail: `${distillation.exemplars.length} exemplars · language ${distillation.style_guide.language}`,
  });

  return { distillation, reviewFeedback: null };
}
