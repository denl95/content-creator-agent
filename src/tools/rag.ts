import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { tool } from '@langchain/core/tools';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { z } from 'zod';

const BRAND_DIR = 'data/brand';

async function buildVectorStore(): Promise<MemoryVectorStore> {
  const glob = new Bun.Glob('**/*.md');
  const files = await Array.fromAsync(glob.scan(BRAND_DIR));

  if (files.length === 0) {
    throw new Error(`No .md files found in ${BRAND_DIR}. Run step 04 to seed the brand corpus.`);
  }

  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 });

  const allDocs = await Promise.all(
    files.map(async (file) => {
      const content = await Bun.file(`${BRAND_DIR}/${file}`).text();
      return splitter.createDocuments([content], [{ source: file }]);
    }),
  );

  const docs = allDocs.flat();
  const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
  return MemoryVectorStore.fromDocuments(docs, embeddings);
}

// module-level singleton — build once, reuse across nodes
let storePromise: Promise<MemoryVectorStore> | null = null;

function getStore(): Promise<MemoryVectorStore> {
  if (!storePromise) {
    storePromise = buildVectorStore();
  }
  return storePromise;
}

export const brandStyleRetriever = tool(
  async ({ query }) => {
    const store = await getStore();
    const results = await store.similaritySearch(query, 4);
    if (results.length === 0) return 'No relevant brand style documents found.';
    return results.map((doc) => doc.pageContent).join('\n---\n');
  },
  {
    name: 'brand_style_lookup',
    description:
      'Search the brand style guide, tone-of-voice rules, and approved example posts for Lumen. Use this before planning content to ensure alignment with brand voice and channel requirements.',
    schema: z.object({
      query: z
        .string()
        .describe("What to look up, e.g. 'LinkedIn tone rules' or 'forbidden phrases'"),
    }),
  },
);
