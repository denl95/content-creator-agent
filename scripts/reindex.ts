import 'dotenv/config';
import { getBrand, getDefaultBrand, listBrands } from '../src/brands';
import { reindex } from '../src/tools/rag';

/**
 * Rebuild one brand's collection. Takes an optional brand id or slug; with no
 * argument it rebuilds the default brand.
 */
async function resolveBrand(arg: string | undefined) {
  if (!arg) {
    const brand = await getDefaultBrand();
    if (!brand) throw new Error('No default brand — run "bun run seed-brand" first.');
    return brand;
  }
  const byId = await getBrand(arg);
  if (byId) return byId;
  const bySlug = (await listBrands()).find((b) => b.slug === arg);
  if (!bySlug) throw new Error(`No brand matches "${arg}" by id or slug.`);
  return bySlug;
}

async function main(): Promise<void> {
  const brand = await resolveBrand(process.argv[2]);
  console.log(`[reindex] Force-rebuilding "${brand.collection_name}" for brand ${brand.name}...`);
  await reindex(brand.id);
  console.log('[reindex] Done.');
}

main().catch((err) => {
  console.error('[reindex] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
