import { describe, expect, test } from 'bun:test';
import { routeAfterReview } from '../../src/ingest/nodes/review';

describe('routeAfterReview', () => {
  test('approval goes to the indexer', () => {
    expect(routeAfterReview({ approved: true })).toBe('indexer');
  });

  test('a revision goes back to the distiller', () => {
    expect(routeAfterReview({ approved: false })).toBe('distiller');
  });
});
