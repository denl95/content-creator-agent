import type { RunnableConfig } from '@langchain/core/runnables';
import { reportActivity } from '../activity';
import { setDraftNotionUrl } from '../db';
import { publishDraft } from '../mcp/notion';
import type { GraphStateType } from '../state';

export async function publisher(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  const threadId = config?.configurable?.thread_id as string | undefined;
  const skip = (detail: string): Partial<GraphStateType> => {
    reportActivity(threadId, { step: 'publisher', kind: 'skipped', detail });
    return {};
  };

  if (process.env.SKIP_PUBLISH === 'true') return skip('SKIP_PUBLISH=true');

  const databaseId = process.env.NOTION_DRAFTS_DATABASE_ID;
  if (!databaseId || !process.env.NOTION_TOKEN) return skip('Notion is not configured');

  const content = state.finalContent ?? state.draft?.content;
  if (!content) return skip('no content to publish');

  const topic = state.brief?.topic ?? 'Untitled';
  const channel = state.brief?.channel ?? 'blog';
  const wordCount = state.draft?.word_count ?? 0;
  const status = state.editFeedback?.verdict === 'APPROVED' ? 'Approved' : 'Unapproved';

  try {
    reportActivity(threadId, {
      step: 'publisher',
      kind: 'publishing',
      detail: `creating Notion page for "${topic}"`,
    });
    const page = await publishDraft({
      databaseId,
      title: topic,
      content,
      channel,
      wordCount,
      status,
    });
    reportActivity(threadId, { step: 'publisher', kind: 'published', detail: page.url });
    if (threadId) setDraftNotionUrl(threadId, page.url);
    return { notionUrl: page.url };
  } catch (err) {
    // Publishing stays best-effort — the draft is already committed to SQLite by
    // the finalizer, so a Notion outage must not fail the run. It used to fail
    // to stdout only, though, which left the dashboard claiming a clean finish.
    reportActivity(threadId, {
      step: 'publisher',
      kind: 'publish_failed',
      detail: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
