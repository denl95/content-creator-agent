import { describe, expect, test } from 'bun:test';
import { assembleCorpusInput, renderProfile, renderStyleGuide } from '../../src/ingest/render';

const profile = {
  name: 'Acme',
  mission: 'Make tools simple.',
  services: ['Chatbots', 'Automation'],
  audience_primary: 'SMB owners',
  audience_secondary: 'Ops managers',
  positioning: 'Cheaper than agencies.',
  channels: [
    {
      channel: 'linkedin',
      description: 'Educational',
      word_range: '800-1200',
      cadence: 'Weekly',
    },
  ],
};

const guide = {
  voice: ['Plain and direct'],
  forbidden_phrases: ['revolutionary'],
  preferred_constructions: ['Second person'],
  formatting_rules: ['H2 for sections'],
  language: 'en',
};

describe('renderProfile', () => {
  test('produces the brand.md shape the corpus has always used', () => {
    const md = renderProfile(profile);
    expect(md).toContain('# Acme');
    expect(md).toContain('Make tools simple.');
    expect(md).toContain('Chatbots');
    expect(md).toContain('linkedin');
  });

  test('omits the secondary audience line when there is none', () => {
    expect(renderProfile({ ...profile, audience_secondary: '' })).not.toContain('Secondary:');
  });
});

describe('renderStyleGuide', () => {
  test('lists forbidden phrases, which the editor checks against', () => {
    const md = renderStyleGuide(guide);
    expect(md).toContain('revolutionary');
    expect(md).toContain('Plain and direct');
  });

  test('an empty forbidden list renders without an empty heading dangling', () => {
    const md = renderStyleGuide({ ...guide, forbidden_phrases: [] });
    expect(md).not.toContain('## Forbidden');
  });
});

describe('assembleCorpusInput', () => {
  test('puts posts before pages, since posts are the better voice evidence', () => {
    const out = assembleCorpusInput(
      [
        { url: 'a', title: 'Page', text: 'PAGE TEXT', kind: 'page' },
        { url: 'b', title: 'Post', text: 'POST TEXT', kind: 'post' },
      ],
      10_000,
    );
    expect(out.indexOf('POST TEXT')).toBeLessThan(out.indexOf('PAGE TEXT'));
  });

  test('truncates at a document boundary rather than mid-document', () => {
    const docs = [
      { url: 'a', title: 'A', text: 'x'.repeat(300), kind: 'post' as const },
      { url: 'b', title: 'B', text: 'y'.repeat(300), kind: 'post' as const },
    ];
    const out = assembleCorpusInput(docs, 400);
    expect(out).toContain('x'.repeat(300));
    expect(out).not.toContain('y');
  });

  test('labels each block with its kind, so the distiller can weigh them', () => {
    const out = assembleCorpusInput([{ url: 'a', title: 'A', text: 'body', kind: 'post' }], 10_000);
    expect(out).toContain('--- POST: A (a) ---');
  });
});
