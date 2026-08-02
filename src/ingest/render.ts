import type { BrandProfile, StyleGuide } from './schemas';
import type { RawDoc } from './types';

const TRUNCATION_NOTE = '\n[document truncated — do not quote an exemplar from its end]';

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
  const block = (doc: RawDoc, text = doc.text) =>
    `\n--- ${doc.kind.toUpperCase()}: ${doc.title} (${doc.url}) ---\n${text}\n`;

  const parts: string[] = [];
  let used = 0;
  for (const doc of ordered) {
    const rendered = block(doc);
    // `continue`, not `break`: one long page must not discard every document
    // after it. Skipping keeps the budget filled with whatever else fits.
    if (used + rendered.length > budget) continue;
    parts.push(rendered);
    used += rendered.length;
  }

  // A single document larger than the whole budget would otherwise leave the
  // distiller with nothing at all. Truncating one document is a far better
  // failure than sending an empty corpus, so long as it is labelled — an
  // exemplar must never be quoted from an invisible cut.
  if (parts.length === 0 && ordered[0]) {
    const doc = ordered[0];
    const overhead = block(doc, '').length;
    const room = Math.max(0, budget - overhead - TRUNCATION_NOTE.length);
    return block(doc, `${doc.text.slice(0, room)}${TRUNCATION_NOTE}`);
  }
  return parts.join('');
}
