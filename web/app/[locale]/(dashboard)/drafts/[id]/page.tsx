import { notFound } from 'next/navigation';
import { DraftActions } from '@/components/draft-actions';
import { FacebookPublishButton } from '@/components/facebook-publish-button';
import { Markdown } from '@/components/markdown';
import { PublishButton } from '@/components/publish-button';
import { StatTile } from '@/components/stat-tile';
import { VerdictBadge } from '@/components/verdict-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMessages, type Locale } from '@/i18n/index';
import { fetchBrands, fetchDraft, fetchFacebookStatus } from '@/lib/api';
import { formatDate, formatUsd } from '@/lib/format';

function parseIssues(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function DraftDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: Locale }>;
}) {
  // params is a Promise in Next 16.
  const { id, locale } = await params;
  const m = getMessages(locale);
  const [draft, brands, facebook] = await Promise.all([
    fetchDraft(id),
    fetchBrands(),
    fetchFacebookStatus(),
  ]);
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
          {formatDate(draft.created_at, locale)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={m.common.words} value={String(draft.word_count)} />
        <StatTile label={m.common.cost} value={formatUsd(draft.cost_usd, locale)} />
        <StatTile label={m.common.iterations} value={String(draft.iterations)} />
        <StatTile
          label={m.common.scores}
          value={`${score(draft.tone_score)} / ${score(draft.accuracy_score)} / ${score(draft.structure_score)}`}
          hint={m.drafts.scoresHint}
        />
      </div>

      {issues.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.drafts.editorIssues}</CardTitle>
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
          <CardTitle className="text-base">{m.drafts.content}</CardTitle>
        </CardHeader>
        <CardContent>
          <Markdown source={draft.content} />
          <div className="mt-4 border-t border-border/60 pt-4">
            <DraftActions topic={draft.topic} id={draft.id} content={draft.content} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-start gap-6">
        {draft.notion_url ? (
          <a
            href={draft.notion_url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm underline"
          >
            {m.drafts.openNotion}
          </a>
        ) : (
          <PublishButton draftId={draft.id} />
        )}

        {draft.facebook_url ? (
          <a
            href={draft.facebook_url}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm underline"
          >
            {m.drafts.openFacebook}
          </a>
        ) : (
          <FacebookPublishButton
            draftId={draft.id}
            configured={facebook.configured}
            pageName={facebook.page_name}
          />
        )}
      </div>
    </div>
  );
}
