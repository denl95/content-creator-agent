'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/run', label: 'New run' },
  { href: '/drafts', label: 'Drafts' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    // EONYX: the persistent red corner slash (a chevron fragment) is the
    // brand's editorial device; structure comes from hairlines, not shadows.
    <header className="relative border-b border-border">
      <span className="eonyx-slash" aria-hidden="true" />
      <nav className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4 pl-12">
        <Link href="/" aria-label="EONYX — home">
          <Logo variant="wordmark" height={20} />
        </Link>
        <div className="flex gap-6">
          {LINKS.map((link) => {
            // '/' would prefix-match everything, so it needs an exact test.
            const active =
              link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`eonyx-label border-b-2 pb-0.5 transition-colors ${
                  active
                    ? 'border-brand text-foreground'
                    : 'border-transparent hover:text-foreground'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
