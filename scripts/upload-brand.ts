import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import 'dotenv/config';
import { createBrandPage, shutdownNotionMcp } from '../src/mcp/notion';

const BRAND_DIR = join(import.meta.dir, '../data/brand');

function titleFromFile(filePath: string, content: string): string {
  const h1 = content.match(/^#\s+(.+)/m);
  if (h1) return h1[1].trim();
  const rel = relative(BRAND_DIR, filePath).replace(/\\/g, '/');
  return rel
    .replace(extname(rel), '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      files.push(full);
    }
  }
  return files.sort();
}

async function main(): Promise<void> {
  const parentPageId = process.env.NOTION_BRAND_PAGE_ID;
  if (!parentPageId) {
    console.error('NOTION_BRAND_PAGE_ID is not set in .env');
    process.exit(1);
  }

  const files = await collectFiles(BRAND_DIR);
  console.log(`Found ${files.length} file(s) in data/brand/\n`);

  for (const filePath of files) {
    const rel = relative(BRAND_DIR, filePath);
    const content = await readFile(filePath, 'utf-8');
    const title = titleFromFile(filePath, content);

    process.stdout.write(`  Uploading "${title}" (${rel})... `);
    try {
      const page = await createBrandPage({ parentPageId, title, content });
      console.log(`done → ${page.url}`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('Upload failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(() => shutdownNotionMcp());
