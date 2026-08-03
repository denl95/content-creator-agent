/** Every dimension must clear this for a draft to be approved. */
export const APPROVAL_THRESHOLD = 0.8;

export type Scores = {
  tone_score: number;
  accuracy_score: number;
  structure_score: number;
};

export type Verdict = 'APPROVED' | 'REVISION_NEEDED';

/**
 * The verdict is computed, never asserted by the model.
 *
 * The editor prompt has always said "APPROVED if ALL three scores are ≥ 0.8, no
 * exceptions" — and the model overrode it anyway. Two live runs scored
 * 0.95/0.90/0.90 and 0.90/0.90/0.90 and still returned REVISION_NEEDED, over
 * nitpicks it had itself raised. That is why nearly every draft in the library
 * is red, and why the writer↔editor loop kept burning iterations on drafts that
 * were already good enough.
 *
 * Scoring is a judgement the model is well suited to. Applying a threshold to
 * three numbers is not a judgement at all, so it does not belong in a prompt.
 */
export function deriveVerdict(scores: Scores): Verdict {
  const passes =
    scores.tone_score >= APPROVAL_THRESHOLD &&
    scores.accuracy_score >= APPROVAL_THRESHOLD &&
    scores.structure_score >= APPROVAL_THRESHOLD;
  return passes ? 'APPROVED' : 'REVISION_NEEDED';
}
