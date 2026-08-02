'use client';

import { type UIEvent, useEffect, useRef } from 'react';
import { isFailedKind, type RunActivity } from '@/lib/types';

export type ActivityEntry = RunActivity & { ts: number; seq: number };

/** Distance from the bottom, in px, still counted as "following the tail". */
const PIN_THRESHOLD = 48;

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // Whether the user is still reading the tail. Tracked on scroll rather than
  // measured inside the effect: by the time the effect runs the new row has
  // already grown scrollHeight, so every check would read as "not at the
  // bottom" and someone scrolled up to read an earlier line would be yanked
  // back down on the next web search.
  const pinned = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
  }

  if (entries.length === 0) return null;

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      aria-live="polite"
      aria-label="Run activity"
      className="max-h-64 overflow-y-auto rounded-sm border border-border bg-card"
    >
      <ul className="divide-y divide-border">
        {entries.map((entry) => {
          const failed = isFailedKind(entry.kind);
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
    </div>
  );
}
