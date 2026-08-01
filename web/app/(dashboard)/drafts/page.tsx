import Link from 'next/link';
import { VerdictBadge } from '@/components/verdict-badge';
import { fetchDrafts } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

export default async function DraftsPage() {
  const drafts = await fetchDrafts();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Drafts</h1>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No drafts yet.{' '}
          <Link href="/run" className="underline">
            Generate one →
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="p-3 font-medium">Topic</th>
                <th className="p-3 font-medium">Channel</th>
                <th className="p-3 font-medium">Verdict</th>
                <th className="p-3 text-right font-medium">Words</th>
                <th className="p-3 text-right font-medium">Cost</th>
                <th className="p-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <Link href={`/drafts/${draft.id}`} className="font-medium hover:underline">
                      {draft.topic}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{draft.channel}</td>
                  <td className="p-3">
                    <VerdictBadge verdict={draft.verdict} />
                  </td>
                  <td className="p-3 text-right tabular-nums">{draft.word_count}</td>
                  <td className="p-3 text-right tabular-nums">{formatUsd(draft.cost_usd)}</td>
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(draft.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
