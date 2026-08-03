import dns from 'node:dns/promises';
import { FETCH_TIMEOUT_MS, INGEST_USER_AGENT } from './types';

/**
 * The ingest form takes a URL from a user and this process fetches it, then
 * stores the body where `GET /brands/:id` will read it back. Without a check
 * that is a read-capable SSRF: `http://169.254.169.254/...` returns cloud
 * instance credentials, `http://localhost:8080/...` reaches the dashboard's own
 * internals, and either lands in `brand_documents` for the caller to read.
 *
 * The password gate narrows who can do it, not what it reaches — an internal
 * network is exactly what an attacker wants a trusted server to fetch for them.
 */

const BLOCKED_V4 = [
  { label: 'this network', test: (o: number[]) => o[0] === 0 },
  { label: 'loopback', test: (o: number[]) => o[0] === 127 },
  { label: 'private', test: (o: number[]) => o[0] === 10 },
  {
    label: 'private',
    test: (o: number[]) => o[0] === 172 && (o[1] ?? 0) >= 16 && (o[1] ?? 0) <= 31,
  },
  { label: 'private', test: (o: number[]) => o[0] === 192 && o[1] === 168 },
  { label: 'link-local / cloud metadata', test: (o: number[]) => o[0] === 169 && o[1] === 254 },
  {
    label: 'carrier-grade NAT',
    test: (o: number[]) => o[0] === 100 && (o[1] ?? 0) >= 64 && (o[1] ?? 0) <= 127,
  },
];

export function isBlockedAddress(address: string): string | null {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (host.includes(':')) {
    // IPv6. ::1 is loopback, fc00::/7 unique-local, fe80::/10 link-local.
    if (host === '::' || host === '::1') return 'IPv6 loopback';
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return 'IPv6 unique-local';
    if (/^fe[89ab][0-9a-f]:/.test(host)) return 'IPv6 link-local';
    // ::ffff:127.0.0.1 — an IPv4 address wearing an IPv6 coat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return null;
  }

  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null; // Not an IPv4 literal — a hostname, resolved by the caller.
  }
  return BLOCKED_V4.find((r) => r.test(octets))?.label ?? null;
}

/**
 * Reject a URL whose host resolves anywhere private. DNS is resolved here
 * rather than trusting the literal, because `internal.example.com` pointing at
 * 10.0.0.5 is the same attack wearing a public name.
 */
export async function assertPublicUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch ${url.protocol}// — only http and https are allowed`);
  }

  const literal = isBlockedAddress(url.hostname);
  if (literal) throw new Error(`Refusing to fetch ${url.hostname} — ${literal} address`);

  let resolved: Array<{ address: string }>;
  try {
    resolved = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve ${url.hostname}`);
  }
  for (const { address } of resolved) {
    const blocked = isBlockedAddress(address);
    if (blocked) {
      throw new Error(`Refusing to fetch ${url.hostname} — it resolves to a ${blocked} address`);
    }
  }
}

/**
 * Fetch with every redirect hop validated.
 *
 * `redirect: 'follow'` would let a public URL bounce to an internal one, so
 * redirects are resolved by hand and each destination re-checked before the
 * next request is made.
 */
export async function safeFetch(raw: string, maxHops = 5): Promise<Response | null> {
  let target = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicUrl(target);
    let res: Response;
    try {
      res = await fetch(target, {
        headers: { 'user-agent': INGEST_USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch {
      return null;
    }
    if (res.status < 300 || res.status > 399) return res;

    const location = res.headers.get('location');
    if (!location) return res;
    target = new URL(location, target).toString();
  }
  throw new Error(`Too many redirects starting at ${raw}`);
}
