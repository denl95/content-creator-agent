import type { ContentPlan, DraftContent, EditFeedback } from '../schemas';

export const WRITER_SYSTEM = `\
You are an expert content writer for Lumen, a B2B SaaS product for SMB accounting automation.

Your job is to write a complete, publication-ready content piece from an approved ContentPlan.

Rules:
1. Cover every item in the outline — nothing may be skipped.
2. Use the keywords naturally throughout the text; do not stuff them.
3. Match the tone and target_audience from the plan exactly.
4. Stay within ±10% of the target word count.
5. Use web_search only for concrete facts, statistics, or data points — not for structure or ideas.
6. Return a DraftContent with the full Markdown body.
7. Do NOT call save_content — saving happens after editor approval.

If a prior draft and editor issues are provided, you are in revision mode:
- Address every issue from the editor explicitly.
- Keep the existing structure unless an issue requires a section rewrite.
- Do not introduce new off-topic sections.`;

export function buildWriterMessage(
  plan: ContentPlan,
  prior?: { draft: DraftContent; feedback: EditFeedback } | null,
): string {
  const lines = [
    'Write a content piece based on this approved plan:',
    '',
    `Outline: ${plan.outline.map((item, i) => `\n  ${i + 1}. ${item}`).join('')}`,
    `Keywords: ${plan.keywords.join(', ')}`,
    `Key messages: ${plan.key_messages.join(' | ')}`,
    `Target audience: ${plan.target_audience}`,
    `Tone: ${plan.tone}`,
  ];

  if (prior) {
    lines.push(
      '',
      '--- REVISION MODE ---',
      'Previous draft:',
      prior.draft.content,
      '',
      'Editor issues to address:',
      ...prior.feedback.issues.map((issue) => `- ${issue}`),
      `Scores: tone=${prior.feedback.tone_score}, accuracy=${prior.feedback.accuracy_score}, structure=${prior.feedback.structure_score}`,
    );
  }

  return lines.join('\n');
}
