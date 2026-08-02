import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { Brief } from '../../src/schemas';

/**
 * Lifecycle of the activity sink, driven through the real `runManager`.
 *
 * The registry's own tests cover the map; what was untested is the pairing —
 * that `drive()` registers a sink, keeps it across the human-approval pause, and
 * clears it once the run is terminal or swept. Deleting either half used to
 * leave every test green.
 *
 * `graph` is replaced with `mock.module` rather than a production seam, so this
 * makes no network calls and needs no change to `src/`. It has to be registered
 * before `runManager` is imported, hence the dynamic imports below.
 */

let releaseStream: () => void;
let gate: Promise<void>;
/** What the faked graph stream yields after the gate opens. */
let chunks: unknown[] = [];

mock.module('../../src/graph', () => ({
  graph: {
    stream: async () =>
      (async function* () {
        await gate;
        for (const chunk of chunks) yield chunk;
      })(),
  },
}));

const { getRun, resumeRun, startRun, sweepStaleRuns } = await import('../../src/runManager');
type RunStatus = NonNullable<ReturnType<typeof getRun>>['status'];
const { reportActivity } = await import('../../src/activity');
const { getDb, resetDbForTests } = await import('../../src/db');

const BRIEF: Brief = {
  topic: 'T',
  target_audience: 'devs',
  channel: 'blog',
  tone: 'plain',
  word_count: 100,
};

/** Report one activity and answer whether it reached the run's event log. */
function reportReaches(threadId: string): boolean {
  const before = getRun(threadId)?.events.filter((e) => e.node === 'activity').length ?? 0;
  reportActivity(threadId, { step: 'writer', kind: 'probe', detail: 'x' });
  const after = getRun(threadId)?.events.filter((e) => e.node === 'activity').length ?? 0;
  return after > before;
}

async function settle(threadId: string, want: RunStatus): Promise<void> {
  for (let i = 0; i < 200 && getRun(threadId)?.status !== want; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(getRun(threadId)?.status).toBe(want);
}

let logSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  // reportActivity always logs; keep the suite's output readable.
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  getDb(':memory:');
  chunks = [];
  gate = new Promise<void>((resolve) => {
    releaseStream = resolve;
  });
});

afterEach(() => {
  logSpy.mockRestore();
  resetDbForTests();
});

describe('activity sink lifecycle', () => {
  test('is registered while the run is driving', async () => {
    const threadId = startRun(BRIEF);
    // Still gated inside graph.stream, i.e. mid-run.
    expect(reportReaches(threadId)).toBe(true);
    releaseStream();
    await settle(threadId, 'done');
  });

  test('is cleared once the run finishes', async () => {
    const threadId = startRun(BRIEF);
    releaseStream();
    await settle(threadId, 'done');
    expect(reportReaches(threadId)).toBe(false);
  });

  test('is cleared when the run errors', async () => {
    chunks = [{ writer: {} }];
    const threadId = startRun(BRIEF);
    // A listener that throws is caught by emit; make the graph itself fail.
    gate = Promise.reject(new Error('graph blew up'));
    releaseStream();
    await settle(threadId, 'error');
    expect(reportReaches(threadId)).toBe(false);
  });

  test('survives the approval pause and is still live after resume', async () => {
    chunks = [{ __interrupt__: [{ value: { kind: 'plan_approval' } }] }];
    const threadId = startRun(BRIEF);
    releaseStream();
    await settle(threadId, 'awaiting_approval');
    // This is the invariant that moving registration into drive() depends on:
    // a paused run must keep its sink, because nothing re-registers it.
    expect(reportReaches(threadId)).toBe(true);

    chunks = [];
    gate = Promise.resolve();
    expect(resumeRun(threadId, { approved: true })).toEqual({ resumed: true });
    await settle(threadId, 'done');
    expect(reportReaches(threadId)).toBe(false);
  });

  test('is cleared when a stale run is swept', async () => {
    chunks = [{ __interrupt__: [{ value: {} }] }];
    const threadId = startRun(BRIEF);
    releaseStream();
    await settle(threadId, 'awaiting_approval');

    expect(sweepStaleRuns(Date.now() + 60 * 60 * 1000 + 1)).toBeGreaterThan(0);
    expect(getRun(threadId)).toBeUndefined();
    // No run left to observe through, so assert only that reporting is inert.
    expect(() => reportActivity(threadId, { kind: 'probe', detail: 'x' })).not.toThrow();
  });
});
