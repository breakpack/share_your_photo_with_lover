import { NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { originalPath, thumbPath } from '@/lib/storage';
import { generateThumbnail } from '@/lib/image-metadata';
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

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return new Response('unauthorized', { status: 401, headers: secureHeaders() });

  const photo = await prisma.photo.findUnique({
    where: { id: ctx.params.id },
    include: { giftBox: { select: { openedAt: true } } },
  });
  if (!photo) return new Response('not found', { status: 404, headers: secureHeaders() });
  if (photo.giftBoxId && !photo.giftBox?.openedAt) {
    return new Response('not found', { status: 404, headers: secureHeaders() });
  }

  const file = thumbPath(photo.id);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    if (!photo.mimeType.startsWith('image/')) {
      return new Response('missing file', { status: 404, headers: secureHeaders() });
    }
    try {
      await generateThumbnail(originalPath(photo.id), file, photo.mimeType);
      stat = await fs.stat(file);
    } catch (err) {
      console.error('thumb lazy-generate failed', err);
      return new Response('missing file', { status: 404, headers: secureHeaders() });
    }
  }

  if (photo.hidden) {
    try {
      const masked = await sharp(file, { failOn: 'none' })
        .blur(18)
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();
      const body = Uint8Array.from(masked);
      return new Response(body, {
        headers: secureHeaders({
          'content-type': 'image/jpeg',
          'content-length': String(masked.length),
        }),
      });
    } catch (err) {
      console.error('hidden thumb blur failed', err);
      return new Response('thumbnail processing failed', { status: 500, headers: secureHeaders() });
    }
  }

  const nodeStream = createReadStream(file);
  const webStream = toWebReadableSafe(nodeStream);

  return new Response(webStream, {
    headers: secureHeaders({
      'content-type': 'image/jpeg',
      'content-length': String(stat.size),
    }),
  });
}
