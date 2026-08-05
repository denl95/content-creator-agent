import { headers } from 'next/headers';
import type { Brand, BrandDetail, DraftRow } from './types';

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

export type FacebookStatus = { configured: boolean; page_name: string | null };

export async function fetchFacebookStatus(): Promise<FacebookStatus> {
  return (
    (await get<FacebookStatus>('/publish/facebook/status')) ?? {
      configured: false,
      page_name: null,
    }
  );
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

export async function fetchBrand(id: string): Promise<BrandDetail | null> {
  return get<BrandDetail>(`/brands/${id}`);
}
