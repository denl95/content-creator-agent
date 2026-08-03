import type { Metadata } from 'next';
import { JetBrains_Mono, Montserrat } from 'next/font/google';
import { notFound } from 'next/navigation';
import { isLocale, LOCALES } from '@/i18n/index';
import { MessagesProvider } from '@/i18n/provider';
import '../globals.css';

// EONYX brand faces: Montserrat (geometric display/UI) + JetBrains Mono
// (primary technical face — labels, kickers, data). Both are exact per the
// brand book, not substitutions.
//
// The cyrillic subset is not optional: without it Ukrainian falls back to a
// system face and the brand typography silently stops applying, which looks
// close enough to right that nobody notices.
const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin', 'cyrillic'],
  weight: ['300', '400', '500', '600', '700', '900'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'EONYX — AI Content Pipeline',
  description: 'Plan, write, edit and publish on-brand content with a human in the loop.',
};

/** Both locales are known at build time, so both shells prerender. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

// Applies the stored theme before first paint so there is no flash. EONYX is
// dark-first, so dark is the default when nothing has been chosen.
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme')==='light'?'light':'dark';document.documentElement.classList.add(t)}catch(e){document.documentElement.classList.add('dark')}`;

/**
 * This is the root layout, not a nested one. `<html lang>` has to reflect the
 * active locale and a root layout cannot read a child segment's params, so
 * `<html>` and `<body>` live here — which is also why nothing exists outside
 * `[locale]`, and why `/` is redirected by the proxy rather than by a page.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // params is a Promise in Next 16.
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html
      lang={locale}
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static string, must run before paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body
        className="flex min-h-full flex-col bg-background text-foreground"
        style={{ fontFamily: 'var(--font-montserrat), system-ui, sans-serif' }}
      >
        <MessagesProvider locale={locale}>{children}</MessagesProvider>
      </body>
    </html>
  );
}
