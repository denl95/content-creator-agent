import en, { type Messages } from './messages/en';
import uk from './messages/uk';

export const LOCALES = ['uk', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Ukrainian: the audience this dashboard is demonstrated to. */
export const DEFAULT_LOCALE: Locale = 'uk';

const CATALOGUES: Record<Locale, Messages> = { uk, en };

/** Lowercase only — the URL segment is the source, and `/UK` is not a route. */
export function isLocale(value: string | undefined | null): value is Locale {
  return value === 'uk' || value === 'en';
}

export function getMessages(locale: Locale): Messages {
  return CATALOGUES[locale];
}

/**
 * Cookie first, then Accept-Language, then Ukrainian. Kept here rather than in
 * proxy.ts so it is testable without constructing a NextRequest.
 */
export function resolveLocale(
  cookie: string | undefined | null,
  acceptLanguage: string | undefined | null,
): Locale {
  if (isLocale(cookie)) return cookie;
  for (const part of (acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

export type { Messages };
