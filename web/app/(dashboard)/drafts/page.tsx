import Link from 'next/link';
import { VerdictBadge } from '@/components/verdict-badge';
import { fetchBrands, fetchDrafts } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

export default async function DraftsPage() {
  const [drafts, brands] = await Promise.all([fetchDrafts(), fetchBrands()]);
  const brandName = new Map(brands.map((brand) => [brand.id, brand.name]));

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
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left">
              <tr>
                <th className="eonyx-label p-3 font-normal">Topic</th>
                <th className="eonyx-label p-3 font-normal">Channel</th>
                <th className="eonyx-label p-3 font-normal">Brand</th>
                <th className="eonyx-label p-3 font-normal">Verdict</th>
                <th className="eonyx-label p-3 text-right font-normal">Words</th>
                <th className="eonyx-label p-3 text-right font-normal">Cost</th>
                <th className="eonyx-label p-3 font-normal">Created</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link href={`/drafts/${draft.id}`} className="font-medium hover:underline">
                      {draft.topic}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{draft.channel}</td>
                  <td className="p-3 text-muted-foreground">
                    {draft.brand_id ? (brandName.get(draft.brand_id) ?? '—') : '—'}
                  </td>
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
