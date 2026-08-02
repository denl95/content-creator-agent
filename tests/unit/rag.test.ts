import { describe, expect, test } from 'bun:test';
import { corpusHash } from '../../src/tools/rag';

describe('corpusHash', () => {
  test('is stable regardless of document order', () => {
    const a = [
      { source: 'style_guide:1', content: 'RULES' },
      { source: 'profile:2', content: 'MISSION' },
    ];
    const b = [...a].reverse();
    expect(corpusHash(a)).toBe(corpusHash(b));
  });

  test('changes when content changes', () => {
    const a = [{ source: 'style_guide:1', content: 'RULES' }];
    const b = [{ source: 'style_guide:1', content: 'RULES v2' }];
    expect(corpusHash(a)).not.toBe(corpusHash(b));
  });

  test('changes when a document is added', () => {
    const a = [{ source: 'style_guide:1', content: 'RULES' }];
    const b = [...a, { source: 'exemplar:2', content: 'POST' }];
    expect(corpusHash(a)).not.toBe(corpusHash(b));
  });
});
