import type { SourceFetcher, SourceSpec } from '../types';
import { pasteFetcher } from './paste';
import { rssFetcher } from './rss';
import { websiteFetcher } from './website';

const FETCHERS: SourceFetcher[] = [websiteFetcher, rssFetcher, pasteFetcher];

/**
 * Null when the kind is unknown or its dependencies are unavailable — which is
 * what lets a paid source (phase 3) degrade to hidden rather than broken.
 */
export function fetcherFor(kind: SourceSpec['kind']): SourceFetcher | null {
  const found = FETCHERS.find((f) => f.kind === kind);
  return found?.available() ? found : null;
}

export { pasteFetcher, rssFetcher, websiteFetcher };
