import { describe, expect, test } from 'bun:test';
import { cosineSimilarity, MemoryVectorStore } from '../../src/tools/memoryVectorStore';

describe('cosineSimilarity', () => {
  test('identical vectors score 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  test('orthogonal vectors score 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  test('magnitude does not affect similarity', () => {
    expect(cosineSimilarity([1, 1], [5, 5])).toBeCloseTo(1, 6);
  });

  test('a zero vector scores 0 rather than NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('MemoryVectorStore', () => {
  test('returns the k most similar texts, most similar first', () => {
    const store = new MemoryVectorStore();
    store.add('exact', [1, 0, 0]);
    store.add('close', [0.9, 0.1, 0]);
    store.add('far', [0, 0, 1]);
    expect(store.size).toBe(3);
    expect(store.search([1, 0, 0], 2)).toEqual(['exact', 'close']);
  });

  test('k larger than the corpus returns everything without error', () => {
    const store = new MemoryVectorStore();
    store.add('only', [1, 0]);
    expect(store.search([1, 0], 10)).toEqual(['only']);
  });

  test('an empty store returns an empty array', () => {
    expect(new MemoryVectorStore().search([1, 0], 4)).toEqual([]);
  });
});
