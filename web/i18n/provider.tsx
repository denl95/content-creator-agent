'use client';

import { createContext, useContext } from 'react';
import { getMessages, type Locale, type Messages } from './index';

/**
 * Only the locale crosses the Server→Client boundary — never the catalogue.
 *
 * Passing `messages` as a prop looked natural and fails the build: some entries
 * are functions, and React cannot serialise a function into a Client Component
 * ("Functions cannot be passed directly to Client Components"). Since the
 * catalogues are static modules, the client imports them itself and the only
 * thing that has to travel is a two-character string.
 *
 * The cost is that both catalogues are in the client bundle. At roughly 150
 * short strings that is negligible, and it makes switching locale instant.
 */
const LocaleContext = createContext<Locale | null>(null);

export function MessagesProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  const locale = useContext(LocaleContext);
  if (!locale) throw new Error('useLocale must be used inside MessagesProvider');
  return locale;
}

export function useMessages(): Messages {
  return getMessages(useLocale());
}
