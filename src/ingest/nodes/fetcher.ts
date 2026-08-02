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

  const db = getDb();
  const docs: RawDoc[] = [];
  const rows: Array<{ kind: string; locator: string; body: string | null; pageCount: number }> = [];

  // Fetch everything first, record afterwards. Deleting the old rows up front
  // meant one failed fetch permanently lost the brand's source list, leaving
  // re-ingest with nothing to replay and a 409 forever.
  for (const spec of sources) {
    const impl = fetcherFor(spec.kind);
    if (!impl) throw new Error(`Source kind "${spec.kind}" is not available`);
    const fetched = await impl.fetch(spec, threadId);
    docs.push(...fetched);
    rows.push({
      kind: spec.kind,
      locator: spec.locator,
      // A paste has no URL to re-fetch, so the text is the source.
      body: spec.kind === 'paste' ? spec.body : null,
      pageCount: fetched.length,
    });
  }
  if (docs.length === 0) throw new Error('No readable content was found in any source');

  // Only now is it safe to replace the recorded sources.
  await db.$transaction([
    db.brandSource.deleteMany({ where: { brandId } }),
    ...rows.map((row) => db.brandSource.create({ data: { brandId, ...row } })),
  ]);

  reportActivity(threadId, {
    step: 'fetcher',
    kind: 'fetched',
    detail: `${docs.length} document(s)`,
  });
  return { rawDocs: docs };
}
