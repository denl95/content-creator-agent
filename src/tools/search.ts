import { DynamicStructuredTool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';

const MAX_SEARCHES = Number(process.env.MAX_SEARCHES ?? 10);
const counts = new Map<string, number>();

export function resetSearchCount(threadId = 'default'): void {
  counts.delete(threadId);
}

export function takeSearchSlot(threadId = 'default'): number | null {
  const used = counts.get(threadId) ?? 0;
  if (used >= MAX_SEARCHES) return null;
  counts.set(threadId, used + 1);
  return used + 1;
}

const tavily = new TavilySearch({ maxResults: 5 });

export const searchTool = new DynamicStructuredTool({
  name: 'web_search',
  description:
    'Search the web for current facts, statistics, trends, and competitor information. Use for research and fact-checking.',
  schema: z.object({
    input: z.string().describe('The search query'),
  }),
  func: async ({ input }, _runManager, config) => {
    const threadId = (config?.configurable?.thread_id as string | undefined) ?? 'default';
    const slot = takeSearchSlot(threadId);
    if (slot === null) {
      return `[web_search] Search limit reached (${MAX_SEARCHES} requests per run). Skipping query: "${input}"`;
    }
    console.log(`[web_search ${slot}/${MAX_SEARCHES}] "${input}"`);
    return tavily.invoke({ query: input });
  },
});
