import { NextRequest, NextResponse } from 'next/server';
import { authenticate, createSession } from '@/lib/auth';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 12;
const BLOCK_MS = 15 * 60 * 1000;

type LoginBucket = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

const buckets = new Map<string, LoginBucket>();

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const key = `${getClientIp(req)}:${name || '__empty__'}`;
  const now = Date.now();
  pruneBuckets(now);

  const blocked = isBlocked(key, now);
  if (blocked) {
    return noStoreJson(
      { error: 'too many attempts', retryAfterSec: Math.ceil((blocked - now) / 1000) },
      { status: 429 },
    );
  }

  if (!authenticate(name, password)) {
    registerFailure(key, now);
    return noStoreJson({ error: 'invalid credentials' }, { status: 401 });
  }

  clearFailures(key);
  createSession(name);
  return noStoreJson({ name });
}

function getClientIp(req: NextRequest) {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

function isBlocked(key: string, now: number): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  if (bucket.blockedUntil > now) return bucket.blockedUntil;
  if (now - bucket.windowStart > WINDOW_MS) {
    buckets.delete(key);
    return 0;
  }
  return 0;
}

function registerFailure(key: string, now: number) {
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, {
      count: 1,
      windowStart: now,
      blockedUntil: 0,
    });
    return;
  }

  bucket.count += 1;
  if (bucket.count >= MAX_ATTEMPTS) {
    bucket.blockedUntil = now + BLOCK_MS;
  }
}

function clearFailures(key: string) {
  buckets.delete(key);
}

function pruneBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    const windowExpired = now - bucket.windowStart > WINDOW_MS;
    const blockExpired = bucket.blockedUntil <= now;
    if (windowExpired && blockExpired) buckets.delete(key);
  }
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const res = NextResponse.json(body, init);
  res.headers.set('cache-control', 'private, no-store, max-age=0, must-revalidate');
  res.headers.set('pragma', 'no-cache');
  res.headers.set('expires', '0');
  return res;
}
