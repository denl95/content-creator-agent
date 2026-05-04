import type { Brief } from '../../src/schemas';

export const linkedinBrief: Brief = {
  topic: '5 signs your bookkeeping is costing you money',
  target_audience: 'SMB owners with 1–20 employees',
  channel: 'linkedin',
  tone: 'professional',
  word_count: 900,
};

export const blogBrief: Brief = {
  topic: 'How to switch accounting software without losing your data',
  target_audience: 'Bookkeepers managing multiple SMB clients',
  channel: 'blog',
  tone: 'professional',
  word_count: 1800,
};

export const twitterBrief: Brief = {
  topic: 'The real cost of a manual monthly close',
  target_audience: 'SMB founders',
  channel: 'twitter',
  tone: 'casual',
  word_count: 300,
};

// Used for e2e test — on-brand topic the brand corpus covers well, short format to minimise LLM calls
export const e2eBrief: Brief = {
  topic: '3 routine tasks an AI assistant can handle for your small business today',
  target_audience: 'SMB owners',
  channel: 'instagram',
  tone: 'friendly',
  word_count: 150,
};
