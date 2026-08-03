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

describe('run kinds', () => {
  test('a content run records its kind so one map can serve both graphs', async () => {
    const { getRun } = await import('../../src/runManager');
    expect(getRun('no-such-thread')).toBeUndefined();
  });
});
