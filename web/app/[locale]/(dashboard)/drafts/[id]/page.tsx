import { notFound } from 'next/navigation';
import { PublishButton } from '@/components/publish-button';
import { StatTile } from '@/components/stat-tile';
import { VerdictBadge } from '@/components/verdict-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchBrands, fetchDraft } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

function parseIssues(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [draft, brands] = await Promise.all([fetchDraft(id), fetchBrands()]);
  if (!draft) notFound();

  const brand = draft.brand_id ? brands.find((b) => b.id === draft.brand_id) : undefined;
  const brandLabel = brand ? `${brand.name} · ` : '';

  const issues = parseIssues(draft.issues);
  const score = (value: number | null) => (value === null ? '—' : value.toFixed(2));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{draft.topic}</h1>
          <VerdictBadge verdict={draft.verdict} />
        </div>
        <p className="text-sm text-muted-foreground">
          {brandLabel}{draft.channel} · {draft.tone} · {draft.audience} ·{' '}
          {formatDate(draft.created_at)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Words" value={String(draft.word_count)} />
        <StatTile label="Cost" value={formatUsd(draft.cost_usd)} />
        <StatTile label="Iterations" value={String(draft.iterations)} />
        <StatTile
          label="Scores"
          value={`${score(draft.tone_score)} / ${score(draft.accuracy_score)} / ${score(draft.structure_score)}`}
          hint="tone / accuracy / structure"
        />
      </div>

      {issues.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Editor issues</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {draft.content}
          </pre>
        </CardContent>
      </Card>

      {draft.notion_url ? (
        <a
          href={draft.notion_url}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm underline"
        >
          Open in Notion →
        </a>
      ) : (
        <PublishButton draftId={draft.id} />
      )}
    </div>
  );
}
