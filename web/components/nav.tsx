'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { LocaleToggle } from '@/components/locale-toggle';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { useLocale, useMessages } from '@/i18n/provider';

type NavLink = { href: string; label: string; exact: boolean };

export function Nav() {
  const pathname = usePathname();
  const locale = useLocale();
  const m = useMessages();
  const activeTab = useRef<HTMLAnchorElement>(null);

  // Every href carries the locale. An unprefixed '/drafts' would bounce through
  // the proxy's redirect on every click, costing a round trip per navigation.
  const links: NavLink[] = [
    { href: `/${locale}`, label: m.nav.dashboard, exact: true },
    { href: `/${locale}/run`, label: m.nav.newRun, exact: false },
    { href: `/${locale}/brands`, label: m.nav.brands, exact: false },
    { href: `/${locale}/drafts`, label: m.nav.drafts, exact: false },
  ];

  // The dashboard root would prefix-match everything, so it is exact.
  const isActive = (link: NavLink) =>
    link.exact ? pathname === link.href : pathname.startsWith(link.href);

  // The active tab can sit off-screen in the scrolling strip — on /drafts it is
  // last, and a 320px phone shows three of the four. `inline: 'center'` rather
  // than 'nearest': nearest scrolls the minimum, which leaves the tab flush
  // against the edge and reading as clipped. The browser clamps to the
  // scrollable range, so the first tab still lands at 0. `block: 'nearest'`
  // keeps the page from jumping vertically to bring the header into frame.
  useEffect(() => {
    activeTab.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    // EONYX: the persistent red corner slash (a chevron fragment) is the
    // brand's editorial device; structure comes from hairlines, not shadows.
    <header className="relative border-b border-border">
      <span className="eonyx-slash" aria-hidden="true" />
      <div className="mx-auto max-w-6xl">
        {/* The slash is 34x48px at the top-left corner, so only this row needs
            to be indented past it. The strip below starts lower than 48px. */}
        <nav
          aria-label={m.nav.home}
          className="flex items-center gap-8 py-4 pr-4 pl-12 md:px-6 md:pl-12"
        >
          <Link href={`/${locale}`} aria-label={m.nav.home}>
            <Logo variant="wordmark" height={20} />
          </Link>
          <div className="hidden gap-6 md:flex">
            {links.map((link) => (
              <NavItem key={link.href} link={link} active={isActive(link)} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-4">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </nav>

        {/* Phones only. Four wide-tracked uppercase labels do not fit beside the
            wordmark and the toggles — before this they overflowed, taking the
            Drafts link and both toggles off-screen entirely. Scrolling rather
            than wrapping keeps the header a fixed height and survives a longer
            translation or a fifth destination. */}
        <div className="overflow-x-auto border-t border-border/60 no-scrollbar md:hidden">
          <div className="flex w-max gap-6 px-4">
            {links.map((link) => {
              const active = isActive(link);
              return (
                <NavItem
                  key={link.href}
                  link={link}
                  active={active}
                  ref={active ? activeTab : undefined}
                  className="py-3.5"
                />
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}

function NavItem({
  link,
  active,
  className,
  ref,
}: {
  link: NavLink;
  active: boolean;
  className?: string;
  ref?: React.Ref<HTMLAnchorElement>;
}) {
  return (
    <Link
      ref={ref}
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={`eonyx-label whitespace-nowrap border-b-2 pb-0.5 transition-colors ${
        active ? 'border-brand text-foreground' : 'border-transparent hover:text-foreground'
      } ${className ?? ''}`}
    >
      {link.label}
    </Link>
  );
}
