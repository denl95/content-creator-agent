/**
 * Fine-grained progress reporting for an in-flight run.
 *
 * A node completing is the only thing the graph stream tells us about, but a
 * single node can run for a minute (the strategist does a brand lookup plus up
 * to `MAX_SEARCHES` web searches), during which the dashboard has nothing to
 * show. Tools and nodes report here instead of to `console.log`, and the run
 * that owns the thread forwards it to its SSE subscribers.
 *
 * This is deliberately its own module rather than part of `runManager`:
 * runManager → graph → nodes → tools, so a tool importing runManager would
 * close an import cycle. Nothing here imports anything.
 */

/** A reported step of work. `step` is filled in from the thread when omitted. */
export type Activity = {
  /** Pipeline node the work belongs to, e.g. 'strategist'. */
  step?: string;
  /** Stable machine-readable kind, e.g. 'web_search'. Safe to switch on. */
  kind: string;
  /** Human-readable detail, e.g. '1/10 "how AI saves time"'. */
  detail: string;
};

/** What a sink receives: `step` is always resolved. */
export type ResolvedActivity = Activity & { step: string };

type Sink = (activity: ResolvedActivity) => void;

const sinks = new Map<string, Sink>();
/**
 * Last step each thread reported, so a tool can inherit it.
 *
 * Tools cannot name their own step: `config.metadata.langgraph_node` reports
 * `'tools'` inside the agent's inner graph, and `searchTool` is wired into both
 * the strategist and the writer, so there is no correct constant either. Every
 * node reports on entry before invoking its agent, which makes the thread's last
 * step the right answer by construction.
 */
const lastSteps = new Map<string, string>();

export function setActivitySink(threadId: string, sink: Sink): void {
  sinks.set(threadId, sink);
}

export function clearActivitySink(threadId: string): void {
  sinks.delete(threadId);
  lastSteps.delete(threadId);
}

/**
 * Log a step of work and forward it to the run's subscribers, if any.
 *
 * Reporting is never load-bearing: an unknown thread (the CLI, a unit test, a
 * run already swept) or a sink that throws must not disturb the pipeline.
 */
export function reportActivity(threadId: string | undefined, activity: Activity): void {
  // Failures kept their own stream before this module existed — log filters that
  // watch stderr should not go quiet just because reporting moved in here.
  const write = activity.kind.endsWith('_failed') ? console.error : console.log;
  write(`[${activity.kind}] ${activity.detail}`);
  if (!threadId) return;
  if (activity.step) lastSteps.set(threadId, activity.step);
  const sink = sinks.get(threadId);
  if (!sink) return;
  // 'strategist' is the only node whose tools could run before any node has
  // reported, so it is the safe floor for an inherited step.
  const step = activity.step ?? lastSteps.get(threadId) ?? 'strategist';
  try {
    sink({ ...activity, step });
  } catch (err) {
    console.error('[activity] sink threw:', err instanceof Error ? err.message : err);
  }
}
