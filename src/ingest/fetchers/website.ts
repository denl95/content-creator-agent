import { reportActivity } from '../../activity';
import { extractText } from '../extract';
import { safeFetch } from '../safety';
import {
  INGEST_MAX_PAGES,
  INGEST_USER_AGENT,
  MAX_BYTES,
  type RawDoc,
  type SourceFetcher,
  type SourceSpec,
} from '../types';
import {
  inScope,
  isAllowed,
  normalizeUrl,
  parseRobots,
  parseSitemap,
  type RobotsRules,
} from '../urls';

/**
 * Every request the crawler makes goes through safeFetch, which refuses private
 * and link-local destinations and re-checks each redirect hop. The URL comes
 * from a form, so it is attacker-controlled by definition.
 */
async function get(url: string): Promise<Response | null> {
  try {
    return await safeFetch(url);
  } catch {
    return null;
  }
}

async function loadRobots(origin: string): Promise<RobotsRules> {
  const res = await get(`${origin}/robots.txt`);
  if (!res?.ok) return { disallow: [] };
  return parseRobots(await res.text(), INGEST_USER_AGENT);
}

/** Sitemap first — it is the site's own list of what matters. */
async function fromSitemap(origin: string): Promise<string[]> {
  const res = await get(`${origin}/sitemap.xml`);
  if (!res?.ok) return [];
  const entries = parseSitemap(await res.text());
  const pages: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith('.xml')) {
      const nested = await get(entry);
      if (nested?.ok) pages.push(...parseSitemap(await nested.text()));
    } else {
      pages.push(entry);
    }
    if (pages.length >= INGEST_MAX_PAGES * 2) break;
  }
  return pages;
}

function linksFrom(html: string, base: string): string[] {
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map(
    (m) => m[1] ?? '',
  );
  return hrefs.map((h) => normalizeUrl(h, base)).filter((u): u is string => u !== null);
}

async function readPage(url: string): Promise<{ doc: RawDoc; html: string } | null> {
  const res = await get(url);
  if (!res?.ok) return null;
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null;
  const html = (await res.text()).slice(0, MAX_BYTES);
  const { title, text } = extractText(html);
  if (text.length < 120) return null; // A nav-only shell teaches the distiller nothing.
  return { doc: { url, title: title || url, text, kind: 'page' }, html };
}

export const websiteFetcher: SourceFetcher = {
  kind: 'website',
  available: () => true,
  async fetch(spec: SourceSpec, threadId?: string): Promise<RawDoc[]> {
    const root = normalizeUrl(spec.locator, spec.locator);
    if (!root) throw new Error(`"${spec.locator}" is not a usable http(s) URL`);
    const origin = new URL(root).origin;

    const robots = await loadRobots(origin);
    const seeded = await fromSitemap(origin);
    const queue = [
      root,
      ...seeded.map((u) => normalizeUrl(u, origin)).filter((u): u is string => u !== null),
    ];
    const seen = new Set<string>();
    const docs: RawDoc[] = [];

    while (queue.length > 0 && docs.length < INGEST_MAX_PAGES) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      if (!inScope(url, root)) continue;
      if (!isAllowed(new URL(url).pathname, robots)) continue;

      const page = await readPage(url);
      reportActivity(threadId, {
        kind: page ? 'page_fetched' : 'page_skipped',
        detail: `${docs.length + (page ? 1 : 0)}/${INGEST_MAX_PAGES} ${url}`,
      });
      if (!page) continue;
      docs.push(page.doc);

      // Breadth-first: only follow links when the sitemap did not supply enough.
      if (queue.length < INGEST_MAX_PAGES) {
        for (const link of linksFrom(page.html, url)) {
          if (!seen.has(link) && inScope(link, root)) queue.push(link);
        }
      }
    }

    if (docs.length === 0) {
      throw new Error(
        `Crawled ${origin} but found no readable pages — check the URL and robots.txt`,
      );
    }
    return docs;
  },
};
