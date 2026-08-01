import Link from 'next/link';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/run', label: 'New run' },
  { href: '/drafts', label: 'Drafts' },
];

export function Nav() {
  return (
    // EONYX: the persistent red corner slash (a chevron fragment) is the
    // brand's editorial device; structure comes from hairlines, not shadows.
    <header className="relative border-b border-border">
      <span className="eonyx-slash" aria-hidden="true" />
      <nav className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4 pl-12">
        <Link href="/" className="text-lg font-bold tracking-[-0.015em]">
          LUMEN
        </Link>
        <div className="flex gap-6">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="eonyx-label transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
