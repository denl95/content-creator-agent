import { MAX_ITERATIONS } from '../constants';
import type { GraphStateType } from '../state';

export function routeAfterEditor(state: GraphStateType): 'finalizer' | 'writer' {
  const fb = state.editFeedback;
  if (!fb) throw new Error('editor node must populate editFeedback before routing');

  const approved = fb.verdict === 'APPROVED';
  const capped = state.iteration >= MAX_ITERATIONS;

  return approved || capped ? 'finalizer' : 'writer';
}
