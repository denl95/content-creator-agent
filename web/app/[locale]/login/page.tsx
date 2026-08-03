'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Logo } from '@/components/logo';
import { useLocale, useMessages } from '@/i18n/provider';

export default function LoginPage() {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (res.ok) {
      router.push(`/${locale}`);
      router.refresh();
      return;
    }
    setError(m.login.failed);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <span className="eonyx-slash" aria-hidden="true" />
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="space-y-3">
          <Logo variant="wordmark" height={28} />
          <p className="eonyx-kicker">AI Content Pipeline</p>
        </div>
        <p className="text-sm text-muted-foreground">{m.login.intro}</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-10.5 w-full rounded-sm border border-input bg-transparent px-3 text-sm"
          placeholder={m.login.password}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={pending || password.length === 0}
          className="h-10.5 w-full rounded-sm bg-primary font-mono text-[11px] uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-(--accent-hover) disabled:opacity-40"
        >
          {pending ? m.login.checking : m.login.submit}
        </button>
      </form>
    </main>
  );
}
