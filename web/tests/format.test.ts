import { describe, expect, test } from 'bun:test';
import { slugifyTopic } from '../lib/format';

describe('slugifyTopic', () => {
  test('keeps Ukrainian letters rather than stripping them to nothing', () => {
    // \p{L} not [a-z]: a Ukrainian topic must not produce an empty filename.
    expect(slugifyTopic('Як LLM-асистент замінив менеджера')).toBe(
      'як-llm-асистент-замінив-менеджера',
    );
  });

  test('lowercases and joins words with single hyphens', () => {
    expect(slugifyTopic('How an AI  Assistant Saves Time')).toBe(
      'how-an-ai-assistant-saves-time',
    );
  });

  test('trims leading and trailing separators', () => {
    expect(slugifyTopic('  —Hello, world!  ')).toBe('hello-world');
  });

  test('caps length so a long topic cannot produce an unusable filename', () => {
    expect(slugifyTopic('word '.repeat(50)).length).toBeLessThanOrEqual(60);
  });

  test('returns an empty string when nothing survives, for the caller to replace', () => {
    expect(slugifyTopic('!!! ???')).toBe('');
  });
});
