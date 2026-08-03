import Link from 'next/link';
import { VerdictBadge } from '@/components/verdict-badge';
import { getMessages, type Locale } from '@/i18n/index';
import { fetchBrands, fetchDrafts } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

export default async function DraftsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  // params is a Promise in Next 16.
  const { locale } = await params;
  const m = getMessages(locale);
  const [drafts, brands] = await Promise.all([fetchDrafts(), fetchBrands()]);
  const brandName = new Map(brands.map((brand) => [brand.id, brand.name]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{m.drafts.title}</h1>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {m.drafts.empty}{' '}
          <Link href={`/${locale}/run`} className="underline">
            {m.drafts.emptyCta}
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left">
              <tr>
                <th className="eonyx-label p-3 font-normal">{m.common.topic}</th>
                <th className="eonyx-label p-3 font-normal">{m.common.channel}</th>
                <th className="eonyx-label p-3 font-normal">{m.common.brand}</th>
                <th className="eonyx-label p-3 font-normal">{m.common.verdict}</th>
                <th className="eonyx-label p-3 text-right font-normal">{m.common.words}</th>
                <th className="eonyx-label p-3 text-right font-normal">{m.common.cost}</th>
                <th className="eonyx-label p-3 font-normal">{m.common.created}</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link href={`/${locale}/drafts/${draft.id}`} className="font-medium hover:underline">
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
                  <td className="p-3 text-right tabular-nums">{formatUsd(draft.cost_usd, locale)}</td>
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(draft.created_at, locale)}
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
