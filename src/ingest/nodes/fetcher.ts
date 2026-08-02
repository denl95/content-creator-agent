import type { RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../../activity';
import { getDb } from '../../db';
import { fetcherFor } from '../fetchers/index';
import type { IngestStateType } from '../state';
import type { RawDoc } from '../types';

export async function fetcher(
  state: IngestStateType,
  config?: RunnableConfig,
): Promise<Partial<IngestStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const { brandId, sources } = state.request;

  reportActivity(threadId, {
    step: 'fetcher',
    kind: 'fetching',
    detail: `${sources.length} source(s)`,
  });

  // Re-ingestion replays the recorded sources, so the old rows are replaced
  // rather than accumulated.
  const db = getDb();
  await db.brandSource.deleteMany({ where: { brandId } });

  const docs: RawDoc[] = [];
  for (const spec of sources) {
    const impl = fetcherFor(spec.kind);
    if (!impl) throw new Error(`Source kind "${spec.kind}" is not available`);
    const fetched = await impl.fetch(spec, threadId);
    docs.push(...fetched);
    await db.brandSource.create({
      data: {
        brandId,
        kind: spec.kind,
        locator: spec.locator,
        pageCount: fetched.length,
      },
    });
  }
  if (docs.length === 0) throw new Error('No readable content was found in any source');

  reportActivity(threadId, {
    step: 'fetcher',
    kind: 'fetched',
    detail: `${docs.length} document(s)`,
  });
  return { rawDocs: docs };
}
