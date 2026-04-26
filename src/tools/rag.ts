import crypto from 'node:crypto';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Document } from '@langchain/core/documents';
import { tool } from '@langchain/core/tools';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Collection, CollectionMetadata } from 'chromadb';
import { z } from 'zod';
import { type BrandPage, fetchBrandPages } from '../mcp/notion';

const BRAND_DIR = 'data/brand';
const COLLECTION = process.env.CHROMA_COLLECTION ?? 'brand';

const _chromaUrl = new URL(process.env.CHROMA_URL ?? 'http://localhost:8000');
const CHROMA_PARAMS = {
  host: _chromaUrl.hostname,
  port: _chromaUrl.port ? Number(_chromaUrl.port) : _chromaUrl.protocol === 'https:' ? 443 : 8000,
  ssl: _chromaUrl.protocol === 'https:',
};

type SourceDoc = {
  source: string; // e.g. "notion:abc123" or "file:brand.md"
  content: string;
};

async function loadFromNotion(): Promise<SourceDoc[] | null> {
  const parentId = process.env.NOTION_BRAND_PAGE_ID;
  if (!process.env.NOTION_TOKEN || !parentId) return null;

  try {
    const pages: BrandPage[] = await fetchBrandPages(parentId);
    if (pages.length === 0) {
      console.warn('[rag] Notion parent page has no child pages — falling back to local files');
      return null;
    }
    console.log(`[rag] Loaded ${pages.length} brand pages from Notion`);
    return pages.map((p) => ({
      source: `notion:${p.id}`,
      content: `# ${p.title}\n\n${p.content}`,
    }));
  } catch (err) {
    console.warn(
      `[rag] Notion fetch failed (${err instanceof Error ? err.message : String(err)}) — falling back to local files`,
    );
    return null;
  }
}

async function loadFromLocal(): Promise<SourceDoc[]> {
  const glob = new Bun.Glob('**/*.md');
  const files = await Array.fromAsync(glob.scan(BRAND_DIR));
  if (files.length === 0) {
    throw new Error(`No .md files found in ${BRAND_DIR} and Notion is unavailable.`);
  }
  return Promise.all(
    files.map(async (file) => {
      try {
        const content = await Bun.file(`${BRAND_DIR}/${file}`).text();
        return { source: `file:${file}`, content };
      } catch (err) {
        throw new Error(
          `Failed to read brand file "${file}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );
}

function corpusHash(docs: SourceDoc[]): string {
  const h = crypto.createHash('sha256');
  // Sort to make hash stable regardless of fetch order
  const sorted = [...docs].sort((a, b) => a.source.localeCompare(b.source));
  for (const d of sorted) {
    h.update(d.source);
    h.update('\0');
    h.update(d.content);
    h.update('\0');
  }
  return h.digest('hex');
}

async function createVectorStore(): Promise<{ store: Chroma; collection: Collection }> {
  const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
  const store = new Chroma(embeddings, {
    collectionName: COLLECTION,
    clientParams: CHROMA_PARAMS,
    collectionMetadata: { 'hnsw:space': 'cosine' },
  });

  const collection = await store.ensureCollection();
  return { store, collection };
}

function collectionMetadata(collection: Collection): CollectionMetadata {
  return collection.metadata ?? {};
}

async function cachedCorpusHash(collection: Collection): Promise<string | null> {
  const meta = collectionMetadata(collection);
  if (typeof meta.corpus_hash !== 'string' || meta.corpus_hash.length === 0) return null;
  if ((await collection.count()) === 0) return null;
  return meta.corpus_hash;
}

async function buildVectorStore(forceReindex = false): Promise<Chroma> {
  const { store, collection } = await createVectorStore();
  const cachedHash = await cachedCorpusHash(collection);

  if (!forceReindex && cachedHash) {
    console.log(
      `[rag] Chroma collection "${COLLECTION}" is up-to-date (hash=${cachedHash.slice(0, 8)})`,
    );
    return store;
  }

  const docs = (await loadFromNotion()) ?? (await loadFromLocal());
  const hash = corpusHash(docs);
  const existingMeta = collectionMetadata(collection);

  console.log(
    `[rag] Reindexing Chroma collection "${COLLECTION}" — ${docs.length} source docs (hash=${hash.slice(0, 8)})`,
  );

  const nextMetadata = { ...existingMeta, 'hnsw:space': 'cosine', corpus_hash: hash };

  // Wipe existing collection and rebuild
  try {
    await store.delete({ filter: {} });
  } catch {
    // ignore — collection may have just been created
  }

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 });
  const allChunks = await Promise.all(
    docs.map((d) => splitter.createDocuments([d.content], [{ source: d.source }])),
  );
  const documents = allChunks.flat().map(
    (c) =>
      new Document({
        pageContent: c.pageContent,
        metadata: c.metadata as Record<string, unknown>,
      }),
  );
  await store.addDocuments(documents);
  await collection.modify({ metadata: nextMetadata });

  return store;
}

let storePromise: Promise<Chroma> | null = null;

function getStore(): Promise<Chroma> {
  if (!storePromise) storePromise = buildVectorStore();
  return storePromise;
}

export async function reindex(): Promise<void> {
  storePromise = buildVectorStore(true);
  await storePromise;
}

export const brandStyleRetriever = tool(
  async ({ query }) => {
    console.log(`[brand_style_lookup] "${query}"`);
    const store = await getStore();
    const results = await store.similaritySearch(query, 4);
    if (results.length === 0) return 'No relevant brand style documents found.';
    console.log(`[brand_style_lookup] ${results.length} chunks returned`);
    return results.map((doc) => doc.pageContent).join('\n---\n');
  },
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
