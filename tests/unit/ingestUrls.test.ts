import { describe, expect, test } from 'bun:test';
import {
  inScope,
  isAllowed,
  normalizeUrl,
  parseRobots,
  parseSitemap,
  sameOrigin,
} from '../../src/ingest/urls';

describe('normalizeUrl', () => {
  test('resolves relative links against the base', () => {
    expect(normalizeUrl('/about', 'https://acme.com/blog/')).toBe('https://acme.com/about');
  });

  test('drops the fragment and trailing slash so one page is not crawled twice', () => {
    expect(normalizeUrl('https://acme.com/about/#team', 'https://acme.com')).toBe(
      'https://acme.com/about',
    );
  });

  test('strips tracking parameters but keeps meaningful query', () => {
    expect(normalizeUrl('https://acme.com/p?utm_source=x&id=7', 'https://acme.com')).toBe(
      'https://acme.com/p?id=7',
    );
  });

  test('rejects non-http schemes', () => {
    expect(normalizeUrl('mailto:hi@acme.com', 'https://acme.com')).toBeNull();
    expect(normalizeUrl('javascript:void(0)', 'https://acme.com')).toBeNull();
  });
});

describe('sameOrigin', () => {
  test('matches host and scheme, not path', () => {
    expect(sameOrigin('https://acme.com/a', 'https://acme.com/b')).toBe(true);
    expect(sameOrigin('https://acme.com', 'https://blog.acme.com')).toBe(false);
    expect(sameOrigin('https://acme.com', 'http://acme.com')).toBe(false);
  });
});

describe('parseSitemap', () => {
  test('reads urlset entries', () => {
    const xml = `<urlset><url><loc>https://acme.com/a</loc></url><url><loc>https://acme.com/b</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual(['https://acme.com/a', 'https://acme.com/b']);
  });

  test('reads sitemap-index entries too, so nested sitemaps are followed', () => {
    const xml = `<sitemapindex><sitemap><loc>https://acme.com/s1.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(xml)).toEqual(['https://acme.com/s1.xml']);
  });
});

describe('robots.txt', () => {
  test('collects Disallow rules for the wildcard agent', () => {
    const txt = ['User-agent: *', 'Disallow: /admin', 'Disallow: /cart', 'Allow: /'].join('\n');
    const rules = parseRobots(txt, 'eonyx-brand-ingest');
    expect(rules.disallow).toContain('/admin');
    expect(isAllowed('/admin/users', rules)).toBe(false);
    expect(isAllowed('/about', rules)).toBe(true);
  });

  test('a named group for our agent wins over the wildcard', () => {
    const txt = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: eonyx-brand-ingest',
      'Disallow: /private',
    ].join('\n');
    const rules = parseRobots(txt, 'eonyx-brand-ingest');
    expect(isAllowed('/about', rules)).toBe(true);
    expect(isAllowed('/private/x', rules)).toBe(false);
  });

  test('an empty file allows everything', () => {
    expect(isAllowed('/anything', parseRobots('', 'eonyx-brand-ingest'))).toBe(true);
  });

  test("eonyx.net's own robots.txt allows the whole site", () => {
    // Verified live on 2026-08-02 — the shape this is modelled on.
    const txt = ['User-Agent: *', 'Allow: /', '', 'Sitemap: https://eonyx.net/sitemap.xml'].join(
      '\n',
    );
    expect(isAllowed('/uk', parseRobots(txt, 'eonyx-brand-ingest/1.0'))).toBe(true);
  });
});

describe('inScope', () => {
  test('a root URL admits the whole site', () => {
    expect(inScope('https://acme.com/anything', 'https://acme.com')).toBe(true);
  });

  test('a sectioned URL keeps the crawl inside that section', () => {
    // eonyx.net serves the same content at /uk and /en; crawling both would
    // hand the distiller half Ukrainian and half English.
    expect(inScope('https://eonyx.net/uk', 'https://eonyx.net/uk')).toBe(true);
    expect(inScope('https://eonyx.net/uk/cases', 'https://eonyx.net/uk')).toBe(true);
    expect(inScope('https://eonyx.net/en', 'https://eonyx.net/uk')).toBe(false);
  });

  test('a section prefix does not match a longer sibling segment', () => {
    expect(inScope('https://acme.com/ukraine', 'https://acme.com/uk')).toBe(false);
  });

  test('legal boilerplate is excluded even inside the scope', () => {
    expect(inScope('https://eonyx.net/uk/privacy', 'https://eonyx.net/uk')).toBe(false);
    expect(inScope('https://acme.com/terms', 'https://acme.com')).toBe(false);
    expect(inScope('https://acme.com/cookie-policy', 'https://acme.com')).toBe(false);
  });

  test('another origin is never in scope', () => {
    expect(inScope('https://other.com/uk', 'https://eonyx.net/uk')).toBe(false);
  });
});
