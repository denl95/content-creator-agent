export type RawDoc = {
  url: string;
  title: string;
  text: string;
  kind: 'page' | 'post';
};

export type SourceSpec =
  | { kind: 'website'; locator: string }
  | { kind: 'rss'; locator: string }
  | { kind: 'paste'; locator: string; body: string };

export interface SourceFetcher {
  kind: SourceSpec['kind'];
  /** False when a required token is unset — the API rejects the source kind. */
  available(): boolean;
  fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]>;
}

export const INGEST_USER_AGENT = process.env.INGEST_USER_AGENT ?? 'eonyx-brand-ingest/1.0';
export const INGEST_MAX_PAGES = Number(process.env.INGEST_MAX_PAGES ?? 25);
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BYTES = 2_000_000;
