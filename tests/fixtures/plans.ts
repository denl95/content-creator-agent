import type { ContentPlan } from '../../src/schemas';

// Fixed plan for the writer test — 5 outline items, 4 keywords
export const writerFixturePlan: ContentPlan = {
  outline: [
    'Why manually answering repetitive customer questions creates hidden costs',
    'The three most common bottlenecks when scaling support without more hires',
    'What real-time AI-assisted processing actually looks like in practice',
    'How to evaluate whether your current workflow is slowing you down',
    'Steps to introduce an AI assistant without disrupting daily operations',
  ],
  keywords: [
    'LLM automation',
    'AI assistant for small business',
    'real-time processing',
    'monthly reporting',
  ],
  key_messages: [
    'Manual repetitive work has a measurable cost most owners ignore',
    'An AI assistant removes the bottleneck layer, not just the busywork',
    'Adopting AI automation is simpler than most owners expect',
  ],
  target_audience: 'SMB owners with 5–50 employees',
  tone: 'professional',
};
