'use client';

import { useEffect, useState } from 'react';

/** EONYX is dark-first, so dark is the default and light is an opt-in the
 *  choice persists in localStorage (read by the pre-paint script in layout). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.toggle('light', next === 'light');
    root.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="eonyx-label rounded-sm border border-border px-2 py-1 transition-colors hover:text-foreground"
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
