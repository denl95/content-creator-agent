import type { BrandProfile, StyleGuide } from './schemas';
import type { RawDoc } from './types';

function section(heading: string, lines: string[]): string {
  if (lines.length === 0) return '';
  return `\n## ${heading}\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
}

/** Mirrors data/brand/brand.md, so downstream cannot tell the two apart. */
export function renderProfile(p: BrandProfile): string {
  const channels = p.channels.map(
    (c) =>
      `**${c.channel}** — ${c.description}${c.word_range ? ` ${c.word_range} words.` : ''}${
        c.cadence ? ` ${c.cadence}.` : ''
      }`,
  );
  return [
    `# ${p.name} — Brand overview`,
    `\n## Mission\n\n${p.mission}`,
    section('Services', p.services),
    `\n## Audience\n\n${p.audience_primary}${
      p.audience_secondary ? `\n\nSecondary: ${p.audience_secondary}` : ''
    }`,
    `\n## Positioning\n\n${p.positioning}`,
    section('Channels', channels),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Mirrors data/brand/style_guide.md. */
export function renderStyleGuide(g: StyleGuide): string {
  return [
    '# Content style guide',
    section('Voice and tone', g.voice),
    section('Forbidden phrases', g.forbidden_phrases),
    section('Preferred constructions', g.preferred_constructions),
    section('Formatting rules', g.formatting_rules),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The distiller's input, assembled to a hard character budget. Posts come first
 * because real published copy is far better voice evidence than a marketing
 * page, and truncation happens at a document boundary so no exemplar can be
 * quoted out of a half-document.
 */
export function assembleCorpusInput(docs: RawDoc[], budget: number): string {
  const ordered = [...docs].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'post' ? -1 : 1));
  const parts: string[] = [];
  let used = 0;
  for (const doc of ordered) {
    const block = `\n--- ${doc.kind.toUpperCase()}: ${doc.title} (${doc.url}) ---\n${doc.text}\n`;
    if (used + block.length > budget) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join('');
}
