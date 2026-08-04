import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders markdown as a document.
 *
 * Raw HTML is escaped, not rendered, because `rehype-raw` is deliberately
 * absent. Brand profiles and style guides are distilled from crawled pages and
 * draft content is generated from that corpus, so the source is
 * attacker-influenced by construction. Adding `rehype-raw` would turn a crawled
 * `<img src=x onerror=…>` into stored XSS.
 *
 * A Server Component: nothing here is interactive.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  if (!source) return null;

  return (
    <div className={className ? `eonyx-prose ${className}` : 'eonyx-prose'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Links inside brand documents point at third-party sites, so they
          // open in a new tab — but only external ones. GFM footnote refs and
          // in-page `#anchor` links must still navigate in place, or a
          // footnote click opens a blank duplicate tab instead of scrolling.
          a: ({ children, node, ...props }) => {
            const external = typeof props.href === 'string' && !props.href.startsWith('#');
            return (
              <a {...props} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
