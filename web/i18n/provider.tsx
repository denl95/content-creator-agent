'use client';

import { createContext, useContext } from 'react';
import type { Locale, Messages } from './index';

const MessagesContext = createContext<{ locale: Locale; messages: Messages } | null>(null);

/**
 * Client Components read messages from context rather than props. The run
 * screen alone would otherwise thread them through three levels, and every
 * intermediate component would grow a prop it does not use.
 */
export function MessagesProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  return (
    <MessagesContext.Provider value={{ locale, messages }}>{children}</MessagesContext.Provider>
  );
}

export function useMessages(): Messages {
  const value = useContext(MessagesContext);
  if (!value) throw new Error('useMessages must be used inside MessagesProvider');
  return value.messages;
}

export function useLocale(): Locale {
  const value = useContext(MessagesContext);
  if (!value) throw new Error('useLocale must be used inside MessagesProvider');
  return value.locale;
}
