import { headers } from 'next/headers';
import type { Brand, DraftRow } from './types';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

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

/** Server Components talk to Hono directly, forwarding the caller's auth cookie. */
async function get<T>(path: string): Promise<T | null> {
  const cookie = (await headers()).get('cookie') ?? '';
  const res = await fetch(`${API_ORIGIN}${path}`, {
    headers: { cookie },
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as T;
}

export async function fetchDrafts(): Promise<DraftRow[]> {
  return (await get<DraftRow[]>('/drafts')) ?? [];
}

export async function fetchDraft(id: string): Promise<DraftRow | null> {
  return get<DraftRow>(`/drafts/${id}`);
}

export async function fetchStats(): Promise<Stats> {
  return (
    (await get<Stats>('/stats')) ?? {
      totalDrafts: 0,
      approvedCount: 0,
      approvalRate: 0,
      totalCostUsd: 0,
      avgIterations: 0,
      avgScores: { tone: 0, accuracy: 0, structure: 0 },
      byChannel: [],
      spendByDay: [],
    }
  );
}

export async function fetchBrands(): Promise<Brand[]> {
  return (await get<Brand[]>('/brands')) ?? [];
}
