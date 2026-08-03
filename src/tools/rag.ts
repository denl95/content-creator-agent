import crypto from 'node:crypto';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Document } from '@langchain/core/documents';
import { tool } from '@langchain/core/tools';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Collection } from 'chromadb';
import { z } from 'zod';
import { reportActivity } from '../activity';
import { getBrand, getBrandCorpus, setBrandCorpusHash } from '../brands';
import { MemoryVectorStore } from './memoryVectorStore';

const VECTOR_STORE = process.env.VECTOR_STORE ?? 'chroma';

const _chromaUrl = new URL(process.env.CHROMA_URL ?? 'http://localhost:8000');
const CHROMA_PARAMS = {
  host: _chromaUrl.hostname,
  port: _chromaUrl.port ? Number(_chromaUrl.port) : _chromaUrl.protocol === 'https:' ? 443 : 8000,
  ssl: _chromaUrl.protocol === 'https:',
};

export type SourceDoc = {
  source: string; // e.g. "style_guide:<id>"
  content: string;
};

/**
 * Stable across document order, so a reordered corpus does not force a rebuild.
 * Exported because it is the one piece of this module testable without a
 * network call or an embedding.
 */
export function corpusHash(docs: SourceDoc[]): string {
  const h = crypto.createHash('sha256');
  const sorted = [...docs].sort((a, b) => a.source.localeCompare(b.source));
  for (const d of sorted) {
    h.update(d.source);
    h.update('\0');
    h.update(d.content);
    h.update('\0');
  }
  return h.digest('hex');
}

/**
 * A brand's embeddable corpus, from SQLite. `loadFromNotion` and
 * `loadFromLocal` are gone: files and Notion are seed-time importers now
 * (`scripts/seed-brand.ts`), which also removes the startup `npx` hazard
 * NOTION_BRAND_PAGE_ID carried in production.
 */
async function loadCorpus(brandId: string): Promise<SourceDoc[]> {
  const docs = await getBrandCorpus(brandId);
  if (docs.length === 0) {
    throw new Error(
      `Brand ${brandId} has no included documents — run "bun run seed-brand", or ingest a corpus.`,
    );
  }
  return docs;
}

async function chunk(docs: SourceDoc[]): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 });
  const lists = await Promise.all(
    docs.map((d) => splitter.createDocuments([d.content], [{ source: d.source }])),
  );
  return lists.flat().map(
    (c) =>
      new Document({
        pageContent: c.pageContent,
        metadata: c.metadata as Record<string, unknown>,
      }),
  );
}

function embeddings(): OpenAIEmbeddings {
  return new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
}

// One store per brand, per process. Both backends key on brand id, so callers
// never learn which is in use.
const chromaStores = new Map<string, Promise<Chroma>>();
const memoryStores = new Map<string, Promise<MemoryVectorStore>>();

async function createChroma(
  collectionName: string,
): Promise<{ store: Chroma; collection: Collection }> {
  const store = new Chroma(embeddings(), {
    collectionName,
    clientParams: CHROMA_PARAMS,
    collectionMetadata: { 'hnsw:space': 'cosine' },
  });
  const collection = await store.ensureCollection();
  return { store, collection };
}

async function buildChromaStore(brandId: string, forceReindex: boolean): Promise<Chroma> {
  const brand = await getBrand(brandId);
  if (!brand) throw new Error(`Brand ${brandId} not found`);

  const { store, collection } = await createChroma(brand.collection_name);
  const populated = (await collection.count()) > 0;

  if (!forceReindex && populated && brand.corpus_hash) {
    const docs = await loadCorpus(brandId);
    if (corpusHash(docs) === brand.corpus_hash) {
      console.log(
        `[rag] Collection "${brand.collection_name}" is up-to-date (hash=${brand.corpus_hash.slice(0, 8)})`,
      );
      return store;
    }
  }

  const docs = await loadCorpus(brandId);
  const hash = corpusHash(docs);
  console.log(
    `[rag] Reindexing "${brand.collection_name}" — ${docs.length} source docs (hash=${hash.slice(0, 8)})`,
  );

  try {
    await store.delete({ filter: {} });
  } catch {
    // Collection may have just been created — nothing to delete.
  }
  await store.addDocuments(await chunk(docs));
  await setBrandCorpusHash(brandId, hash);
  return store;
}

function getChromaStore(brandId: string): Promise<Chroma> {
  const cached = chromaStores.get(brandId);
  if (cached) return cached;
  const built = buildChromaStore(brandId, false);
  chromaStores.set(brandId, built);
  return built;
}

async function buildMemoryStore(brandId: string): Promise<MemoryVectorStore> {
  const docs = await loadCorpus(brandId);
  const texts = (await chunk(docs)).map((c) => c.pageContent);
  const vectors = await embeddings().embedDocuments(texts);

  const store = new MemoryVectorStore();
  texts.forEach((text, i) => {
    const vector = vectors[i];
    if (vector) store.add(text, vector);
  });
  await setBrandCorpusHash(brandId, corpusHash(docs));
  console.log(`[rag] Built in-process store — ${store.size} chunks from ${docs.length} docs`);
  return store;
}

function getMemoryStore(brandId: string): Promise<MemoryVectorStore> {
  const cached = memoryStores.get(brandId);
  if (cached) return cached;
  const built = buildMemoryStore(brandId);
  memoryStores.set(brandId, built);
  return built;
}

export async function reindex(brandId: string): Promise<void> {
  chromaStores.delete(brandId);
  memoryStores.delete(brandId);
  if (VECTOR_STORE === 'memory') {
    memoryStores.set(brandId, buildMemoryStore(brandId));
    await memoryStores.get(brandId);
    return;
  }
  const built = buildChromaStore(brandId, true);
  chromaStores.set(brandId, built);
  await built;
}

async function lookupMemory(query: string, brandId: string): Promise<string[]> {
  const store = await getMemoryStore(brandId);
  return store.search(await embeddings().embedQuery(query), 4);
}

async function lookupChroma(query: string, brandId: string): Promise<string[]> {
  const store = await getChromaStore(brandId);
  const docs = await store.similaritySearch(query, 4);
  return docs.map((doc) => doc.pageContent);
}

/**
 * Reporting lives here rather than in the tool wrapper because the Editor calls
 * this directly, with no tool-calling agent in between — moving it outward
 * would silence the activity feed for exactly half the lookups.
 */
export async function lookupBrandStyle(
  query: string,
  brandId: string,
  threadId?: string,
): Promise<string> {
  reportActivity(threadId, { kind: 'brand_style_lookup', detail: `"${query}"` });
  const texts =
    VECTOR_STORE === 'memory'
      ? await lookupMemory(query, brandId)
      : await lookupChroma(query, brandId);
  if (texts.length === 0) return 'No relevant brand style documents found.';
  return texts.join('\n---\n');
}

/**
 * A factory rather than a module-scope tool: `createAgent` binds tools at
 * construction, so the brand has to be closed over per run. The strategist node
 * is where `state.brief` is in scope.
 */
export function makeBrandStyleRetriever(brandId: string) {
  return tool(
    // lookupBrandStyle does the reporting; the step is inherited from the
    // calling node, since a tool cannot name its own (see reportActivity).
    async ({ query }: { query: string }, config?: { configurable?: { thread_id?: string } }) =>
      lookupBrandStyle(query, brandId, config?.configurable?.thread_id),
    {
      name: 'brand_style_lookup',
      description:
        'Search the brand style guide, tone-of-voice rules, and approved example posts. Use this before planning content to ensure alignment with brand voice and channel requirements.',
      schema: z.object({
        query: z
          .string()
          .describe("What to look up, e.g. 'LinkedIn tone rules' or 'forbidden phrases'"),
      }),
    },
  );
}
