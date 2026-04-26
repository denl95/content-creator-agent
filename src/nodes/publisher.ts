import { publishDraft } from '../mcp/notion';
import type { GraphStateType } from '../state';

export async function publisher(state: GraphStateType): Promise<Partial<GraphStateType>> {
  if (process.env.SKIP_PUBLISH === 'true') {
    console.log('[publisher] SKIP_PUBLISH=true — skipping Notion publish');
    return {};
  }

  const databaseId = process.env.NOTION_DRAFTS_DATABASE_ID;
  if (!databaseId || !process.env.NOTION_TOKEN) {
    console.log('[publisher] Notion not configured — skipping publish');
    return {};
  }

  const content = state.finalContent ?? state.draft?.content;
  if (!content) {
    console.warn('[publisher] No content to publish — skipping');
    return {};
  }

  const topic = state.brief?.topic ?? 'Untitled';
  const channel = state.brief?.channel ?? 'blog';
  const wordCount = state.draft?.word_count ?? 0;
  const status = state.editFeedback?.verdict === 'APPROVED' ? 'Approved' : 'Unapproved';

  try {
    console.log(`[publisher] Creating Notion page for "${topic}"...`);
    const page = await publishDraft({
      databaseId,
      title: topic,
      content,
      channel,
      wordCount,
      status,
    });
    console.log(`[publisher] Published: ${page.url}`);
    return { notionUrl: page.url };
  } catch (err) {
    console.error(
      `[publisher] Failed to publish to Notion: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}
