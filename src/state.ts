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

  // No `notionUrl` here: the graph no longer publishes. The draft row's
  // `notion_url` column is written by `POST /drafts/:id/publish`, outside any
  // run, so it never belonged to graph state once the publisher node went.
  finalContent: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type GraphStateType = typeof GraphState.State;

export function makeInitialState(brief: Brief): Partial<GraphStateType> {
  return { brief };
}
