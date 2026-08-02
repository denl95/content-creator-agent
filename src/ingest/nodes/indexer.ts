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
  // A live ingest returned three of five exemplars with an empty title — the
  // model treats it as optional when the source is one continuous page. The
  // content is what matters, but the title is a heading in the UI, so it falls
  // back to the opening words rather than rendering blank.
  const exemplarTitle = (title: string, content: string, index: number): string => {
    if (title.trim()) return title.trim();
    const opening = content.trim().split('\n')[0]?.slice(0, 60).trim();
    return opening ? `${opening}…` : `Exemplar ${index + 1}`;
  };

  for (const [index, exemplar] of distillation.exemplars.entries()) {
    await db.brandDocument.create({
      data: {
        brandId,
        kind: 'exemplar',
        title: exemplarTitle(exemplar.title, exemplar.content, index),
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
