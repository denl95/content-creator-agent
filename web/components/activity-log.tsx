'use client';

import { memo, type UIEvent, useEffect, useRef } from 'react';
import { useLocale } from '@/i18n/provider';
import { formatClock } from '@/lib/format';
import { isFailedKind, type RunActivity } from '@/lib/types';

export type ActivityEntry = RunActivity & { ts: number; seq: number };

/** Distance from the bottom, in px, still counted as "following the tail". */
const PIN_THRESHOLD = 48;

// Memoised because the page re-renders every second from the elapsed clock while
// `entries` is unchanged — without this, every visible row is rebuilt and
// re-formatted ~300 times over a five-minute run for no visible difference.
export const ActivityLog = memo(function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  const locale = useLocale();
  const listRef = useRef<HTMLDivElement | null>(null);
  // Whether the user is still reading the tail. Tracked on scroll rather than
  // measured inside the effect: by the time the effect runs the new row has
  // already grown scrollHeight, so every check would read as "not at the
  // bottom" and someone scrolled up to read an earlier line would be yanked
  // back down on the next web search.
  const pinned = useRef(true);

  // Keyed on the newest seq, not on length: the list is capped, so once it
  // saturates `length` stops changing and a length-keyed effect would never run
  // again — auto-follow would die partway through exactly the long runs this
  // log exists for. seq is monotonic per run, so it keeps changing.
  const newestSeq = entries[entries.length - 1]?.seq;
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [newestSeq]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
  }

  if (entries.length === 0) return null;

  return (
    // role="log" implies aria-live="polite" *and* aria-relevant="additions",
    // which matters because the cap removes rows from the top — a bare
    // aria-live makes some screen readers announce those removals too.
    // tabIndex makes the scroll region reachable without a mouse.
    <div
      ref={listRef}
      onScroll={handleScroll}
      role="log"
      tabIndex={0}
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
              <span className="tabular-nums text-muted-foreground">{formatClock(entry.ts, locale)}</span>
              <span className={`eonyx-label ${failed ? 'text-destructive' : 'text-brand'}`}>
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
});
