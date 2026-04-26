import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { GraphStateType } from '../state';

const OUTPUT_DIR = 'output';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export async function finalizer(state: GraphStateType): Promise<Partial<GraphStateType>> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const content = state.draft?.content ?? '';
  const approved = state.editFeedback?.verdict === 'APPROVED';
  const slug = slugify(state.brief?.topic ?? '') || `content-${Date.now()}`;
  const suffix = approved ? '' : '-unapproved';
  const filename = `${slug}${suffix}.md`;
  const filePath = path.resolve(OUTPUT_DIR, filename);

  await Bun.write(filePath, content);

  if (!approved && state.editFeedback?.issues.length) {
    const reviewPath = path.resolve(OUTPUT_DIR, `${slug}${suffix}.review.md`);
    const reviewContent = [
      `# Editor review — ${state.brief.topic}`,
      '',
      `Stopped after ${state.iteration} iteration(s) — max iterations reached.`,
      '',
      '## Issues',
      ...state.editFeedback.issues.map((i) => `- ${i}`),
      '',
      `Scores: tone=${state.editFeedback.tone_score}, accuracy=${state.editFeedback.accuracy_score}, structure=${state.editFeedback.structure_score}`,
    ].join('\n');
    await Bun.write(reviewPath, reviewContent);
  }

  return { finalContent: content };
}
