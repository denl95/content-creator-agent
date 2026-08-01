/**
 * Minimal in-process vector store. LangChain 1.x ships no in-memory vector store
 * (MemoryVectorStore existed in 0.x; the @langchain/community options need native
 * modules), and the brand corpus is small enough that a linear scan is fine.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class MemoryVectorStore {
  private entries: Array<{ text: string; vector: number[] }> = [];

  add(text: string, vector: number[]): void {
    this.entries.push({ text, vector });
  }

  get size(): number {
    return this.entries.length;
  }

  search(queryVector: number[], k: number): string[] {
    return this.entries
      .map((entry) => ({ text: entry.text, score: cosineSimilarity(queryVector, entry.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((scored) => scored.text);
  }
}
