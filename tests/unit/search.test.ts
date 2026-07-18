import { describe, expect, test } from 'bun:test';
import { resetSearchCount, takeSearchSlot } from '../../src/tools/search';

describe('takeSearchSlot', () => {
  test('caps per thread independently', () => {
    resetSearchCount('a');
    resetSearchCount('b');
    const cap = Number(process.env.MAX_SEARCHES ?? 10);
    for (let i = 1; i <= cap; i++) expect(takeSearchSlot('a')).toBe(i);
    expect(takeSearchSlot('a')).toBeNull();
    expect(takeSearchSlot('b')).toBe(1);
  });

  test('reset clears a single thread', () => {
    resetSearchCount('c');
    takeSearchSlot('c');
    resetSearchCount('c');
    expect(takeSearchSlot('c')).toBe(1);
    resetSearchCount('c');
  });
});
