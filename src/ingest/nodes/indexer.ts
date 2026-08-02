import type { RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../../activity';
import { getDb } from '../../db';
import { reindex } from '../../tools/rag';
import { renderProfile, renderStyleGuide } from '../render';
import type { IngestStateType } from '../state';

export async function indexer(
  state: IngestStateType,
  config?: RunnableConfig,
): Promise<Partial<IngestStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const { distillation, request, rawDocs } = state;
  if (!distillation) throw new Error('indexer: nothing distilled — check the review gate');

  const db = getDb();
  const brandId = request.brandId;

  // Re-ingestion replaces the corpus rather than appending to it.
  await db.brandDocument.deleteMany({ where: { brandId } });

  await db.brandDocument.create({
    data: {
      brandId,
      kind: 'profile',
      title: 'Brand overview',
      content: renderProfile(distillation.profile),
      included: true,
    },
  });
  await db.brandDocument.create({
    data: {
      brandId,
      kind: 'style_guide',
      title: 'Content style guide',
      content: renderStyleGuide(distillation.style_guide),
      included: true,
    },
  });
  for (const exemplar of distillation.exemplars) {
    await db.brandDocument.create({
      data: {
        brandId,
        kind: 'exemplar',
        title: exemplar.title,
        content: exemplar.content,
        included: true,
      },
    });
  }
  // Provenance: kept so a claim can be traced back to its page, never embedded.
  for (const doc of rawDocs) {
    await db.brandDocument.create({
      data: { brandId, kind: 'raw_page', title: doc.title, content: doc.text, included: false },
    });
  }

  await db.brand.update({
    where: { id: brandId },
    data: { status: 'active', language: distillation.style_guide.language },
  });

  reportActivity(threadId, {
    step: 'indexer',
    kind: 'indexing',
    detail: `${distillation.exemplars.length + 2} documents, ${rawDocs.length} kept for provenance`,
  });
  await reindex(brandId);
  reportActivity(threadId, { step: 'indexer', kind: 'indexed', detail: 'brand is active' });
  return {};
}
