import { Command, interrupt } from '@langchain/langgraph';
import { z } from 'zod';
import type { GraphStateType } from '../state';

const HitlResumeSchema = z.discriminatedUnion('approved', [
  z.object({ approved: z.literal(true) }),
  z.object({ approved: z.literal(false), feedback: z.string().min(1) }),
]);

export async function hitl(state: GraphStateType): Promise<Command> {
  const resume = interrupt({
    kind: 'plan_approval',
    plan: state.plan,
    brief: state.brief,
    instructions:
      'Respond with { "approved": true } to proceed to writing, or { "approved": false, "feedback": "<your notes>" } to revise the plan.',
  });

  const parsed = HitlResumeSchema.parse(resume);

  if (parsed.approved) {
    return new Command({
      goto: 'writer',
      update: { planApproved: true, userPlanFeedback: null },
    });
  }

  return new Command({
    goto: 'strategist',
    update: { planApproved: false, userPlanFeedback: parsed.feedback },
  });
}
