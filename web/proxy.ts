import { type NextRequest, NextResponse } from 'next/server';
import { isLocale, resolveLocale } from './i18n/index';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

/** `/uk/login` and `/en/login` are the only pages reachable unauthenticated. */
const LOGIN_PATH = /^\/(uk|en)\/login$/;

/**
 * Next 16 renamed the `middleware` convention to `proxy` (nodejs runtime only).
 *
 * Two jobs, in order. First locale: a path without a locale prefix is
 * redirected to one, which is also how `/` reaches `/uk` — there is no page at
 * `/`, because a route outside `[locale]` would force a second root layout to
 * exist and `<html lang>` could then never follow the locale.
 *
 * Then auth, which has a single source of truth: the Hono server decides
 * whether the cookie is valid. It answers 200 unconditionally when
 * DEMO_PASSWORD is unset, so local development is unaffected and the HMAC logic
 * is never duplicated here.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/')[1];

  if (!isLocale(first)) {
    const locale = resolveLocale(
      request.cookies.get('locale')?.value,
      request.headers.get('accept-language'),
    );
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
    return NextResponse.redirect(url);
  }

  // The login exemption lives here rather than in the matcher. It used to be a
  // negative lookahead, and AGENTS.md records that getting that regex wrong
  // blocked the login page's own CSS; a readable check is easier to keep right.
  if (LOGIN_PATH.test(pathname)) return NextResponse.next();

  const check = await fetch(`${API_ORIGIN}/auth/check`, {
    headers: { cookie: request.headers.get('cookie') ?? '' },
    cache: 'no-store',
  }).catch(() => null);

  if (check?.ok) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${first}/login`;
  return NextResponse.redirect(url);
}

export const config = {
  // Static assets and the API must never reach this. Without the exclusions it
  // runs on _next/static too, which blocks CSS and JS from loading at all.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
