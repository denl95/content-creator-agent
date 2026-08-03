import { describe, expect, test } from 'bun:test';
import { splitPasted } from '../../src/ingest/fetchers/paste';
import { parseFeed } from '../../src/ingest/fetchers/rss';

const RSS = `<rss><channel>
  <item><title>First post</title><link>https://acme.com/1</link>
    <description>&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;</description></item>
  <item><title>Second</title><link>https://acme.com/2</link>
    <content:encoded><![CDATA[<p>Body two</p>]]></content:encoded></item>
</channel></rss>`;

const ATOM = `<feed><entry><title>Atom one</title>
  <link href="https://acme.com/a"/><content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
</entry></feed>`;

describe('parseFeed', () => {
  test('reads RSS items, preferring content:encoded over description', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('First post');
    expect(items[0]?.body).toContain('Hello & welcome');
    expect(items[1]?.body).toContain('Body two');
  });

  test('strips markup from feed bodies', () => {
    expect(parseFeed(RSS)[0]?.body).not.toContain('<p>');
  });

  test('reads Atom entries and their href links', () => {
    const items = parseFeed(ATOM);
    expect(items[0]?.title).toBe('Atom one');
    expect(items[0]?.link).toBe('https://acme.com/a');
    expect(items[0]?.body).toContain('Atom body');
  });

  test('returns an empty list for unparseable input rather than throwing', () => {
    expect(parseFeed('not xml at all')).toEqual([]);
  });
});

describe('splitPasted', () => {
  test('splits on a --- delimiter line and trims', () => {
    expect(splitPasted('one\n---\ntwo\n---\n three ')).toEqual(['one', 'two', 'three']);
  });

  test('a single post with no delimiter is one entry', () => {
    expect(splitPasted('just one post')).toEqual(['just one post']);
  });

  test('ignores empty blocks from trailing delimiters', () => {
    expect(splitPasted('one\n---\n\n---\n')).toEqual(['one']);
  });

  test('keeps blank lines inside a post, which social copy relies on', () => {
    expect(splitPasted('line one\n\nline two')).toEqual(['line one\n\nline two']);
  });
});
