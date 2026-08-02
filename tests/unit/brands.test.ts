import { afterEach, describe, expect, test } from 'bun:test';
import {
  createBrand,
  getBrand,
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

describe('brand endpoints', () => {
  test('POST /runs rejects a brief naming an unknown brand', async () => {
    await freshDb();
    const { app } = await import('../../src/server');
    const res = await app.request('/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: 'T',
        channel: 'blog',
        tone: 'professional',
        target_audience: 'A',
        word_count: 500,
        language: 'uk',
        brand_id: 'does-not-exist',
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unknown or inactive brand');
  });

  test('POST /runs rejects a brand that is not active', async () => {
    await freshDb();
    const draftBrand = await createBrand({ name: 'D', slug: 'd', language: 'uk' });
    const { app } = await import('../../src/server');
    const res = await app.request('/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: 'T',
        channel: 'blog',
        tone: 'professional',
        target_audience: 'A',
        word_count: 500,
        language: 'uk',
        brand_id: draftBrand.id,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('GET /brands lists them, default first', async () => {
    await freshDb();
    await createBrand({ name: 'Zeta', slug: 'zeta', language: 'en', status: 'active' });
    const first = await createBrand({
      name: 'Alpha',
      slug: 'alpha',
      language: 'uk',
      status: 'active',
    });
    await setDefaultBrand(first.id);
    const { app } = await import('../../src/server');
    const res = await app.request('/brands');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; is_default: boolean }>;
    expect(body[0]?.name).toBe('Alpha');
    expect(body[0]?.is_default).toBe(true);
  });

  test('PATCH /brands/:id renames and can set the default', async () => {
    await freshDb();
    const brand = await createBrand({ name: 'Old', slug: 'old', language: 'uk', status: 'active' });
    const { app } = await import('../../src/server');
    const res = await app.request(`/brands/${brand.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New', is_default: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('New');
    expect((await getDefaultBrand())?.id).toBe(brand.id);
  });

  test('GET /brands/:id 404s for an unknown id', async () => {
    await freshDb();
    const { app } = await import('../../src/server');
    expect((await app.request('/brands/nope')).status).toBe(404);
  });
});

describe('ingestion endpoints', () => {
  test('POST /brands rejects a body with no sources', async () => {
    await freshDb();
    const { app } = await import('../../src/server');
    const res = await app.request('/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', sources: [] }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /brands rejects a website source that is not an http URL', async () => {
    await freshDb();
    const { app } = await import('../../src/server');
    const res = await app.request('/brands', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', sources: [{ kind: 'website', locator: 'not-a-url' }] }),
    });
    expect(res.status).toBe(400);
  });

  test('DELETE /brands/:id refuses to remove the default brand', async () => {
    await freshDb();
    const brand = await createBrand({
      name: 'Only',
      slug: 'only',
      language: 'uk',
      status: 'active',
    });
    await setDefaultBrand(brand.id);
    const { app } = await import('../../src/server');
    expect((await app.request(`/brands/${brand.id}`, { method: 'DELETE' })).status).toBe(409);
  });

  test('DELETE /brands/:id removes a non-default brand', async () => {
    await freshDb();
    const keep = await createBrand({
      name: 'Keep',
      slug: 'keep',
      language: 'uk',
      status: 'active',
    });
    await setDefaultBrand(keep.id);
    const gone = await createBrand({
      name: 'Gone',
      slug: 'gone',
      language: 'en',
      status: 'active',
    });
    const { app } = await import('../../src/server');
    expect((await app.request(`/brands/${gone.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await getBrand(gone.id)).toBeNull();
  });

  test('reingest 409s when the brand has no recorded sources', async () => {
    await freshDb();
    const brand = await createBrand({
      name: 'Bare',
      slug: 'bare',
      language: 'uk',
      status: 'active',
    });
    const { app } = await import('../../src/server');
    const res = await app.request(`/brands/${brand.id}/reingest`, { method: 'POST' });
    expect(res.status).toBe(409);
  });
});

describe('brief language defaults', () => {
  test('an English brand yields English runs without the caller saying so', async () => {
    await freshDb();
    const brand = await createBrand({ name: 'EN', slug: 'en', language: 'en', status: 'active' });
    const { app } = await import('../../src/server');
    const res = await app.request('/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: 'T',
        channel: 'blog',
        tone: 'professional',
        target_audience: 'A',
        word_count: 300,
        brand_id: brand.id,
      }),
    });
    expect(res.status).toBe(201);
    const { thread_id } = (await res.json()) as { thread_id: string };
    const { getRun } = await import('../../src/runManager');
    // The run exists, which means the brief passed validation with the brand's
    // language rather than the schema's 'uk' default.
    expect(getRun(thread_id)).toBeDefined();
  });
});
