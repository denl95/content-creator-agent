import Link from 'next/link';
import { ChannelChart } from '@/components/channel-chart';
import { SpendChart } from '@/components/spend-chart';
import { StatTile } from '@/components/stat-tile';
import { VerdictBadge } from '@/components/verdict-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMessages, type Locale } from '@/i18n/index';
import { fetchDrafts, fetchStats } from '@/lib/api';
import { formatDate, formatPercent, formatUsd } from '@/lib/format';

export default async function DashboardPage({ params }: { params: Promise<{ locale: Locale }> }) {
  // params is a Promise in Next 16.
  const { locale } = await params;
  const m = getMessages(locale);
  const [stats, drafts] = await Promise.all([fetchStats(), fetchDrafts()]);
  const recent = drafts.slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{m.dashboard.title}</h1>
        <Link href={`/${locale}/run`} className="text-sm underline">
          {m.dashboard.newRun}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={m.dashboard.drafts} value={String(stats.totalDrafts)} />
        <StatTile
          label={m.dashboard.approved}
          value={formatPercent(stats.approvalRate)}
          hint={m.dashboard.approvedHint({ approved: stats.approvedCount, total: stats.totalDrafts })}
        />
        <StatTile label={m.dashboard.totalSpend} value={formatUsd(stats.totalCostUsd, locale)} />
        <StatTile label={m.dashboard.avgIterations} value={stats.avgIterations.toFixed(1)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.dashboard.spendOverTime}</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendChart data={stats.spendByDay} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.dashboard.draftsPerChannel}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChannelChart data={stats.byChannel} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.dashboard.recentDrafts}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {m.dashboard.empty}{' '}
              <Link href={`/${locale}/run`} className="underline">
                {m.dashboard.emptyCta}
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
                    href={`/${locale}/drafts/${draft.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {draft.topic}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {draft.channel} · {formatDate(draft.created_at, locale)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <VerdictBadge verdict={draft.verdict} />
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatUsd(draft.cost_usd, locale)}
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
