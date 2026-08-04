import { MemorySaver } from '@langchain/langgraph';
import { builder } from './graphBuilder';

export const graph = builder.compile({ checkpointer: new MemorySaver() });
