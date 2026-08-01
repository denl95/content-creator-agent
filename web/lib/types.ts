export const NODES = ['strategist', 'hitl', 'writer', 'editor', 'finalizer', 'publisher'];

// biome-ignore lint/suspicious/noExplicitAny: payloads are node-specific and narrowed at each use site
export type RunEvent = { node: string; data: any; ts: number; seq: number };

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
