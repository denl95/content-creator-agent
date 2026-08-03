import { reportActivity } from '../../activity';
import type { RawDoc, SourceFetcher, SourceSpec } from '../types';

/**
 * Blocks separated by a line containing only dashes. Blank lines *inside* a
 * block are preserved — social copy leans on them for rhythm, and collapsing
 * them would change the very thing the exemplar is evidence of.
 */
export function splitPasted(body: string): string[] {
  return body
    .split(/^\s*-{3,}\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean);
}

export const pasteFetcher: SourceFetcher = {
  kind: 'paste',
  available: () => true,
  async fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]> {
    const body = spec.kind === 'paste' ? spec.body : '';
    const blocks = splitPasted(body);
    reportActivity(threadId, { kind: 'pasted_posts', detail: `${blocks.length} block(s)` });
    if (blocks.length === 0) throw new Error('No pasted content to read');
    return blocks.map((text, i) => ({
      url: `pasted#${i + 1}`,
      title: `Pasted post ${i + 1}`,
      text,
      kind: 'post' as const,
    }));
  },
};
