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
          // Links inside brand documents point at third-party sites.
          a: ({ children, node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
