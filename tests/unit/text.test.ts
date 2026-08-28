import { describe, expect, test } from 'bun:test';
import { countWords, markdownToPlainText } from '../../src/utils/text';

describe('countWords', () => {
  test('counts whitespace-separated words', () => {
    expect(countWords('one two  three\nfour')).toBe(4);
  });

  test('handles markdown and unicode', () => {
    expect(countWords('# Заголовок\n\n**жирний** текст')).toBe(3);
  });

  test('returns 0 for empty or whitespace-only input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
  });
});

describe('markdownToPlainText', () => {
  test('strips ATX heading markers, keeping the text', () => {
    expect(markdownToPlainText('# One\n\n## Two\n\n###### Six')).toBe('One\n\nTwo\n\nSix');
  });

  test('turns bullets into • and leaves numbered items alone', () => {
    expect(markdownToPlainText('- first\n* second\n+ third')).toBe('• first\n• second\n• third');
    expect(markdownToPlainText('1. first\n2. second')).toBe('1. first\n2. second');
  });

  test('unwraps emphasis, strong and inline code', () => {
    expect(markdownToPlainText('**bold** and *em* and __b__ and _e_ and `code`')).toBe(
      'bold and em and b and e and code',
    );
  });

  test('unwraps emphasis nested inside strong, leaving no stray asterisk', () => {
    // `[^*]+` cannot span the inner pair, so the outer `**` never matches and
    // the delimiters survive into a public post.
    expect(markdownToPlainText('**bold *italic* inside**')).toBe('bold italic inside');
    expect(markdownToPlainText('This is **bold with *nested* emphasis** here.')).toBe(
      'This is bold with nested emphasis here.',
    );
  });

  test('keeps a code span verbatim even when it contains emphasis characters', () => {
    expect(markdownToPlainText('Check out `*args` and `**kwargs` in Python.')).toBe(
      'Check out *args and **kwargs in Python.',
    );
  });

  test('renders links and images as text followed by the url', () => {
    expect(markdownToPlainText('See [our site](https://eonyx.net) today')).toBe(
      'See our site (https://eonyx.net) today',
    );
    expect(markdownToPlainText('![a logo](https://eonyx.net/logo.png)')).toBe(
      'a logo (https://eonyx.net/logo.png)',
    );
  });

  test('leaves underscores in urls alone, linked or bare', () => {
    // The emphasis rule would otherwise eat `_page_` and post a dead link.
    expect(markdownToPlainText('[read](https://eonyx.net/my_page_name)')).toBe(
      'read (https://eonyx.net/my_page_name)',
    );
    expect(markdownToPlainText('Visit https://eonyx.net/my_page_name today')).toBe(
      'Visit https://eonyx.net/my_page_name today',
    );
  });

  test('keeps fenced code contents and drops the fences', () => {
    expect(markdownToPlainText('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  test('drops quote markers and horizontal rules', () => {
    expect(markdownToPlainText('> quoted\n\n---\n\nafter')).toBe('quoted\n\nafter');
  });

  test('collapses runs of blank lines to one and trims', () => {
    expect(markdownToPlainText('\n\na\n\n\n\nb\n\n')).toBe('a\n\nb');
  });

  test('leaves Ukrainian prose untouched', () => {
    expect(markdownToPlainText('## Заголовок\n\n**жирний** текст')).toBe(
      'Заголовок\n\nжирний текст',
    );
  });

  test('converts a realistic draft without leaving markdown syntax behind', () => {
    const draft = [
      '# How AI Saves You 10 Hours',
      '',
      'Most owners **underestimate** this.',
      '',
      '## Where the hours go',
      '',
      '- Inbox triage — 2 hours',
      '- Reporting — 3 hours',
      '',
      'Read more at [our blog](https://eonyx.net/blog).',
    ].join('\n');
    const out = markdownToPlainText(draft);
    expect(out).not.toContain('#');
    expect(out).not.toContain('**');
    expect(out).not.toContain('](');
    expect(out).toContain('• Inbox triage — 2 hours');
    expect(out).toContain('our blog (https://eonyx.net/blog)');
  });
});
