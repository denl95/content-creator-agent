'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LocaleToggle } from '@/components/locale-toggle';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { useLocale, useMessages } from '@/i18n/provider';

export function Nav() {
  const pathname = usePathname();
  const locale = useLocale();
  const m = useMessages();

  // Every href carries the locale. An unprefixed '/drafts' would bounce through
  // the proxy's redirect on every click, costing a round trip per navigation.
  const links = [
    { href: `/${locale}`, label: m.nav.dashboard, exact: true },
    { href: `/${locale}/run`, label: m.nav.newRun, exact: false },
    { href: `/${locale}/brands`, label: m.nav.brands, exact: false },
    { href: `/${locale}/drafts`, label: m.nav.drafts, exact: false },
  ];

  return (
    // EONYX: the persistent red corner slash (a chevron fragment) is the
    // brand's editorial device; structure comes from hairlines, not shadows.
    <header className="relative border-b border-border">
      <span className="eonyx-slash" aria-hidden="true" />
      <nav className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4 pl-12">
        <Link href={`/${locale}`} aria-label={m.nav.home}>
          <Logo variant="wordmark" height={20} />
        </Link>
        <div className="flex gap-6">
          {links.map((link) => {
            // The dashboard root would prefix-match everything, so it is exact.
            const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
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
        <div className="ml-auto flex items-center gap-4">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}
