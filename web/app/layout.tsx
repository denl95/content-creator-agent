import type { Metadata } from 'next';
import { JetBrains_Mono, Montserrat } from 'next/font/google';
import './globals.css';

// EONYX brand faces: Montserrat (geometric display/UI) + JetBrains Mono
// (primary technical face — labels, kickers, data). Both are exact per the
// brand book, not substitutions.
const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '900'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'Lumen — AI Content Pipeline',
  description: 'Plan, write, edit and publish on-brand content with a human in the loop.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // EONYX is dark-first — the brand lives on near-black indigo, so there is
    // no light mode and no theme toggle.
    <html
      lang="en"
      className={`${montserrat.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body
        className="flex min-h-full flex-col bg-background text-foreground"
        style={{ fontFamily: 'var(--font-montserrat), system-ui, sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}
