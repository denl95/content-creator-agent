/** Elements whose subtree is boilerplate rather than content. */
const DROP = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'svg', 'form'];

/** Block elements: their text is worth keeping and they start a new line. */
const BLOCK = 'p, li, h1, h2, h3, h4, blockquote';

/** Everything whose text we keep, including the inline wrappers real sites use. */
const TEXT_FROM = `${BLOCK}, span, strong, em, a, div, td`;

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
};

/**
 * HTMLRewriter hands back raw source text, so `It&#x27;s` survives into the
 * corpus unless decoded here. Unknown entities are left alone rather than
 * dropped — mangling is worse than passing through.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

export function extractText(html: string): { title: string; text: string } {
  let title = '';
  const parts: string[] = [];
  // A counter, not a boolean: onEndTag fires for every nested element inside a
  // dropped subtree, and a boolean would resume capture at the first one.
  let dropDepth = 0;

  new HTMLRewriter()
    .on('title', {
      text(t) {
        title += t.text;
      },
    })
    .on(DROP.join(', '), {
      element(el) {
        dropDepth += 1;
        el.onEndTag(() => {
          dropDepth -= 1;
        });
      },
    })
    // Every element boundary contributes a space. Without this, text from
    // adjacent inline elements is concatenated and words are glued together —
    // a live crawl of eonyx.net produced "студіяз впровадження" and
    // "данихб'є по грошах", which would poison the corpus and make every
    // exemplar quoted from it unusable.
    .on('*', {
      element() {
        if (dropDepth === 0) parts.push(' ');
      },
    })
    .on('br', {
      element() {
        if (dropDepth === 0) parts.push('\n');
      },
    })
    .on(BLOCK, {
      element() {
        if (dropDepth === 0) parts.push('\n');
      },
    })
    .on(TEXT_FROM, {
      text(t) {
        if (dropDepth === 0 && t.text.trim()) parts.push(t.text);
      },
    })
    .transform(new Response(html));

  const text = decodeEntities(parts.join(''))
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  return { title: decodeEntities(title).trim(), text };
}
