import { afterEach, describe, expect, test } from 'bun:test';
import {
  createBrand,
  getBrandCorpus,
  getDefaultBrand,
  listBrands,
  setDefaultBrand,
} from '../../src/brands';
import { getDb, resetDbForTests } from '../../src/db';
import { freshDb } from '../helpers/db';

afterEach(async () => {
  await resetDbForTests();
});

describe('brands', () => {
  test('creates a brand and derives its collection name', async () => {
    await freshDb();
    const brand = await createBrand({
      name: 'EONYX',
      slug: 'eonyx',
      language: 'uk',
      status: 'active',
    });
    expect(brand.slug).toBe('eonyx');
    expect(brand.collection_name).toBe('brand_eonyx');
    expect(brand.is_default).toBe(false);
    expect(await listBrands()).toHaveLength(1);
  });

  test('setDefaultBrand leaves exactly one default', async () => {
    await freshDb();
    const a = await createBrand({ name: 'A', slug: 'a', language: 'uk', status: 'active' });
    const b = await createBrand({ name: 'B', slug: 'b', language: 'en', status: 'active' });
    await setDefaultBrand(a.id);
    await setDefaultBrand(b.id);
    const all = await listBrands();
    expect(all.filter((brand) => brand.is_default)).toHaveLength(1);
    expect((await getDefaultBrand())?.id).toBe(b.id);
  });

  test('getBrandCorpus returns only included documents', async () => {
    await freshDb();
    const brand = await createBrand({ name: 'C', slug: 'c', language: 'uk', status: 'active' });
    const db = getDb();
    await db.brandDocument.create({
      data: {
        brandId: brand.id,
        kind: 'style_guide',
        title: 'Style',
        content: 'RULES',
        included: true,
      },
    });
    await db.brandDocument.create({
      data: {
        brandId: brand.id,
        kind: 'raw_page',
        title: 'Home',
        content: 'NAV FOOTER',
        included: false,
      },
    });
    const corpus = await getBrandCorpus(brand.id);
    expect(corpus).toHaveLength(1);
    expect(corpus[0]?.content).toContain('RULES');
    expect(corpus[0]?.source).toContain('style_guide');
  });

  test('a slug with unsafe characters still yields a valid collection name', async () => {
    await freshDb();
    const brand = await createBrand({ name: 'Acme Co', slug: 'acme co/ltd', language: 'en' });
    // Chroma only accepts [a-zA-Z0-9._-] in collection names.
    expect(brand.collection_name).toMatch(/^brand_[a-zA-Z0-9._-]+$/);
  });
});
