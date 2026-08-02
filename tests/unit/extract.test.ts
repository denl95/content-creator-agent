import { describe, expect, test } from 'bun:test';
import { decodeEntities, extractText } from '../../src/ingest/extract';

const PAGE = `<!doctype html><html><head><title>Acme — Home</title>
<style>.x{color:red}</style></head><body>
<nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>
<header><h1>Acme Co</h1></header>
<main><article>
<h2>What we do</h2>
<p>We build custom tools for small businesses.</p>
<ul><li>Chatbots</li><li>Document automation</li></ul>
<p>Our tone is plain &amp; direct &mdash; It&#x27;s honest.</p>
</article></main>
<aside><p>Subscribe to our newsletter!</p></aside>
<footer><p>© 2026 Acme. All rights reserved.</p></footer>
<script>console.log('tracking')</script>
</body></html>`;

describe('decodeEntities', () => {
  test('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('It&#x27;s awesome &amp; fast')).toBe("It's awesome & fast");
    expect(decodeEntities('caf&#233;')).toBe('café');
  });

  test('decodes the guillemets the Ukrainian style guide uses', () => {
    expect(decodeEntities('&laquo;революційний&raquo; &mdash; ні')).toBe('«революційний» — ні');
  });

  test('leaves an unknown entity untouched rather than mangling it', () => {
    expect(decodeEntities('&unknownentity; stays')).toBe('&unknownentity; stays');
  });
});

describe('extractText', () => {
  test('keeps the title', () => {
    expect(extractText(PAGE).title).toBe('Acme — Home');
  });

  test('keeps article prose', () => {
    const { text } = extractText(PAGE);
    expect(text).toContain('We build custom tools for small businesses.');
    expect(text).toContain('Chatbots');
  });

  test('drops nav, header, aside, footer, script and style', () => {
    const { text } = extractText(PAGE);
    for (const boilerplate of [
      'About',
      'Subscribe',
      'All rights reserved',
      'tracking',
      'color:red',
    ]) {
      expect(text).not.toContain(boilerplate);
    }
  });

  test('decodes entities in the extracted body', () => {
    const { text } = extractText(PAGE);
    expect(text).toContain("Our tone is plain & direct — It's honest.");
    expect(text).not.toContain('&amp;');
  });

  test('nested boilerplate does not re-enable capture early', () => {
    // A depth counter rather than a boolean: onEndTag fires for the inner </li>
    // and </ul> too, which would resume capture inside the nav.
    expect(extractText(PAGE).text).not.toContain('Home');
  });

  test('text across inline element boundaries is not glued together', () => {
    // Observed on a live crawl of eonyx.net: "студія" followed by "з" in a
    // sibling span came back as "студіяз", and "даних" + "б'є" as "данихб'є".
    // Glued words make an exemplar worthless as evidence of how a brand writes.
    const html = '<p><span>R&amp;D-студія</span> <span>з впровадження</span></p>';
    expect(extractText(html).text).toContain('R&D-студія з впровадження');
    expect(extractText(html).text).not.toContain('студіяз');
  });

  test('keeps text held in inline wrappers, not only in block elements', () => {
    const html = '<div><span>Сегменти</span></div>';
    expect(extractText(html).text).toContain('Сегменти');
  });
});
