import { Command } from '@langchain/langgraph';
import { clearActivitySink, setActivitySink } from './activity';
import { CostTracker } from './costTracker';
import { setDraftCost } from './db';
import { graph } from './graph';
import type { Brief } from './schemas';
import { makeInitialState } from './state';
import { resetSearchCount } from './tools/search';

export type RunStatus = 'running' | 'awaiting_approval' | 'done' | 'error';

/** The run has finished, one way or the other, and will emit nothing further. */
export function isTerminal(status: RunStatus): boolean {
  return status === 'done' || status === 'error';
}

/**
 * Outcome of a resume attempt. On failure the run's current status is reported
 * so the caller can tell "this run is gone" (`null`) from "it already moved past
 * the gate" — a client that retries a resume it could not confirm needs that
 * distinction, and a bare 409 collapses the two.
 */
export type ResumeResult = { resumed: true } | { resumed: false; status: RunStatus | null };

export type RunEvent = { node: string; data: unknown; ts: number; seq: number };

export type RunRecord = {
  threadId: string;
  status: RunStatus;
  interruptPayload: unknown;
  events: RunEvent[];
  error?: string;
};

type InternalRun = RunRecord & {
  listeners: Set<(e: RunEvent) => void>;
  tracker: CostTracker;
  nextSeq: number;
  createdAt: number;
};

const runs = new Map<string, InternalRun>();

const RUN_TTL_MS = Number(process.env.RUN_TTL_MS ?? 60 * 60 * 1000);

export function getRun(threadId: string): RunRecord | undefined {
  return runs.get(threadId);
}

export function subscribe(threadId: string, fn: (e: RunEvent) => void): (() => void) | null {
  const run = runs.get(threadId);
  if (!run) return null;
  run.listeners.add(fn);
  return () => run.listeners.delete(fn);
}

function emit(run: InternalRun, node: string, data: unknown): void {
  const event: RunEvent = { node, data, ts: Date.now(), seq: run.nextSeq++ };
  run.events.push(event);
  for (const fn of run.listeners) {
    try {
      fn(event);
    } catch (err) {
      console.error('[runManager] listener threw:', err instanceof Error ? err.message : err);
    }
  }
}

function summarize(node: string, value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if (node === 'strategist') return { plan: v.plan };
  if (node === 'writer') {
    const draft = v.draft as { content: string; word_count: number } | undefined;
    return draft ? { preview: draft.content.slice(0, 300), word_count: draft.word_count } : {};
  }
  if (node === 'editor') return { editFeedback: v.editFeedback };
  if (node === 'publisher') return { notionUrl: v.notionUrl ?? null };
  return {};
}

// biome-ignore lint/suspicious/noExplicitAny: graph.stream accepts either partial state or a Command; matches the pattern in src/cli.ts
async function drive(run: InternalRun, input: any): Promise<void> {
  const config = { configurable: { thread_id: run.threadId }, callbacks: [run.tracker] };
  // Registered here, not in startRun, so that registering and clearing live in
  // the same function — resumeRun drives the same run again and would otherwise
  // depend on startRun's registration still being in place. Re-registering is
  // idempotent. Tool- and node-level progress carries the live cost/token
  // totals so the dashboard can show a running counter, not just a final figure.
  setActivitySink(run.threadId, (activity) => {
    emit(run, 'activity', {
      ...activity,
      costUsd: run.tracker.costUsd(),
      tokens: run.tracker.totalTokens(),
    });
  });
  try {
    run.status = 'running';
    let interrupted = false;
    const stream = await graph.stream(input, config);
    for await (const chunk of stream) {
      for (const [node, value] of Object.entries(chunk)) {
        if (node === '__interrupt__') {
          interrupted = true;
          run.interruptPayload = (value as Array<{ value: unknown }>)[0]?.value ?? null;
          continue;
        }
        emit(run, node, summarize(node, value));
      }
      if (run.tracker.overBudget()) {
        throw new Error(`Token budget exceeded (${run.tracker.totalTokens()} tokens)`);
      }
    }
    if (interrupted) {
      run.status = 'awaiting_approval';
      emit(run, 'hitl', { awaiting: true, payload: run.interruptPayload });
    } else {
      run.status = 'done';
      setDraftCost(run.threadId, run.tracker.costUsd());
      emit(run, 'done', {
        costUsd: run.tracker.costUsd(),
        tokens: run.tracker.totalTokens(),
      });
    }
  } catch (err) {
    run.status = 'error';
    run.error = err instanceof Error ? err.message : String(err);
    emit(run, 'error', { message: run.error });
  } finally {
    if (isTerminal(run.status)) {
      resetSearchCount(run.threadId);
      clearActivitySink(run.threadId);
    }
  }
}

export function startRun(brief: Brief): string {
  const threadId = crypto.randomUUID();
  const run: InternalRun = {
    threadId,
    status: 'running',
    interruptPayload: null,
    events: [],
    listeners: new Set(),
    tracker: new CostTracker(),
    nextSeq: 0,
    createdAt: Date.now(),
  };
  runs.set(threadId, run);
  resetSearchCount(threadId);
  void drive(run, makeInitialState(brief));
  return threadId;
}

export function sweepStaleRuns(now = Date.now()): number {
  let removed = 0;
  for (const [threadId, run] of runs) {
    const isStale = now - run.createdAt > RUN_TTL_MS;
    const isStaleAwaitingApproval = run.status === 'awaiting_approval' && isStale;
    const isStaleTerminal = isTerminal(run.status) && isStale;
    if (isStaleAwaitingApproval || isStaleTerminal) {
      runs.delete(threadId);
      resetSearchCount(threadId);
      clearActivitySink(threadId);
      removed++;
    }
  }
  return removed;
}

export function resumeRun(
  threadId: string,
  decision: { approved: boolean; feedback?: string },
): ResumeResult {
  const run = runs.get(threadId);
  if (!run) return { resumed: false, status: null };
  if (run.status !== 'awaiting_approval') return { resumed: false, status: run.status };
  run.interruptPayload = null;
  void drive(run, new Command({ resume: decision }));
  return { resumed: true };
}
