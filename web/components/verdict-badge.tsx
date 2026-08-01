export function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>;
  const approved = verdict === 'APPROVED';
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
      {verdict.replace('_', ' ')}
    </span>
  );
}
