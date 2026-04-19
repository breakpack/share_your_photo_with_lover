import { NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { originalPath, thumbPath } from '@/lib/storage';
import { generateThumbnail } from '@/lib/image-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return new Response('unauthorized', { status: 401 });

  const photo = await prisma.photo.findUnique({ where: { id: ctx.params.id } });
  if (!photo) return new Response('not found', { status: 404 });

  const file = thumbPath(photo.id);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    if (!photo.mimeType.startsWith('image/')) {
      return new Response('missing file', { status: 404 });
    }
    try {
      await generateThumbnail(originalPath(photo.id), file, photo.mimeType);
      stat = await fs.stat(file);
    } catch (err) {
      console.error('thumb lazy-generate failed', err);
      return new Response('missing file', { status: 404 });
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
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(masked.length),
          'cache-control': 'private, no-store',
        },
      });
    } catch (err) {
      console.error('hidden thumb blur failed', err);
      return new Response('thumbnail processing failed', { status: 500 });
    }
  }

  const nodeStream = createReadStream(file);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  return new Response(webStream, {
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(stat.size),
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}
