export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value.toFixed(4)}`;
}

export function formatDate(iso: string): string {
  // SQLite stores 'YYYY-MM-DD HH:MM:SS' in UTC; make it explicit before parsing.
  const parsed = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', {
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

/** Elapsed duration as mm:ss. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Built once: the activity log formats every visible row on each render, and a
// fresh options bag per call misses the engine's fast path. 'en-GB' matches
// formatDate above so two screens never render times in different locales.
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Wall-clock time of day, for streaming log rows. */
export function formatClock(ts: number): string {
  return CLOCK.format(ts);
}
