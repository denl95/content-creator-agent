import { z } from 'zod';

export const BriefSchema = z.object({
  topic: z.string().min(1).describe('The main subject or title for the content piece'),
  target_audience: z.string().describe("Who the content is written for, e.g. 'SMB owners'"),
  channel: z
    .enum(['blog', 'linkedin', 'twitter', 'instagram', 'threads'])
    .describe('Publishing channel that determines format and length rules'),
  tone: z.string().describe("Desired tone of voice, e.g. 'professional', 'casual', 'data-driven'"),
  word_count: z.number().int().positive().describe('Target word count for the final article'),
  brand_id: z.string().min(1).describe('Brand whose corpus and voice this content follows'),
  language: z
    .string()
    .min(2)
    .default('uk')
    .describe(
      "BCP-47 tag for the language the content must be written in, e.g. 'uk' or 'en'. Defaults to the shipped brand corpus language.",
    ),
});

export const ContentPlanSchema = z.object({
  outline: z
    .array(z.string())
    .min(4)
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
  conflicts: z
    .array(
      z.object({
        dimension: z.string().describe("Brief field that diverges, e.g. 'word_count' or 'tone'"),
        brief_value: z.string().describe("The brief's value, which is authoritative"),
        corpus_value: z.string().describe('The contradicting rule from the brand corpus'),
      }),
    )
    .describe(
      'Divergences between the brief and the retrieved brand-corpus rules. Return an empty array when there are none.',
    ),
});

export const DraftContentSchema = z.object({
  content: z.string().min(1).describe('Full Markdown body of the written article or post'),
  word_count: z.number().int().positive().describe('Actual word count of the content field'),
  keywords_used: z
    .array(z.string())
    .describe("Subset of the plan's keywords that appear in the content"),
});

/**
 * What the Editor model returns. Deliberately has no `verdict`: applying a
 * threshold to three numbers is arithmetic, not judgement, and asking the model
 * for it produced verdicts that contradicted its own scores. `deriveVerdict()`
 * in src/routing/verdict.ts supplies it.
 */
export const EditorAssessmentSchema = z.object({
  issues: z
    .array(z.string())
    .describe(
      'Specific, actionable notes for the Writer. Anything that should block approval must also be reflected in the scores.',
    ),
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
export type EditorAssessment = z.infer<typeof EditorAssessmentSchema>;

/** The assessment plus the verdict this codebase derives from it. */
export const EditFeedbackSchema = EditorAssessmentSchema.extend({
  verdict: z.enum(['APPROVED', 'REVISION_NEEDED']),
});
export type EditFeedback = z.infer<typeof EditFeedbackSchema>;
