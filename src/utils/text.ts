/** Counts whitespace-separated tokens, ignoring pure-markup tokens like "#". */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Inline markdown → plain text. Images run before links: `![a](u)` would
 * otherwise match the link pattern and keep its leading `!`.
 */
function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

/**
 * Flatten a markdown draft for a destination that renders no formatting —
 * Facebook posts a `message` string and shows `##` and `**` literally.
 *
 * Line-oriented rather than a real parser: drafts are prose with headings,
 * bullets and links, and a parser would be a dependency for output nobody
 * round-trips. Known limitation: a word containing two underscores
 * (`snake_case_name`) loses them to the emphasis rule. That does not occur in
 * the prose these drafts contain.
 */
export function markdownToPlainText(md: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    // Inside a fence the text is verbatim — no heading or bullet rules apply.
    if (inFence) {
      out.push(line);
      continue;
    }
    // A horizontal rule carries no words, so it becomes nothing at all.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;

    let text = line.replace(/^\s{0,3}#{1,6}\s+/, '');
    text = text.replace(/^\s{0,3}>\s?/, '');
    text = text.replace(/^(\s*)[-*+]\s+/, '$1• ');
    out.push(stripInline(text));
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
