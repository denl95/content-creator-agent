/** Counts whitespace-separated tokens, ignoring pure-markup tokens like "#". */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Inline markdown → plain text.
 *
 * Anything whose content is verbatim — a code span, a URL — is parked as a
 * placeholder before the emphasis passes and restored after. Unwrapping it
 * early would feed it back through those passes: `` `*args` `` comes out as
 * `args`, and `.../my_page_name` comes out as `..../mypagename`, which is a
 * broken link in a public post.
 *
 * The emphasis patterns are lazy (`.+?`) rather than `[^*]+`, so a bold span
 * can contain an inner italic. With `[^*]+` the outer `**` never matches and
 * the italic pass eats the delimiters piecemeal, stranding literal asterisks
 * in the output — the exact thing this function exists to prevent.
 */
function stripInline(text: string): string {
  const verbatim: string[] = [];
  // U+0000 cannot occur in a draft, so a placeholder can never collide with
  // prose. The index makes restoration independent of replacement order.
  const park = (value: string): string => {
    verbatim.push(value);
    return `\u0000${verbatim.length - 1}\u0000`;
  };

  const parked = text
    .replace(/`([^`]+)`/g, (_match, code: string) => park(code))
    // Images before links: `![a](u)` would otherwise match the link pattern
    // and keep its leading `!`.
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
      (_match, alt: string, url: string) => `${alt} (${park(url)})`,
    )
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
      (_match, label: string, url: string) => `${label} (${park(url)})`,
    )
    // A bare URL is as vulnerable to the underscore rule as a linked one, and
    // drafts do carry them.
    .replace(/\bhttps?:\/\/\S+/g, (url: string) => park(url));

  return (
    parked
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: NUL byte placeholders are safe here
      .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => verbatim[Number(index)] ?? '')
  );
}

/**
 * Flatten a markdown draft for a destination that renders no formatting —
 * Facebook posts a `message` string and shows `##` and `**` literally.
 *
 * Line-oriented rather than a real parser: drafts are prose with headings,
 * bullets and links, and a parser would be a dependency for output nobody
 * round-trips. Known limitation: a bare word carrying two underscores
 * (`snake_case_name`) has the pair between them read as emphasis, so both are
 * consumed and the word comes back fused — `snakecasename`. URLs and code
 * spans, where this would do real damage, are protected in `stripInline`;
 * loose identifiers in prose are not, and do not occur in the drafts this
 * pipeline writes.
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
