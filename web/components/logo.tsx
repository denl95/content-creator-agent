/**
 * EONYX logo — ported verbatim from the EONYX Design System's
 * components/core/Logo.jsx (claude.ai/design). Self-contained inline SVG,
 * no asset dependency.
 *
 * `mark` is the forward double-chevron X; `wordmark` is the full lockup.
 * `tone` accepts the DS's named tones or any CSS colour — pass
 * `currentColor` to let it follow the active theme.
 */
const TONES: Record<string, string> = {
  white: '#FFFFFF',
  navy: 'var(--eonyx-indigo)',
  cyan: 'var(--eonyx-cyan)',
  red: 'var(--eonyx-red)',
  black: 'var(--eonyx-black)',
};

// Real EONYX wordmark path (viewBox 0 0 237 85) — proper geometric X.
const WORDMARK_D =
  'M78.5,25.5c-10.3,0-18.8,7.5-18.8,16.6c0,9.2,8.4,16.7,18.8,16.7c10.3,0,18.8-7.5,18.8-16.7 C97.4,33,88.9,25.5,78.5,25.5z M78.5,54c-7.2,0-13.1-5.3-13.1-11.9c0-6.5,5.9-11.8,13.1-11.8c7.2,0,13.1,5.3,13.1,11.8 C91.7,48.7,85.7,54,78.5,54z M198.2,26.1h-6.6l-4.3,6.2l3.3,4.7L198.2,26.1z M184,36.9L184,36.9l-7.6-10.9h-0.3v0h-6.6l10.9,15.6 l-11.7,16.6h0.3v0h6.6l11.7-16.6L184,36.9z M190.6,46.3l-3.3,4.7l5.1,7.3h6.6L190.6,46.3z M151.5,37.9l-8.3-11.8h-6.6l12.1,17.2v8v7 h5.6v-15l12.1-17.2h-6.6L151.5,37.9z M32.2,58.3h25v-5H37.9v-8.8h15.2v-5H37.9v-8.3h19.4v-5h-25V58.3z M126.2,48.5l-23.6-25.2l0-0.1 v35h5.6V35.8l23.6,25.3v-35h-5.6V48.5z';

export function Logo({
  variant = 'wordmark',
  tone = 'currentColor',
  height = 28,
  className,
}: {
  variant?: 'wordmark' | 'mark';
  tone?: string;
  height?: number;
  className?: string;
}) {
  const fill = TONES[tone] ?? tone;

  if (variant === 'mark') {
    return (
      <span className={className} style={{ display: 'inline-flex' }}>
        <svg
          viewBox="44 4 152 77"
          height={height}
          fill={fill}
          aria-hidden="true"
          style={{ display: 'block' }}
        >
          <polygon points="62.7,9 48,9 71.1,42.1 71.1,42.1 48,75.3 62.7,75.3 85.8,42.1" />
          <polygon points="191.6,42.1 168.4,9 153.7,9 176.9,42.1" />
          <polygon points="85.7,75.2 131.9,9 146.6,9 100.4,75.2" />
        </svg>
      </span>
    );
  }

  return (
    <span className={className} style={{ display: 'inline-flex' }}>
      <svg
        viewBox="32 22 168 39"
        height={height}
        fill={fill}
        aria-label="EONYX"
        role="img"
        style={{ display: 'block' }}
      >
        <path d={WORDMARK_D} />
      </svg>
    </span>
  );
}
