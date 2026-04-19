import { NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { originalPath } from '@/lib/storage';
import { convertHeicToJpegBuffer, isHeicMime } from '@/lib/heic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return new Response('unauthorized', { status: 401 });

  const photo = await prisma.photo.findUnique({ where: { id: ctx.params.id } });
  if (!photo) return new Response('not found', { status: 404 });
  if (photo.hidden && photo.ownerName !== user) {
    return new Response('forbidden', { status: 403 });
  }

  const file = originalPath(photo.id);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response('missing file', { status: 404 });
  }

  if (isHeicMime(photo.mimeType)) {
    try {
      const raw = await fs.readFile(file);
      const jpeg = await convertHeicToJpegBuffer(raw, 0.92);
      const body = Uint8Array.from(jpeg);
      return new Response(body, {
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(body.length),
          'cache-control': 'private, max-age=31536000, immutable',
        },
      });
    } catch (err) {
      console.error('heic file transcode failed', err);
      return new Response('file decoding failed', { status: 500 });
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
          headers: { 'content-range': `bytes */${size}` },
        });
      }
      const nodeStream = createReadStream(file, { start, end });
      const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
      return new Response(webStream, {
        status: 206,
        headers: {
          'content-type': photo.mimeType,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=31536000, immutable',
        },
      });
    }
  }

  const nodeStream = createReadStream(file);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new Response(webStream, {
    headers: {
      'content-type': photo.mimeType,
      'content-length': String(size),
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}
