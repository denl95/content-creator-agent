/**
 * Turn a failed `Response` from the API into something worth showing a user.
 *
 * Client-safe: unlike `lib/api.ts` this imports nothing from `next/headers`, so
 * both Client Components and Server Components can use it. Every screen that
 * calls `/api/*` should route its failures through here, otherwise status
 * handling (401 in particular) drifts between screens.
 */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) return 'Your session expired. Sign in again to continue.';
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  if (typeof body?.error === 'string') return body.error;
  return `${fallback} (HTTP ${res.status})`;
}
