import { END, START, StateGraph } from '@langchain/langgraph';
import { editor } from './nodes/editor';
import { finalizer } from './nodes/finalizer';
import { hitl } from './nodes/hitl';
import { strategist } from './nodes/strategist';
import { writer } from './nodes/writer';
import { routeAfterEditor } from './routing/editorRoute';
import { GraphState } from './state';

/**
 * The content pipeline's topology, separate from the compiled singleton in
 * `graph.ts` so it can be inspected without a checkpointer.
 *
 * The split also keeps the shape testable: `tests/unit/runManagerActivity`
 * replaces `./graph` with `mock.module`, which bun applies process-wide, so a
 * test importing `./graph` to assert on the node list gets the mock instead and
 * passes per-file while failing in the full suite.
 */
export const builder = new StateGraph(GraphState)
  .addNode('strategist', strategist)
  .addNode('hitl', hitl, { ends: ['writer', 'strategist'] })
  .addNode('writer', writer)
  .addNode('editor', editor)
  // Publishing is not a pipeline step. A finished draft lives in the database
  // and reaches Notion only when someone presses Publish on it
  // (`POST /drafts/:id/publish`) — see the Publishing section in README.md.
  .addNode('finalizer', finalizer, { ends: [END] })
  .addEdge(START, 'strategist')
  .addEdge('strategist', 'hitl')
  .addEdge('writer', 'editor')
  .addConditionalEdges('editor', routeAfterEditor, ['writer', 'finalizer'])
  .addEdge('finalizer', END);
