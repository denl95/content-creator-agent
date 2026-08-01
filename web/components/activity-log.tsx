'use client';

import { useEffect, useRef } from 'react';
import { FAILED_KINDS, type RunActivity } from '@/lib/types';

export type ActivityEntry = RunActivity & { ts: number; seq: number };

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  // Follow the tail as work streams in. Keyed on `entries.length` rather than
  // `entries` so a re-render with the same list does not yank the user's scroll.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div className="max-h-64 overflow-y-auto rounded-sm border border-border bg-card">
      <ul className="divide-y divide-border">
        {entries.map((entry) => {
          const failed = FAILED_KINDS.includes(entry.kind);
          return (
            <li
              key={entry.seq}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 font-mono text-[11px]"
            >
              <span className="tabular-nums text-muted-foreground">{clock(entry.ts)}</span>
              <span
                className={`uppercase tracking-[0.16em] ${
                  failed ? 'text-destructive' : 'text-brand'
                }`}
              >
                {entry.kind.replace(/_/g, ' ')}
              </span>
              <span className={`min-w-0 flex-1 wrap-break-word ${failed ? 'text-destructive' : ''}`}>
                {entry.detail}
              </span>
              <span className="eonyx-label shrink-0">{entry.step}</span>
            </li>
          );
        })}
      </ul>
      <div ref={endRef} />
    </div>
  );
}
