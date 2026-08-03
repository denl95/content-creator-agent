'use client';

import { useMessages } from '@/i18n/provider';

export function VerdictBadge({ verdict }: { verdict: string | null }) {
  const m = useMessages();
  if (!verdict) return <span className="text-muted-foreground">—</span>;
  const approved = verdict === 'APPROVED';
  // A verdict is a status the user reads, so it is translated. An unrecognised
  // value falls through to the raw string rather than rendering blank.
  const label =
    verdict === 'APPROVED'
      ? m.verdicts.APPROVED
      : verdict === 'REVISION_NEEDED'
        ? m.verdicts.REVISION_NEEDED
        : verdict.replace('_', ' ');
  return (
    // EONYX reserves pills for tags and status — this is one of the two
    // places in the app where a pill is on-brand.
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.16em] whitespace-nowrap ${
        approved
          ? 'bg-state-approved-bg text-state-approved'
          : 'bg-state-revision-bg text-state-revision'
      }`}
    >
      {label}
    </span>
  );
}
