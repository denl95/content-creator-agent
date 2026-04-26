import { END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { editor } from './nodes/editor';
import { finalizer } from './nodes/finalizer';
import { hitl } from './nodes/hitl';
import { publisher } from './nodes/publisher';
import { strategist } from './nodes/strategist';
import { writer } from './nodes/writer';
import { routeAfterEditor } from './routing/editorRoute';
import { GraphState } from './state';

const builder = new StateGraph(GraphState)
  .addNode('strategist', strategist)
  .addNode('hitl', hitl, { ends: ['writer', 'strategist'] })
  .addNode('writer', writer)
  .addNode('editor', editor)
  .addNode('finalizer', finalizer)
  .addNode('publisher', publisher, { ends: [END] })
  .addEdge(START, 'strategist')
  .addEdge('strategist', 'hitl')
  .addEdge('writer', 'editor')
  .addConditionalEdges('editor', routeAfterEditor, ['writer', 'finalizer'])
  .addEdge('finalizer', 'publisher');

export const graph = builder.compile({ checkpointer: new MemorySaver() });
