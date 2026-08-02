import { Annotation } from '@langchain/langgraph';
import type { Distillation } from './schemas';
import type { RawDoc, SourceSpec } from './types';

export type IngestRequest = { brandId: string; sources: SourceSpec[] };

const last = <T>(def: () => T) => ({ reducer: (_p: T, n: T) => n, default: def });

export const IngestState = Annotation.Root({
  request: Annotation<IngestRequest>({ reducer: (_p, n) => n }),
  rawDocs: Annotation<RawDoc[]>(last<RawDoc[]>(() => [])),
  distillation: Annotation<Distillation | null>(last<Distillation | null>(() => null)),
  reviewFeedback: Annotation<string | null>(last<string | null>(() => null)),
});

export type IngestStateType = typeof IngestState.State;

export function makeIngestState(request: IngestRequest): Partial<IngestStateType> {
  return { request };
}
