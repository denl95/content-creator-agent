import { DuckDuckGoSearch } from '@langchain/community/tools/duckduckgo_search';

export const searchTool = new DuckDuckGoSearch({
  maxResults: 5,
});

searchTool.name = 'web_search';
searchTool.description =
  'Search the web for current facts, statistics, trends, and competitor information. Use for research and fact-checking.';
