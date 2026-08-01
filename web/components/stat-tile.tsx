import { Card, CardContent } from '@/components/ui/card';

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="rounded-sm border-border bg-card shadow-none">
      <CardContent className="p-5">
        {/* EONYX: technical labels are wide-tracked uppercase mono */}
        <p className="eonyx-label">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-[-0.015em] tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
