import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE_NAME = 'photoshare_session';
const SEVEN_DAYS = 60 * 60 * 24 * 7;

export type Account = { name: string; password: string };

export function getConfiguredAccounts(): Account[] {
  const accounts: Account[] = [];
  for (const i of [1, 2]) {
    const name = process.env[`USER${i}_NAME`];
    const password = process.env[`USER${i}_PASSWORD`];
    if (name && password) accounts.push({ name, password });
  }
  return accounts;
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (at least 16 chars).');
  return s;
}

function sign(value: string): string {
  const h = crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
  return `${value}.${h}`;
}

function verify(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const expected = sign(value);
  if (
    expected.length !== signed.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signed))
  ) {
    return null;
  }
  return value;
}

export function authenticate(name: string, password: string): boolean {
  const acc = getConfiguredAccounts().find((a) => a.name === name);
  if (!acc) return false;
  const a = Buffer.from(acc.password);
  const b = Buffer.from(password);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSession(name: string) {
  cookies().set(COOKIE_NAME, sign(name), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SEVEN_DAYS,
    // Only mark cookie Secure when the site is actually served over HTTPS.
    // Set COOKIE_SECURE=1 when behind an HTTPS-terminating reverse proxy.
    secure: process.env.COOKIE_SECURE === '1',
  });
}

export function destroySession() {
  cookies().delete(COOKIE_NAME);
}

export function getCurrentUser(): string | null {
  const c = cookies().get(COOKIE_NAME);
  if (!c) return null;
  const name = verify(c.value);
  if (!name) return null;
  if (!getConfiguredAccounts().some((a) => a.name === name)) return null;
  return name;
}

