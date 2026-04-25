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

// Used for e2e test — short word count to keep token spend low
export const e2eBrief: Brief = {
  topic: 'Why real-time bookkeeping beats month-end reconciliation',
  target_audience: 'SMB owners',
  channel: 'linkedin',
  tone: 'professional',
  word_count: 600,
};
