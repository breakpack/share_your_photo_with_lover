import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'photoshare_session';
const NO_STORE = 'private, no-store, max-age=0, must-revalidate';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/api/') && isMutationMethod(req.method)) {
    if (!isSameOriginMutation(req)) {
      const res = NextResponse.json({ error: 'forbidden' }, { status: 403 });
      applySecurityHeaders(res);
      applyNoStoreHeaders(res);
      return res;
    }
  }

  const isAuthPage = pathname === '/';
  const isProtectedApi =
    pathname === '/api/photos' ||
    pathname.startsWith('/api/photos/') ||
    pathname === '/api/tags' ||
    pathname.startsWith('/api/tags/');

  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if ((isAuthPage || isProtectedApi) && !hasSessionCookie) {
    if (isProtectedApi) {
      const res = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      applySecurityHeaders(res);
      applyNoStoreHeaders(res);
      return res;
    }

    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    const res = NextResponse.redirect(url);
    applySecurityHeaders(res);
    applyNoStoreHeaders(res);
    return res;
  }

  const res = NextResponse.next();

  // Login and API endpoints should not be cached by browsers/proxies.
  if (pathname === '/' || pathname === '/login' || pathname.startsWith('/api/')) {
    applyNoStoreHeaders(res);
  }

  applySecurityHeaders(res);
  return res;
}

export const config = {
  matcher: ['/', '/login', '/api/:path*'],
};

function applySecurityHeaders(res: NextResponse) {
  res.headers.set('x-frame-options', 'DENY');
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'no-referrer');
  res.headers.set('cross-origin-opener-policy', 'same-origin');
  res.headers.set('cross-origin-resource-policy', 'same-origin');
}

function applyNoStoreHeaders(res: NextResponse) {
  res.headers.set('cache-control', NO_STORE);
  res.headers.set('pragma', 'no-cache');
  res.headers.set('expires', '0');
  appendVaryCookie(res);
}

function appendVaryCookie(res: NextResponse) {
  const prev = res.headers.get('vary');
  if (!prev) {
    res.headers.set('vary', 'Cookie');
    return;
  }
  const values = prev
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!values.includes('cookie')) {
    res.headers.set('vary', `${prev}, Cookie`);
  }
}

function isMutationMethod(method: string) {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function isSameOriginMutation(req: NextRequest) {
  const origin = parseOrigin(req.headers.get('origin'));
  if (origin) {
    const allowedHosts = getAllowedHosts(req);
    if (!allowedHosts.has(origin.host)) return false;
  }

  const secFetchSite = req.headers.get('sec-fetch-site');
  if (!secFetchSite) return true;
  return (
    secFetchSite === 'same-origin' ||
    secFetchSite === 'same-site' ||
    secFetchSite === 'none'
  );
}

function getAllowedHosts(req: NextRequest): Set<string> {
  const out = new Set<string>();
  if (req.nextUrl.host) out.add(req.nextUrl.host.toLowerCase());
  const forwardedHost = firstHeaderValue(req.headers.get('x-forwarded-host'));
  const host = firstHeaderValue(req.headers.get('host'));
  if (forwardedHost) out.add(forwardedHost.toLowerCase());
  if (host) out.add(host.toLowerCase());

  return out;
}

function firstHeaderValue(v: string | null): string {
  if (!v) return '';
  return v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)[0] ?? '';
}

function parseOrigin(v: string | null): URL | null {
  if (!v) return null;
  try {
    return new URL(v);
  } catch {
    return null;
  }
}
