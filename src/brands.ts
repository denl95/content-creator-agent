import { getDb } from './db';

export type BrandRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  is_default: boolean;
  language: string;
  collection_name: string;
  corpus_hash: string | null;
  created_at: string;
};

export type NewBrand = {
  name: string;
  slug: string;
  language: string;
  status?: string;
};

type PrismaBrand = {
  id: string;
  name: string;
  slug: string;
  status: string;
  isDefault: boolean;
  language: string;
  collectionName: string;
  corpusHash: string | null;
  createdAt: Date;
};

/** Same snake_case convention as `DraftRow` — this shape crosses the HTTP boundary. */
function toBrandRow(b: PrismaBrand): BrandRow {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    status: b.status,
    is_default: b.isDefault,
    language: b.language,
    collection_name: b.collectionName,
    corpus_hash: b.corpusHash,
    created_at: b.createdAt.toISOString().replace('T', ' ').slice(0, 19),
  };
}

/** Chroma collection names accept only [a-zA-Z0-9._-], so the slug is narrowed. */
export function collectionNameFor(slug: string): string {
  return `brand_${slug.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
}

export async function createBrand(input: NewBrand): Promise<BrandRow> {
  const created = await getDb().brand.create({
    data: {
      name: input.name,
      slug: input.slug,
      language: input.language,
      status: input.status ?? 'draft',
      collectionName: collectionNameFor(input.slug),
    },
  });
  return toBrandRow(created);
}

export async function listBrands(): Promise<BrandRow[]> {
  // Default first, so a selector can take the first option without its own
  // notion of a default.
  const rows = await getDb().brand.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  return rows.map(toBrandRow);
}

export async function getBrand(id: string): Promise<BrandRow | null> {
  const row = await getDb().brand.findUnique({ where: { id } });
  return row ? toBrandRow(row) : null;
}

export async function getDefaultBrand(): Promise<BrandRow | null> {
  const row = await getDb().brand.findFirst({ where: { isDefault: true } });
  return row ? toBrandRow(row) : null;
}

export async function updateBrand(id: string, patch: { name?: string }): Promise<BrandRow> {
  const row = await getDb().brand.update({ where: { id }, data: patch });
  return toBrandRow(row);
}

/** Exactly one brand is default, so clearing the others is part of setting one. */
export async function setDefaultBrand(id: string): Promise<void> {
  const db = getDb();
  await db.$transaction([
    db.brand.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    db.brand.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function setBrandCorpusHash(id: string, hash: string): Promise<void> {
  await getDb().brand.updateMany({ where: { id }, data: { corpusHash: hash } });
}

/**
 * The embeddable corpus for a brand. `included: false` documents — raw scraped
 * pages kept for provenance — are excluded so nav and footer text never reaches
 * the vector store.
 */
export async function getBrandCorpus(
  brandId: string,
): Promise<Array<{ source: string; content: string }>> {
  const docs = await getDb().brandDocument.findMany({
    where: { brandId, included: true },
    orderBy: { createdAt: 'asc' },
  });
  return docs.map((d) => ({
    source: `${d.kind}:${d.id}`,
    content: `# ${d.title}\n\n${d.content}`,
  }));
}
