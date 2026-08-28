import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from './generated/prisma/client';

export type DraftRow = {
  id: string;
  topic: string;
  channel: string;
  tone: string;
  audience: string;
  content: string;
  word_count: number;
  verdict: string | null;
  tone_score: number | null;
  accuracy_score: number | null;
  structure_score: number | null;
  iterations: number;
  issues: string;
  cost_usd: number | null;
  notion_url: string | null;
  facebook_url: string | null;
  created_at: string;
  brand_id: string | null;
};

export type NewDraft = Omit<
  DraftRow,
  'issues' | 'cost_usd' | 'notion_url' | 'facebook_url' | 'created_at' | 'brand_id'
> & {
  issues: string[];
  brand_id?: string | null;
};

let client: PrismaClient | null = null;

/**
 * The process-wide Prisma client. Prisma 7 takes its connection through a
 * driver adapter rather than the schema's datasource block, so the URL is
 * applied here rather than by `prisma generate`.
 */
export function getDb(url = process.env.DATABASE_URL ?? 'file:./data/app.db'): PrismaClient {
  if (client) return client;
  client = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
  return client;
}

export async function resetDbForTests(): Promise<void> {
  await client?.$disconnect();
  client = null;
}

type PrismaDraft = {
  id: string;
  topic: string;
  channel: string;
  tone: string;
  audience: string;
  content: string;
  wordCount: number;
  verdict: string | null;
  toneScore: number | null;
  accuracyScore: number | null;
  structureScore: number | null;
  iterations: number;
  issues: string;
  costUsd: number | null;
  notionUrl: string | null;
  facebookUrl: string | null;
  createdAt: Date;
  brandId: string | null;
};

/**
 * Prisma returns camelCase and real Date objects; the HTTP API has always
 * emitted snake_case with SQLite's 'YYYY-MM-DD HH:MM:SS' strings, and
 * `web/lib/types.ts` mirrors that shape by hand. This is the only place the two
 * conventions meet — renaming a key here silently breaks the dashboard.
 */
function toDraftRow(d: PrismaDraft): DraftRow {
  return {
    id: d.id,
    topic: d.topic,
    channel: d.channel,
    tone: d.tone,
    audience: d.audience,
    content: d.content,
    word_count: d.wordCount,
    verdict: d.verdict,
    tone_score: d.toneScore,
    accuracy_score: d.accuracyScore,
    structure_score: d.structureScore,
    iterations: d.iterations,
    issues: d.issues,
    cost_usd: d.costUsd,
    notion_url: d.notionUrl,
    facebook_url: d.facebookUrl,
    created_at: d.createdAt.toISOString().replace('T', ' ').slice(0, 19),
    brand_id: d.brandId,
  };
}

export async function insertDraft(draft: NewDraft): Promise<void> {
  await getDb().draft.create({
    data: {
      id: draft.id,
      topic: draft.topic,
      channel: draft.channel,
      tone: draft.tone,
      audience: draft.audience,
      content: draft.content,
      wordCount: draft.word_count,
      verdict: draft.verdict,
      toneScore: draft.tone_score,
      accuracyScore: draft.accuracy_score,
      structureScore: draft.structure_score,
      iterations: draft.iterations,
      issues: JSON.stringify(draft.issues),
      brandId: draft.brand_id ?? null,
    },
  });
}

export async function listDrafts(): Promise<DraftRow[]> {
  const rows = await getDb().draft.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return rows.map(toDraftRow);
}

export async function getDraft(id: string): Promise<DraftRow | null> {
  const row = await getDb().draft.findUnique({ where: { id } });
  return row ? toDraftRow(row) : null;
}

// `updateMany`, not `update`: Prisma's `update` throws P2025 when no row
// matches, whereas the hand-written `UPDATE ... WHERE id = ?` these replace was
// a silent no-op. runManager calls setDraftCost after every run, so a missing
// row must not turn a finished run into an errored one.
export async function setDraftNotionUrl(id: string, url: string): Promise<void> {
  await getDb().draft.updateMany({ where: { id }, data: { notionUrl: url } });
}

export async function setDraftFacebookUrl(id: string, url: string): Promise<void> {
  await getDb().draft.updateMany({ where: { id }, data: { facebookUrl: url } });
}

export async function setDraftCost(id: string, costUsd: number): Promise<void> {
  await getDb().draft.updateMany({ where: { id }, data: { costUsd } });
}

export type Stats = {
  totalDrafts: number;
  approvedCount: number;
  approvalRate: number;
  totalCostUsd: number;
  avgIterations: number;
  avgScores: { tone: number; accuracy: number; structure: number };
  byChannel: Array<{ channel: string; count: number }>;
  spendByDay: Array<{ day: string; costUsd: number }>;
};

export async function getStats(): Promise<Stats> {
  const db = getDb();
  const [totalDrafts, approvedCount, agg, byChannelRaw, spendByDay] = await Promise.all([
    db.draft.count(),
    db.draft.count({ where: { verdict: 'APPROVED' } }),
    db.draft.aggregate({
      _sum: { costUsd: true },
      _avg: { iterations: true, toneScore: true, accuracyScore: true, structureScore: true },
    }),
    db.draft.groupBy({ by: ['channel'], _count: { _all: true } }),
    // date() grouping has no Prisma equivalent, so this stays raw SQL.
    db.$queryRawUnsafe<Array<{ day: string; costUsd: number }>>(
      `SELECT date(created_at) AS day, COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM drafts GROUP BY day ORDER BY day ASC`,
    ),
  ]);

  const byChannel = byChannelRaw
    .map((r) => ({ channel: r.channel, count: r._count._all }))
    .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));

  return {
    totalDrafts,
    approvedCount,
    approvalRate: totalDrafts === 0 ? 0 : approvedCount / totalDrafts,
    totalCostUsd: agg._sum.costUsd ?? 0,
    avgIterations: agg._avg.iterations ?? 0,
    avgScores: {
      tone: agg._avg.toneScore ?? 0,
      accuracy: agg._avg.accuracyScore ?? 0,
      structure: agg._avg.structureScore ?? 0,
    },
    byChannel,
    spendByDay,
  };
}
