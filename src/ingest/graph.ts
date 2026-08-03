import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { distiller } from './nodes/distiller';
import { fetcher } from './nodes/fetcher';
import { indexer } from './nodes/indexer';
import { review } from './nodes/review';
import { IngestState } from './state';

const builder = new StateGraph(IngestState)
  .addNode('fetcher', fetcher)
  .addNode('distiller', distiller)
  // The review loop is uncapped, matching the plan-approval gate: the human
  // controls it. Only writer↔editor has an iteration limit.
  .addNode('review', review, { ends: ['indexer', 'distiller'] })
  .addNode('indexer', indexer, { ends: [END] })
  .addEdge(START, 'fetcher')
  .addEdge('fetcher', 'distiller')
  .addEdge('distiller', 'review');

export const ingestGraph = builder.compile({ checkpointer: new MemorySaver() });
