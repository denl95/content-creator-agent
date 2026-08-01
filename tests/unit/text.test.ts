import { describe, expect, test } from 'bun:test';
import { countWords } from '../../src/utils/text';

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
