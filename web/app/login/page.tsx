'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export default function LoginPage() {
  const router = useRouter();
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
      router.push('/');
      router.refresh();
      return;
    }
    setError('Incorrect password');
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center p-6">
      <span className="eonyx-slash" aria-hidden="true" />
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="space-y-2">
          <p className="eonyx-kicker">AI Content Pipeline</p>
          <h1 className="text-4xl font-bold tracking-[-0.015em]">LUMEN</h1>
        </div>
        <p className="text-sm text-muted-foreground">Enter the demo password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-10.5 w-full rounded-sm border border-input bg-transparent px-3 text-sm"
          placeholder="Password"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={pending || password.length === 0}
          className="h-10.5 w-full rounded-sm bg-primary font-mono text-[11px] uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-(--accent-hover) disabled:opacity-40"
        >
          {pending ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </main>
  );
}
