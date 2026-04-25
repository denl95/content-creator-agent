import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import type { Brief, ContentPlan, DraftContent, EditFeedback } from './schemas';

export const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,

  brief: Annotation<Brief>({
    reducer: (_prev, next) => next,
  }),

  plan: Annotation<ContentPlan | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  planApproved: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  userPlanFeedback: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  draft: Annotation<DraftContent | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  editFeedback: Annotation<EditFeedback | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // last-write-wins; Writer is the only node that increments this
  iteration: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),

  finalContent: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type GraphStateType = typeof GraphState.State;

export function makeInitialState(brief: Brief): Partial<GraphStateType> {
  return { brief };
}
