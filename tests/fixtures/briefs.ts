import type { Brief } from '../../src/schemas';

export const linkedinBrief: Brief = {
  topic: '5 signs your business is ready for an AI assistant',
  target_audience: 'SMB owners with 1–20 employees',
  channel: 'linkedin',
  tone: 'professional',
  word_count: 900,
  language: 'en',
  brand_id: 'test-brand',
};

export const blogBrief: Brief = {
  topic: 'How to automate customer onboarding with an LLM without writing code',
  target_audience: 'Operations managers at small businesses',
  channel: 'blog',
  tone: 'professional',
  word_count: 1800,
  language: 'en',
  brand_id: 'test-brand',
};

export const twitterBrief: Brief = {
  topic: 'The real cost of answering the same customer question 50 times a week',
  target_audience: 'SMB founders',
  channel: 'twitter',
  tone: 'casual',
  word_count: 300,
  language: 'en',
  brand_id: 'test-brand',
};

// Used for e2e test — on-brand topic the brand corpus covers well, short format to minimise LLM calls
export const e2eBrief: Brief = {
  topic: '3 routine tasks an AI assistant can handle for your small business today',
  target_audience: 'SMB owners',
  channel: 'instagram',
  tone: 'friendly',
  word_count: 150,
  language: 'en',
  brand_id: 'test-brand',
};
