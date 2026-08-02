'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LOCALES } from '@/i18n/index';
import { useLocale, useMessages } from '@/i18n/provider';

/**
 * Switching locale is a link to the same path under the other prefix. It also
 * writes the `locale` cookie, so an unprefixed entry point — a bookmark to `/`
 * — honours the last choice rather than re-detecting from Accept-Language.
 */
export function LocaleToggle() {
  const current = useLocale();
  const messages = useMessages();
  const pathname = usePathname();
  const rest = pathname.replace(/^\/(uk|en)/, '');

  return (
    <div className="flex gap-2" aria-label={messages.nav.language}>
      {LOCALES.map((locale) => (
        <Link
          key={locale}
          href={`/${locale}${rest}`}
          onClick={() => {
            document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
          }}
          aria-current={locale === current ? 'true' : undefined}
          className={`eonyx-label ${
            locale === current ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {locale.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
