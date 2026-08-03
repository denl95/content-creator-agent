import { Command } from '@langchain/langgraph';
import { clearActivitySink, setActivitySink } from './activity';
import { CostTracker } from './costTracker';
import { setDraftCost } from './db';
import { graph } from './graph';
import { ingestGraph } from './ingest/graph';
import { type IngestRequest, makeIngestState } from './ingest/state';
import type { Brief } from './schemas';
import { makeInitialState } from './state';
import { resetSearchCount } from './tools/search';

export type RunStatus = 'running' | 'awaiting_approval' | 'done' | 'error';

/** Which graph a run drives. The record carries it so one map serves both. */
export type RunKind = 'content' | 'ingest';

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
  kind: RunKind;
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

function summarizeContent(node: string, value: unknown): unknown {
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

function summarizeIngest(node: string, value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if (node === 'fetcher') {
    const docs = v.rawDocs as unknown[] | undefined;
    return { documents: docs?.length ?? 0 };
  }
  if (node === 'distiller') return { distilled: Boolean(v.distillation) };
  return {};
}

type RunnerSpec = {
  // biome-ignore lint/suspicious/noExplicitAny: two compiled graphs with different state shapes
  graph: any;
  summarize: (node: string, value: unknown) => unknown;
  onDone?: (threadId: string, tracker: CostTracker) => Promise<void>;
};

const SPECS: Record<RunKind, RunnerSpec> = {
  content: {
    graph,
    summarize: summarizeContent,
    onDone: async (threadId, tracker) => {
      await setDraftCost(threadId, tracker.costUsd());
    },
  },
  ingest: { graph: ingestGraph, summarize: summarizeIngest },
};

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
    const spec = SPECS[run.kind];
    const stream = await spec.graph.stream(input, config);
    for await (const chunk of stream) {
      for (const [node, value] of Object.entries(chunk)) {
        if (node === '__interrupt__') {
          interrupted = true;
          run.interruptPayload = (value as Array<{ value: unknown }>)[0]?.value ?? null;
          continue;
        }
        emit(run, node, SPECS[run.kind].summarize(node, value));
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
      await SPECS[run.kind].onDone?.(run.threadId, run.tracker);
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

/** Shared so the two entry points cannot drift in what a fresh record holds. */
function newRun(threadId: string, kind: RunKind): InternalRun {
  return {
    threadId,
    kind,
    status: 'running',
    interruptPayload: null,
    events: [],
    listeners: new Set(),
    tracker: new CostTracker(),
    nextSeq: 0,
    createdAt: Date.now(),
  };
}

export function startRun(brief: Brief): string {
  const threadId = crypto.randomUUID();
  const run = newRun(threadId, 'content');
  runs.set(threadId, run);
  resetSearchCount(threadId);
  void drive(run, makeInitialState(brief));
  return threadId;
}

export function startIngest(request: IngestRequest): string {
  const threadId = crypto.randomUUID();
  const run = newRun(threadId, 'ingest');
  runs.set(threadId, run);
  void drive(run, makeIngestState(request));
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
  decision: { approved: boolean; feedback?: string; edits?: Record<string, unknown> },
): ResumeResult {
  const run = runs.get(threadId);
  if (!run) return { resumed: false, status: null };
  if (run.status !== 'awaiting_approval') return { resumed: false, status: run.status };
  run.interruptPayload = null;
  void drive(run, new Command({ resume: decision }));
  return { resumed: true };
}
