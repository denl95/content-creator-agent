'use client';

import { Button } from '@/components/ui/button';
import { useMessages } from '@/i18n/provider';

/**
 * A run failure worth showing.
 *
 * `title` exists because not every failure is a failed run — a rejected resume
 * or a dropped connection leaves the run alive on the server, and "Run failed"
 * would be wrong. `retry` is set only where reconnecting can actually help.
 */
export type RunFailure = { title: string; message: string; retry?: boolean };

export function RunError({ failure, onRetry }: { failure: RunFailure; onRetry?: () => void }) {
  const m = useMessages();
  return (
    <div
      role="alert"
      className="rounded-sm border border-l-2 border-destructive/40 border-l-destructive bg-destructive/10 p-4"
    >
      <p className="eonyx-label text-destructive">{failure.title}</p>
      <p className="mt-1 text-sm">{failure.message}</p>
      {failure.retry && onRetry ? (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          {m.run.reconnect}
        </Button>
      ) : null}
    </div>
  );
}
