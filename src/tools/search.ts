import { DuckDuckGoSearch } from '@langchain/community/tools/duckduckgo_search';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const ddg = new DuckDuckGoSearch({ maxResults: 5 });

export const searchTool = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web for current facts, statistics, trends, and competitor information. Use for research and fact-checking.',
  schema: z.object({
    input: z.string().describe('The search query'),
  }),
  func: async ({ input }) => ddg.invoke(input),
});
