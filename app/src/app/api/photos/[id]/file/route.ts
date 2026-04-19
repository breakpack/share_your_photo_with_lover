import { NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { originalPath } from '@/lib/storage';
import { convertHeicToJpegBuffer, isHeicMime } from '@/lib/heic';
import { toWebReadableSafe } from '@/lib/stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = 'private, no-store, max-age=0, must-revalidate';

function secureHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  headers.set('cache-control', NO_STORE);
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cross-origin-resource-policy', 'same-origin');
  const vary = headers.get('vary');
  if (!vary) headers.set('vary', 'Cookie');
  else if (!vary.toLowerCase().includes('cookie')) headers.set('vary', `${vary}, Cookie`);
  return headers;
}

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return new Response('unauthorized', { status: 401, headers: secureHeaders() });

  const photo = await prisma.photo.findUnique({ where: { id: ctx.params.id } });
  if (!photo) return new Response('not found', { status: 404, headers: secureHeaders() });
  if (photo.hidden && photo.ownerName !== user) {
    return new Response('forbidden', { status: 403, headers: secureHeaders() });
  }

  const file = originalPath(photo.id);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response('missing file', { status: 404, headers: secureHeaders() });
  }

  if (isHeicMime(photo.mimeType)) {
    try {
      const raw = await fs.readFile(file);
      const jpeg = await convertHeicToJpegBuffer(raw, 0.92);
      const body = Uint8Array.from(jpeg);
      return new Response(body, {
        headers: secureHeaders({
          'content-type': 'image/jpeg',
          'content-length': String(body.length),
        }),
      });
    } catch (err) {
      console.error('heic file transcode failed', err);
      return new Response('file decoding failed', { status: 500, headers: secureHeaders() });
    }
  }

  const size = stat.size;

  // Honor HTTP Range requests. Required for <video> seeking/streaming
  // (especially Safari/iOS, which won't play without byte-range support).
  const range = req.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        end >= size ||
        start > end
      ) {
        return new Response(null, {
          status: 416,
          headers: secureHeaders({ 'content-range': `bytes */${size}` }),
        });
      }
      const nodeStream = createReadStream(file, { start, end });
      const webStream = toWebReadableSafe(nodeStream);
      return new Response(webStream, {
        status: 206,
        headers: secureHeaders({
          'content-type': photo.mimeType,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
        }),
      });
    }
  }

  const nodeStream = createReadStream(file);
  const webStream = toWebReadableSafe(nodeStream);

  return new Response(webStream, {
    headers: secureHeaders({
      'content-type': photo.mimeType,
      'content-length': String(size),
      'accept-ranges': 'bytes',
    }),
  });
}
