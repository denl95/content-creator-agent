import crypto from 'node:crypto';

export const SESSION_COOKIE = 'demo_session';

/** Read the password fresh each call so tests can change it at runtime. */
function password(): string | undefined {
  const value = process.env.DEMO_PASSWORD;
  return value && value.length > 0 ? value : undefined;
}

export function isAuthEnabled(): boolean {
  return password() !== undefined;
}

/** Opaque session value derived from the password — never the password itself. */
export function sessionToken(): string {
  const secret = password();
  if (!secret) throw new Error('sessionToken() called while auth is disabled');
  return crypto.createHmac('sha256', secret).update('content-creator-demo-session').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyPassword(input: string): boolean {
  const secret = password();
  if (!secret) return false;
  return safeEqual(input, secret);
}

export function verifySessionCookie(value: string | undefined): boolean {
  if (!isAuthEnabled()) return true;
  if (!value) return false;
  return safeEqual(value, sessionToken());
}
