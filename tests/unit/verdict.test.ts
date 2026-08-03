import { describe, expect, test } from 'bun:test';
import { APPROVAL_THRESHOLD, deriveVerdict } from '../../src/routing/verdict';

const scores = (tone: number, accuracy: number, structure: number) => ({
  tone_score: tone,
  accuracy_score: accuracy,
  structure_score: structure,
});

describe('deriveVerdict', () => {
  test('approves when every score clears the threshold', () => {
    expect(deriveVerdict(scores(0.8, 0.8, 0.8))).toBe('APPROVED');
    expect(deriveVerdict(scores(1, 1, 1))).toBe('APPROVED');
  });

  test('the threshold is inclusive — exactly 0.8 passes', () => {
    expect(deriveVerdict(scores(APPROVAL_THRESHOLD, 1, 1))).toBe('APPROVED');
    expect(deriveVerdict(scores(0.79, 1, 1))).toBe('REVISION_NEEDED');
  });

  test('any single score below the threshold blocks', () => {
    expect(deriveVerdict(scores(0.7, 1, 1))).toBe('REVISION_NEEDED');
    expect(deriveVerdict(scores(1, 0.7, 1))).toBe('REVISION_NEEDED');
    expect(deriveVerdict(scores(1, 1, 0.7))).toBe('REVISION_NEEDED');
  });

  test('the two live runs the model got wrong now approve', () => {
    // Both were returned as REVISION_NEEDED by the model despite its own prompt
    // saying "APPROVED if ALL three scores are ≥ 0.8. No exceptions."
    expect(deriveVerdict(scores(0.95, 0.9, 0.9))).toBe('APPROVED');
    expect(deriveVerdict(scores(0.9, 0.9, 0.9))).toBe('APPROVED');
  });
});
