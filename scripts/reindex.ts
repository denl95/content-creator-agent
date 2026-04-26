import 'dotenv/config';
import { shutdownNotionMcp } from '../src/mcp/notion';
import { reindex } from '../src/tools/rag';

async function main(): Promise<void> {
  console.log('[reindex] Force-rebuilding Chroma collection from current brand corpus...');
  try {
    await reindex();
    console.log('[reindex] Done.');
  } finally {
    await shutdownNotionMcp();
  }
}

main().catch((err) => {
  console.error('[reindex] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
