import { notFound } from 'next/navigation';
import { Markdown } from '@/components/markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMessages, type Locale } from '@/i18n/index';
import { fetchBrand } from '@/lib/api';
import { formatDate } from '@/lib/format';

export default async function BrandDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: Locale }>;
}) {
  // params is a Promise in Next 16.
  const { id, locale } = await params;
  const m = getMessages(locale);
  const brand = await fetchBrand(id);
  if (!brand) notFound();

  const docs = brand.documents ?? [];
  const byKind = (kind: string) => docs.filter((d) => d.kind === kind);
  const profile = byKind('profile')[0];
  const styleGuide = byKind('style_guide')[0];
  const exemplars = byKind('exemplar');
  const rawPages = byKind('raw_page');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
          {brand.is_default ? <span className="eonyx-label">{m.brands.default}</span> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {brand.status} · {brand.language} · {brand.collection_name} ·{' '}
          {formatDate(brand.created_at, locale)}
        </p>
      </div>

      {profile ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.brands.overview}</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown source={profile.content} />
          </CardContent>
        </Card>
      ) : null}

      {styleGuide ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.brands.styleGuide}</CardTitle>
          </CardHeader>
          <CardContent>
            <Markdown source={styleGuide.content} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.brands.exemplars({ count: exemplars.length })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {exemplars.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.brands.noExemplars}</p>
          ) : (
            exemplars.map((doc) => (
              <div key={doc.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                <p className="eonyx-label">{doc.title}</p>
                {/* Not <Markdown>: exemplars are plain text from extractText(), copied
                    verbatim from a crawled page. Parsing them would let an incidental # or *
                    become formatting and stop them being evidence. */}
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                  {doc.content}
                </pre>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.brands.provenance}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {rawPages.length}{' '}
            {rawPages.length === 1 ? m.brands.provenanceOne : m.brands.provenanceMany}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {rawPages.map((doc) => (
              <li key={doc.id}>{doc.title}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
