import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getMessages, type Locale } from '@/i18n/index';
import { fetchBrands } from '@/lib/api';
import { formatDate } from '@/lib/format';

export default async function BrandsPage({ params }: { params: Promise<{ locale: Locale }> }) {
  // params is a Promise in Next 16.
  const { locale } = await params;
  const m = getMessages(locale);
  const brands = await fetchBrands();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{m.brands.title}</h1>
        <Button asChild>
          <Link href={`/${locale}/brands/new`}>{m.brands.newBrand}</Link>
        </Button>
      </div>

      {brands.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {m.brands.empty}{' '}
          <Link href={`/${locale}/brands/new`} className="underline">
            {m.brands.emptyCta}
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left">
              <tr>
                <th className="eonyx-label p-3 font-normal">{m.common.name}</th>
                <th className="eonyx-label p-3 font-normal">{m.common.status}</th>
                <th className="eonyx-label p-3 font-normal">{m.common.language}</th>
                <th className="eonyx-label p-3 font-normal">{m.common.created}</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr
                  key={brand.id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <td className="p-3">
                    <Link href={`/${locale}/brands/${brand.id}`} className="font-medium hover:underline">
                      {brand.name}
                    </Link>
                    {brand.is_default ? (
                      <span className="ml-2 text-xs text-muted-foreground">{m.brands.default}</span>
                    ) : null}
                  </td>
                  <td className="p-3 text-muted-foreground">{brand.status}</td>
                  <td className="p-3 text-muted-foreground">{brand.language}</td>
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(brand.created_at, locale)}
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
