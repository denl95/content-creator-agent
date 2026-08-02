import 'dotenv/config';
import { createBrand, getDefaultBrand, setDefaultBrand } from '../src/brands';
import { getDb } from '../src/db';

const BRAND_DIR = 'data/brand';

/**
 * Classify a corpus file into the three document kinds the pipeline retrieves.
 * Mirrors the shape phase 2's distiller will emit, so an ingested brand and a
 * seeded one are indistinguishable downstream.
 */
function kindFor(file: string): string {
  if (file.startsWith('examples/')) return 'exemplar';
  if (file.includes('style')) return 'style_guide';
  return 'profile';
}

async function readCorpus(): Promise<Array<{ kind: string; title: string; content: string }>> {
  const glob = new Bun.Glob('**/*.md');
  const files = (await Array.fromAsync(glob.scan(BRAND_DIR))).sort();
  if (files.length === 0) throw new Error(`No .md files found in ${BRAND_DIR}`);
  return Promise.all(
    files.map(async (file) => ({
      kind: kindFor(file),
      title: file.replace(/\.md$/, ''),
      content: await Bun.file(`${BRAND_DIR}/${file}`).text(),
    })),
  );
}

async function main(): Promise<void> {
  const existing = await getDefaultBrand();
  if (existing) {
    console.log(`[seed] Default brand already exists (${existing.name}) — nothing to do.`);
    return;
  }

  const docs = await readCorpus();
  const brand = await createBrand({
    name: 'EONYX',
    slug: 'eonyx',
    language: 'uk',
    status: 'active',
  });
  const db = getDb();

  for (const doc of docs) {
    await db.brandDocument.create({
      data: {
        brandId: brand.id,
        kind: doc.kind,
        title: doc.title,
        content: doc.content,
        included: true,
      },
    });
  }
  await setDefaultBrand(brand.id);

  // Existing drafts genuinely were written against this corpus, so attributing
  // them to it is truthful rather than convenient.
  const backfilled = await db.draft.updateMany({
    where: { brandId: null },
    data: { brandId: brand.id },
  });

  const byKind = docs.reduce<Record<string, number>>((acc, d) => {
    acc[d.kind] = (acc[d.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `[seed] Created brand "${brand.name}" (${brand.id}) with ${docs.length} documents ` +
      `(${Object.entries(byKind)
        .map(([k, n]) => `${k}:${n}`)
        .join(', ')}); backfilled ${backfilled.count} draft(s).`,
  );
}

main().catch((err) => {
  console.error('[seed] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
