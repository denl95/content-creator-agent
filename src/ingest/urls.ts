const TRACKING = /^(utm_|fbclid$|gclid$|mc_(cid|eid)$|ref$|source$)/i;

/**
 * Canonical form of a link, or null when it is not worth crawling. Fragment and
 * trailing slash are dropped so `/about`, `/about/` and `/about#team` are one
 * page rather than three.
 */
export function normalizeUrl(raw: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const out = url.toString();
  return out.endsWith('/') && url.pathname === '/' ? out.slice(0, -1) : out;
}

export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Handles both <urlset> and <sitemapindex> — the tags differ, <loc> does not. */
export function parseSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] ?? '').filter(Boolean);
}

export type RobotsRules = { disallow: string[] };

/**
 * Disallow rules that apply to us. A group naming our agent wins outright over
 * the wildcard group, which is what the standard specifies.
 */
export function parseRobots(txt: string, userAgent: string): RobotsRules {
  const agent = userAgent.split('/')[0]?.toLowerCase() ?? '';
  const groups = new Map<string, string[]>();
  let current: string[] = [];

  for (const line of txt.split('\n')) {
    const clean = line.split('#')[0]?.trim() ?? '';
    if (!clean) continue;
    const [rawKey, ...rest] = clean.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      current = groups.get(value.toLowerCase()) ?? [];
      groups.set(value.toLowerCase(), current);
    } else if (key === 'disallow' && value) {
      current.push(value);
    }
  }
  return { disallow: groups.get(agent) ?? groups.get('*') ?? [] };
}

export function isAllowed(pathname: string, rules: RobotsRules): boolean {
  return !rules.disallow.some((rule) => pathname.startsWith(rule));
}

/**
 * Page names that are legal or transactional rather than brand voice.
 *
 * Matched against whole path segments, never as substrings. A substring match
 * looked simpler and was wrong: `/uk/legal-services` and `/blog/gdpr-checklist`
 * are exactly the pages a brand's voice lives in, and dropping them can empty a
 * crawl entirely — which then surfaces as a misleading "check the URL and
 * robots.txt".
 */
const BOILERPLATE_SEGMENTS = new Set([
  'privacy',
  'privacy-policy',
  'terms',
  'terms-of-service',
  'terms-of-use',
  'terms-and-conditions',
  'tos',
  'cookies',
  'cookie-policy',
  'legal',
  'imprint',
  'impressum',
  'gdpr',
  'disclaimer',
  'refund-policy',
  'shipping-policy',
  'checkout',
  'cart',
  'login',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'register',
]);

export function isBoilerplatePath(pathname: string): boolean {
  return pathname
    .split('/')
    .filter(Boolean)
    .some((segment) => BOILERPLATE_SEGMENTS.has(segment.toLowerCase().replace(/\.[a-z]+$/, '')));
}

/**
 * The crawl scope implied by the URL the operator gave.
 *
 * A root URL means the whole site; a URL with a path means that section only.
 * This is what keeps a localised site from producing a bilingual corpus:
 * eonyx.net serves the same content at /uk and /en, and crawling both would
 * hand the distiller half Ukrainian and half English — defeating the whole
 * point of detecting one language per brand.
 */
export function inScope(url: string, root: string): boolean {
  if (!sameOrigin(url, root)) return false;
  let rootPath: string;
  let path: string;
  try {
    rootPath = new URL(root).pathname.replace(/\/+$/, '');
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (isBoilerplatePath(path)) return false;
  if (!rootPath || rootPath === '/') return true;
  return path === rootPath || path.startsWith(`${rootPath}/`);
}
