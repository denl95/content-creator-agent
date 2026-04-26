import { DuckDuckGoSearch } from '@langchain/community/tools/duckduckgo_search';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const ddg = new DuckDuckGoSearch({ maxResults: 5 });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchWithRetry(query: string, retries = 3, backoff = 2000): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) await delay(backoff * attempt);
      return await ddg.invoke(query);
    } catch (err) {
      const isRateLimit =
        err instanceof Error && err.message.toLowerCase().includes('anomaly');
      if (!isRateLimit) throw err;
      if (attempt === retries - 1) throw new Error(`Search rate-limited after ${retries} retries: ${err.message}`);
      await delay(backoff * (attempt + 1));
    }
  }
  throw new Error('Search failed after retries');
}

export const searchTool = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web for current facts, statistics, trends, and competitor information. Use for research and fact-checking.',
  schema: z.object({
    input: z.string().describe('The search query'),
  }),
  func: ({ input }) => {
    console.log(`[web_search] "${input}"`);
    return searchWithRetry(input);
  },
});
