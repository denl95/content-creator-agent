import { Command } from '@langchain/langgraph';
import { CostTracker } from './costTracker';
import { setDraftCost } from './db';
import { graph } from './graph';
import type { Brief } from './schemas';
import { makeInitialState } from './state';
import { resetSearchCount } from './tools/search';

export type RunStatus = 'running' | 'awaiting_approval' | 'done' | 'error';
export type RunEvent = { node: string; data: unknown; ts: number };

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
};

const runs = new Map<string, InternalRun>();

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
  const event: RunEvent = { node, data, ts: Date.now() };
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
    if (run.status === 'done' || run.status === 'error') {
      resetSearchCount(run.threadId);
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
  };
  runs.set(threadId, run);
  resetSearchCount(threadId);
  void drive(run, makeInitialState(brief));
  return threadId;
}

export function resumeRun(
  threadId: string,
  decision: { approved: boolean; feedback?: string },
): boolean {
  const run = runs.get(threadId);
  if (!run || run.status !== 'awaiting_approval') return false;
  run.interruptPayload = null;
  void drive(run, new Command({ resume: decision }));
  return true;
}
