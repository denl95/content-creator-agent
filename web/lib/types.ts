/**
 * Pipeline steps shown on the run screen. `publisher` is deliberately absent:
 * publishing is not part of a run, it is a per-draft action behind the Publish
 * button. Mirrors the node list in `src/graph.ts` by hand.
 */
export const NODES = ['strategist', 'hitl', 'writer', 'editor', 'finalizer'];

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

/**
 * A kind reports a failure rather than progress. This is the same predicate
 * `src/activity.ts` uses to route to stderr — matching on the suffix rather
 * than listing known kinds means a new `*_failed` kind on the API renders
 * correctly here without a matching edit.
 */
export function isFailedKind(kind: string): boolean {
  return kind.endsWith('_failed');
}

export type ContentPlan = {
  outline: string[];
  keywords: string[];
  key_messages: string[];
  target_audience: string;
  tone: string;
  /**
   * Divergences between the brief and the brand corpus, recorded by the
   * strategist. Optional here although `src/schemas.ts` requires it: the server
   * replays a run's full event history on every SSE reconnect, so a run started
   * before this shipped delivers a plan with no `conflicts` key.
   */
  conflicts?: Array<{ dimension: string; brief_value: string; corpus_value: string }>;
};

export type EditFeedback = {
  verdict: string;
  issues: string[];
  tone_score: number;
  accuracy_score: number;
  structure_score: number;
};

/** Mirrors `BrandRow` in `src/brands.ts` — no shared type crosses the boundary. */
export type Brand = {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_default: boolean;
  language: string;
  collection_name: string;
  corpus_hash: string | null;
  created_at: string;
};

export type DraftRow = {
  id: string;
  brand_id: string | null;
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

export type BrandDocument = {
  id: string;
  kind: 'profile' | 'style_guide' | 'exemplar' | 'raw_page';
  title: string;
  content: string;
  included: boolean;
};

export type BrandDetail = Brand & { documents: BrandDocument[] };

export type BrandProfilePayload = {
  name: string;
  mission: string;
  services: string[];
  audience_primary: string;
  audience_secondary: string;
  positioning: string;
  channels: Array<{ channel: string; description: string; word_range: string; cadence: string }>;
};

export type StyleGuidePayload = {
  voice: string[];
  forbidden_phrases: string[];
  preferred_constructions: string[];
  formatting_rules: string[];
  language: string;
};

/** Ingest steps, deliberately separate from NODES. */
export const INGEST_NODES = ['fetcher', 'distiller', 'review', 'indexer'];
