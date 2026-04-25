import type { ContentPlan } from '../../src/schemas';

// Fixed plan for the writer test — 5 outline items, 4 keywords
export const writerFixturePlan: ContentPlan = {
  outline: [
    'Why manual reconciliation creates hidden costs',
    'The three most common bookkeeping errors and their dollar impact',
    'What real-time categorization actually looks like in practice',
    'How to evaluate whether your current tool is slowing you down',
    'Steps to move to automated bookkeeping without disrupting operations',
  ],
  keywords: [
    'bookkeeping automation',
    'SMB accounting',
    'real-time reconciliation',
    'monthly close',
  ],
  key_messages: [
    'Manual bookkeeping has a measurable cost most owners ignore',
    'Automation removes the error-introduction layer, not just the time',
    'Switching tools is simpler than most owners expect',
  ],
  target_audience: 'SMB owners with 5–50 employees',
  tone: 'professional',
};
