import Link from 'next/link';
import { ChannelChart } from '@/components/channel-chart';
import { SpendChart } from '@/components/spend-chart';
import { StatTile } from '@/components/stat-tile';
import { VerdictBadge } from '@/components/verdict-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchDrafts, fetchStats } from '@/lib/api';
import { formatDate, formatPercent, formatUsd } from '@/lib/format';

export default async function DashboardPage() {
  const [stats, drafts] = await Promise.all([fetchStats(), fetchDrafts()]);
  const recent = drafts.slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Link href="/run" className="text-sm underline">
          New run →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Drafts" value={String(stats.totalDrafts)} />
        <StatTile
          label="Approved"
          value={formatPercent(stats.approvalRate)}
          hint={`${stats.approvedCount} of ${stats.totalDrafts}`}
        />
        <StatTile label="Total spend" value={formatUsd(stats.totalCostUsd)} />
        <StatTile label="Avg iterations" value={stats.avgIterations.toFixed(1)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spend over time</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendChart data={stats.spendByDay} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Drafts per channel</CardTitle>
          </CardHeader>
          <CardContent>
            <ChannelChart data={stats.byChannel} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent drafts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet.{' '}
              <Link href="/run" className="underline">
                Generate your first draft →
              </Link>
            </p>
          ) : (
            recent.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/drafts/${draft.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {draft.topic}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {draft.channel} · {formatDate(draft.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <VerdictBadge verdict={draft.verdict} />
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatUsd(draft.cost_usd)}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
