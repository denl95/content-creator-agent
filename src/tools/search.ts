import { DynamicStructuredTool } from '@langchain/core/tools';
import { TavilySearch } from '@langchain/tavily';
import { z } from 'zod';
import { reportActivity } from '../activity';

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
    // No `step`: this tool serves both the strategist and the writer, and
    // `config.metadata.langgraph_node` says 'tools' inside the agent's own
    // graph. The activity registry inherits the step from the calling node.
    const slot = takeSearchSlot(threadId);
    if (slot === null) {
      reportActivity(threadId, {
        kind: 'web_search',
        detail: `limit of ${MAX_SEARCHES} reached — skipped "${input}"`,
      });
      return `[web_search] Search limit reached (${MAX_SEARCHES} requests per run). Skipping query: "${input}"`;
    }
    reportActivity(threadId, {
      kind: 'web_search',
      detail: `${slot}/${MAX_SEARCHES} "${input}"`,
    });
    try {
      return await tavily.invoke({ query: input });
    } catch (err) {
      // Rethrow unchanged — the agent decides what to do with a failed search.
      // This only makes the failure visible instead of silent in the dashboard.
      reportActivity(threadId, {
        kind: 'web_search_failed',
        detail: `"${input}": ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },
});
