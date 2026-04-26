import { TavilySearch } from '@langchain/tavily';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const MAX_SEARCHES = 10;
let searchCount = 0;

export function resetSearchCount(): void {
  searchCount = 0;
}

const tavily = new TavilySearch({ maxResults: 5 });

export const searchTool = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web for current facts, statistics, trends, and competitor information. Use for research and fact-checking.',
  schema: z.object({
    input: z.string().describe('The search query'),
  }),
  func: async ({ input }) => {
    if (searchCount >= MAX_SEARCHES) {
      return `[web_search] Search limit reached (${MAX_SEARCHES} requests per run). Skipping query: "${input}"`;
    }
    searchCount++;
    console.log(`[web_search ${searchCount}/${MAX_SEARCHES}] "${input}"`);
    return tavily.invoke({ query: input });
  },
});
