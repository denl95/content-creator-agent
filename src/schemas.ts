import { z } from 'zod';

export const BriefSchema = z.object({
  topic: z.string().describe('The main subject or title for the content piece'),
  target_audience: z.string().describe("Who the content is written for, e.g. 'SMB owners'"),
  channel: z
    .enum(['blog', 'linkedin', 'twitter'])
    .describe('Publishing channel that determines format and length rules'),
  tone: z.string().describe("Desired tone of voice, e.g. 'professional', 'casual', 'data-driven'"),
  word_count: z.number().int().positive().describe('Target word count for the final article'),
});

export const ContentPlanSchema = z.object({
  outline: z
    .array(z.string())
    .min(1)
    .describe('Ordered list of section headings or key points to cover'),
  keywords: z
    .array(z.string())
    .describe('Primary and secondary SEO/topical keywords to include in the content'),
  key_messages: z
    .array(z.string())
    .describe('Core ideas the content must communicate to the target audience'),
  target_audience: z
    .string()
    .describe('Refined audience description, may add nuance beyond the brief'),
  tone: z
    .string()
    .describe('Tone of voice to apply throughout — must align with brand style guide'),
});

export const DraftContentSchema = z.object({
  content: z.string().min(1).describe('Full Markdown body of the written article or post'),
  word_count: z.number().int().positive().describe('Actual word count of the content field'),
  keywords_used: z
    .array(z.string())
    .describe("Subset of the plan's keywords that appear in the content"),
});

export const EditFeedbackSchema = z.object({
  verdict: z
    .enum(['APPROVED', 'REVISION_NEEDED'])
    .describe(
      'APPROVED if all scores ≥ 0.8 and no critical issues remain, otherwise REVISION_NEEDED',
    ),
  issues: z
    .array(z.string())
    .describe('Specific, actionable issues the Writer must address; empty when APPROVED'),
  tone_score: z
    .number()
    .min(0)
    .max(1)
    .describe('0–1 score for how well the content matches the planned tone and brand voice'),
  accuracy_score: z
    .number()
    .min(0)
    .max(1)
    .describe('0–1 score for factual plausibility and absence of unsupported claims'),
  structure_score: z
    .number()
    .min(0)
    .max(1)
    .describe('0–1 score for how thoroughly the content covers every outline item'),
});

export type Brief = z.infer<typeof BriefSchema>;
export type ContentPlan = z.infer<typeof ContentPlanSchema>;
export type DraftContent = z.infer<typeof DraftContentSchema>;
export type EditFeedback = z.infer<typeof EditFeedbackSchema>;
