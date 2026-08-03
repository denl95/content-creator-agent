import type { Locale } from '../i18n/index';

/** BCP-47 tags for Intl. 'en' alone would give US date order. */
const INTL_LOCALE: Record<Locale, string> = { uk: 'uk-UA', en: 'en-GB' };

export function formatUsd(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatDate(iso: string, locale: Locale): string {
  // SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC; make it explicit before parsing.
  const parsed = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** Elapsed duration as mm:ss. Digits only, so no locale applies. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Built once per locale: the activity log formats every visible row on each
// render, and a fresh options bag per call misses the engine's fast path.
const CLOCKS = new Map<Locale, Intl.DateTimeFormat>();

/** Wall-clock time of day, for streaming log rows. */
export function formatClock(ts: number, locale: Locale): string {
  let clock = CLOCKS.get(locale);
  if (!clock) {
    clock = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    CLOCKS.set(locale, clock);
  }
  return clock.format(ts);
}

/**
 * Filename-safe slug for a draft download.
 *
 * Deliberately duplicated from `slugify` in `src/nodes/finalizer.ts` rather
 * than shared: the two apps share no code, `web/` has its own bundler root, and
 * importing across that boundary would break the standalone build. Four lines
 * is cheaper than the coupling — but if the convention changes, change both.
 *
 * `\p{L}\p{N}` rather than `[a-z0-9]`, so a Ukrainian topic yields a real
 * filename instead of an empty string.
 */
export function slugifyTopic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
}
