import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { insertDraft } from '../db';
import type { GraphStateType } from '../state';

const OUTPUT_DIR = 'output';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function finalizer(
  state: GraphStateType,
  config?: RunnableConfig,
): Promise<Partial<GraphStateType>> {
  if (!state.draft?.content)
    throw new Error('finalizer: no draft content to save — check writer node');

  const threadId = (config?.configurable?.thread_id as string | undefined) ?? crypto.randomUUID();
  const fb = state.editFeedback;

  insertDraft({
    id: threadId,
    topic: state.brief?.topic ?? 'untitled',
    channel: state.brief?.channel ?? 'blog',
    tone: state.brief?.tone ?? '',
    audience: state.brief?.target_audience ?? '',
    content: state.draft.content,
    word_count: state.draft.word_count,
    verdict: fb?.verdict ?? null,
    tone_score: fb?.tone_score ?? null,
    accuracy_score: fb?.accuracy_score ?? null,
    structure_score: fb?.structure_score ?? null,
    iterations: state.iteration,
    issues: fb?.issues ?? [],
  });
  console.log(`[finalizer] Draft saved to database (id=${threadId})`);

  if (process.env.WRITE_OUTPUT_FILES === 'true') {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const approved = fb?.verdict === 'APPROVED';
    const slug = slugify(state.brief?.topic ?? 'untitled') || 'content';
    const filename = `${slug}-${threadId.slice(0, 8)}${approved ? '' : '-unapproved'}.md`;
    await Bun.write(path.resolve(OUTPUT_DIR, filename), state.draft.content);
  }

  return { finalContent: state.draft.content };
}
