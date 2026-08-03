import { reportActivity } from '../../activity';
import { decodeEntities, extractText } from '../extract';
import {
  FETCH_TIMEOUT_MS,
  INGEST_USER_AGENT,
  type RawDoc,
  type SourceFetcher,
  type SourceSpec,
} from '../types';

const MAX_ENTRIES = 10;

function tag(block: string, name: string): string {
  const cdata = new RegExp(`<${name}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i').exec(block);
  if (cdata?.[1]) return cdata[1];
  const plain = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return plain?.[1] ?? '';
}

/** Feed bodies carry escaped HTML, so they are decoded then stripped of markup. */
function toPlainText(raw: string): string {
  const html = decodeEntities(raw);
  return html.includes('<') ? extractText(`<body>${html}</body>`).text : html.trim();
}

export function parseFeed(xml: string): Array<{ title: string; link: string; body: string }> {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.map((block) => {
    const href = /<link[^>]*href=["']([^"']+)["']/i.exec(block)?.[1];
    return {
      title: decodeEntities(tag(block, 'title')).trim(),
      link: (href ?? tag(block, 'link')).trim(),
      body: toPlainText(
        tag(block, 'content:encoded') || tag(block, 'content') || tag(block, 'description'),
      ),
    };
  });
}

export const rssFetcher: SourceFetcher = {
  kind: 'rss',
  available: () => true,
  async fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]> {
    const res = await fetch(spec.locator, {
      headers: { 'user-agent': INGEST_USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => null);
    if (!res?.ok) throw new Error(`Could not read the feed at ${spec.locator}`);

    const items = parseFeed(await res.text())
      .filter((i) => i.body.length > 80)
      .slice(0, MAX_ENTRIES);
    reportActivity(threadId, {
      kind: 'feed_read',
      detail: `${items.length} entries from ${spec.locator}`,
    });
    if (items.length === 0) throw new Error(`The feed at ${spec.locator} had no readable entries`);

    return items.map((i) => ({
      url: i.link || spec.locator,
      title: i.title || 'Untitled',
      text: i.body,
      kind: 'post' as const,
    }));
  },
};
