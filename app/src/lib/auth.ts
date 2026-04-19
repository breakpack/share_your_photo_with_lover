import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE_NAME = 'photoshare_session';
const SEVEN_DAYS = 60 * 60 * 24 * 7;
const SESSION_VERSION = 1;

type SessionPayloadV1 = {
  v: number;
  u: string;
  iat: number;
  exp: number;
};

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

function shouldUseSecureCookie() {
  const env = process.env.COOKIE_SECURE;
  if (env === '1') return true;
  if (env === '0') return false;
  return process.env.NODE_ENV === 'production';
}

function encodeSessionPayload(payload: SessionPayloadV1): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSessionPayload(raw: string): SessionPayloadV1 | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const p = JSON.parse(decoded) as Partial<SessionPayloadV1>;
    if (p.v !== SESSION_VERSION) return null;
    if (typeof p.u !== 'string' || !p.u) return null;
    if (typeof p.iat !== 'number' || typeof p.exp !== 'number') return null;
    if (!Number.isFinite(p.iat) || !Number.isFinite(p.exp)) return null;
    if (p.exp <= Date.now()) return null;
    return { v: p.v, u: p.u, iat: p.iat, exp: p.exp };
  } catch {
    return null;
  }
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
  const now = Date.now();
  const payload: SessionPayloadV1 = {
    v: SESSION_VERSION,
    u: name,
    iat: now,
    exp: now + SEVEN_DAYS * 1000,
  };

  cookies().set(COOKIE_NAME, sign(encodeSessionPayload(payload)), {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SEVEN_DAYS,
    secure: shouldUseSecureCookie(),
    priority: 'high',
  });
}

export function destroySession() {
  cookies().delete(COOKIE_NAME);
}

export function getCurrentUser(): string | null {
  const c = cookies().get(COOKIE_NAME);
  if (!c) return null;

  const raw = verify(c.value);
  if (!raw) return null;

  // v1 payload (base64url json) + legacy fallback (plain username)
  const payload = decodeSessionPayload(raw);
  const name = payload?.u ?? raw;

  if (!getConfiguredAccounts().some((a) => a.name === name)) return null;
  return name;
}
