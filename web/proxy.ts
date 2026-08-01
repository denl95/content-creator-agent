import { type NextRequest, NextResponse } from 'next/server';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

/**
 * Next 16 renamed the `middleware` convention to `proxy` (nodejs runtime only).
 *
 * Auth has a single source of truth: the Hono server decides whether the cookie
 * is valid. It answers 200 unconditionally when DEMO_PASSWORD is unset, so local
 * development is unaffected and the HMAC logic is never duplicated here.
 */
export async function proxy(request: NextRequest) {
  const check = await fetch(`${API_ORIGIN}/auth/check`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
  }).catch(() => null);

  if (check?.ok) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  // Without a matcher this runs on every request including _next/static, which
  // would block CSS and JS from loading on the login page itself.
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'],
};
