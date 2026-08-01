export const NODES = ['strategist', 'hitl', 'writer', 'editor', 'finalizer', 'publisher'];

// biome-ignore lint/suspicious/noExplicitAny: payloads are node-specific and narrowed at each use site
export type RunEvent = { node: string; data: any; ts: number; seq: number };

/**
 * Payload of an `activity` event — fine-grained progress from inside a node,
 * emitted by `src/activity.ts` on the API side. `activity` is deliberately not
 * in NODES, so these can never mark a pipeline step complete.
 *
 * There is no shared type across the Hono/Next boundary: this mirrors
 * `Activity` in `src/activity.ts` plus the cost fields runManager adds, and
 * has to be updated by hand when that changes.
 */
export type RunActivity = {
  step: string;
  kind: string;
  detail: string;
  costUsd: number;
  tokens: number;
};

/** Activity kinds that report a failure rather than progress. */
export const FAILED_KINDS = ['web_search_failed', 'publish_failed'];

export type ContentPlan = {
  outline: string[];
  keywords: string[];
  key_messages: string[];
  target_audience: string;
  tone: string;
};

export type EditFeedback = {
  verdict: string;
  issues: string[];
  tone_score: number;
  accuracy_score: number;
  structure_score: number;
};

export type DraftRow = {
  id: string;
  topic: string;
  channel: string;
  tone: string;
  audience: string;
  content: string;
  word_count: number;
  verdict: string | null;
  tone_score: number | null;
  accuracy_score: number | null;
  structure_score: number | null;
  iterations: number;
  issues: string;
  cost_usd: number | null;
  notion_url: string | null;
  created_at: string;
};
