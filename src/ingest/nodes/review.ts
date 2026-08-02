import { Command, interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import type { Distillation } from '../schemas';
import type { IngestStateType } from '../state';

const ReviewResumeSchema = z.discriminatedUnion('approved', [
  z.object({
    approved: z.literal(true),
    /** Corrections made in the review card, applied before indexing. */
    edits: z
      .object({
        profile: z.record(z.unknown()).optional(),
        style_guide: z.record(z.unknown()).optional(),
      })
      .optional(),
  }),
  z.object({ approved: z.literal(false), feedback: z.string().min(1) }),
]);

export type ReviewDecision = z.infer<typeof ReviewResumeSchema>;

/** Pure, so routing is testable without running the graph. */
export function routeAfterReview(decision: { approved: boolean }): 'indexer' | 'distiller' {
  return decision.approved ? 'indexer' : 'distiller';
}

export async function review(state: IngestStateType): Promise<Command> {
  if (!state.distillation) throw new Error('review: nothing distilled — check the distiller node');

  const resume = interrupt({
    kind: 'brand_approval',
    profile: state.distillation.profile,
    style_guide: state.distillation.style_guide,
    exemplars: state.distillation.exemplars,
    instructions:
      'Respond with { "approved": true } to index this brand, optionally with { "edits": { ... } }, or { "approved": false, "feedback": "<your notes>" } to distil again.',
  });

  const parsed = ReviewResumeSchema.parse(resume);
  if (!parsed.approved) {
    return new Command({
      goto: routeAfterReview(parsed),
      update: { reviewFeedback: parsed.feedback },
    });
  }

  // Edits are merged over the distilled result rather than replacing it: the
  // card only exposes a few fields, and the rest must survive untouched.
  const merged: Distillation = {
    ...state.distillation,
    profile: { ...state.distillation.profile, ...(parsed.edits?.profile ?? {}) },
    style_guide: { ...state.distillation.style_guide, ...(parsed.edits?.style_guide ?? {}) },
  };
  return new Command({ goto: routeAfterReview(parsed), update: { distillation: merged } });
}
