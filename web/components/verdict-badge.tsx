export function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>;
  const approved = verdict === 'APPROVED';
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        approved
          ? 'bg-state-approved-bg text-state-approved'
          : 'bg-state-revision-bg text-state-revision'
      }`}
    >
      {verdict.replace('_', ' ').toLowerCase()}
    </span>
  );
}
