import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/markdown';

const render = (source: string) => renderToStaticMarkup(<Markdown source={source} />);

describe('Markdown', () => {
  test('renders heading levels as distinct elements', () => {
    const html = render('# One\n\n## Two\n\n### Three');
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('<h3');
  });

  test('renders emphasis and lists rather than their source characters', () => {
    const html = render('**bold**\n\n- first\n- second');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<li>');
    expect(html).not.toContain('**bold**');
  });

  test('renders GFM tables', () => {
    const html = render('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table');
  });

  test('escapes raw HTML instead of rendering it', () => {
    // The security property this component exists to hold. Brand documents are
    // distilled from crawled pages, so the source is attacker-influenced.
    const html = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>');
    // No element is created…
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    // …and the payload survives as visible, inert text. Asserting
    // not.toContain('onerror') would fail here: the substring is present and
    // harmless, which is the whole point.
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  test('opens links in a new tab without leaking the referrer', () => {
    const html = render('[x](https://example.com)');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  test('renders nothing for empty source rather than throwing', () => {
    expect(render('')).toBe('');
  });
});
