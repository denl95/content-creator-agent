import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

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
  created_at: string;
};

export type NewDraft = Omit<DraftRow, 'issues' | 'cost_usd' | 'notion_url' | 'created_at'> & {
  issues: string[];
};

let db: Database | null = null;

export function getDb(dbPath = process.env.DRAFTS_DB_PATH ?? 'data/app.db'): Database {
  if (db) return db;
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath, { create: true });
  db.run(`CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    channel TEXT NOT NULL,
    tone TEXT NOT NULL,
    audience TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    verdict TEXT,
    tone_score REAL,
    accuracy_score REAL,
    structure_score REAL,
    iterations INTEGER NOT NULL DEFAULT 0,
    issues TEXT NOT NULL DEFAULT '[]',
    cost_usd REAL,
    notion_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return db;
}

export function resetDbForTests(): void {
  db?.close();
  db = null;
}

export function insertDraft(draft: NewDraft): void {
  getDb()
    .query(
      `INSERT INTO drafts
        (id, topic, channel, tone, audience, content, word_count,
         verdict, tone_score, accuracy_score, structure_score, iterations, issues)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      draft.id,
      draft.topic,
      draft.channel,
      draft.tone,
      draft.audience,
      draft.content,
      draft.word_count,
      draft.verdict,
      draft.tone_score,
      draft.accuracy_score,
      draft.structure_score,
      draft.iterations,
      JSON.stringify(draft.issues),
    );
}

export function listDrafts(): DraftRow[] {
  return getDb()
    .query('SELECT * FROM drafts ORDER BY created_at DESC, id DESC')
    .all() as DraftRow[];
}

export function getDraft(id: string): DraftRow | null {
  return (getDb().query('SELECT * FROM drafts WHERE id = ?').get(id) as DraftRow | null) ?? null;
}

export function setDraftNotionUrl(id: string, url: string): void {
  getDb().query('UPDATE drafts SET notion_url = ? WHERE id = ?').run(url, id);
}

export function setDraftCost(id: string, costUsd: number): void {
  getDb().query('UPDATE drafts SET cost_usd = ? WHERE id = ?').run(costUsd, id);
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

type TotalsRow = {
  totalDrafts: number;
  approvedCount: number;
  totalCostUsd: number;
  avgIterations: number;
  avgTone: number;
  avgAccuracy: number;
  avgStructure: number;
};

export function getStats(): Stats {
  const database = getDb();

  const totals = database
    .query(
      `SELECT
         COUNT(*) AS totalDrafts,
         COALESCE(SUM(CASE WHEN verdict = 'APPROVED' THEN 1 ELSE 0 END), 0) AS approvedCount,
         COALESCE(SUM(cost_usd), 0) AS totalCostUsd,
         COALESCE(AVG(iterations), 0) AS avgIterations,
         COALESCE(AVG(tone_score), 0) AS avgTone,
         COALESCE(AVG(accuracy_score), 0) AS avgAccuracy,
         COALESCE(AVG(structure_score), 0) AS avgStructure
       FROM drafts`,
    )
    .get() as TotalsRow;

  const byChannel = database
    .query(
      `SELECT channel, COUNT(*) AS count
       FROM drafts
       GROUP BY channel
       ORDER BY count DESC, channel ASC`,
    )
    .all() as Array<{ channel: string; count: number }>;

  const spendByDay = database
    .query(
      `SELECT date(created_at) AS day, COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM drafts
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all() as Array<{ day: string; costUsd: number }>;

  return {
    totalDrafts: totals.totalDrafts,
    approvedCount: totals.approvedCount,
    approvalRate: totals.totalDrafts === 0 ? 0 : totals.approvedCount / totals.totalDrafts,
    totalCostUsd: totals.totalCostUsd,
    avgIterations: totals.avgIterations,
    avgScores: {
      tone: totals.avgTone,
      accuracy: totals.avgAccuracy,
      structure: totals.avgStructure,
    },
    byChannel,
    spendByDay,
  };
}
