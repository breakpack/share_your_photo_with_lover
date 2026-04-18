import { NextRequest } from 'next/server';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { thumbPath } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return new Response('unauthorized', { status: 401 });

  const photo = await prisma.photo.findUnique({ where: { id: ctx.params.id } });
  if (!photo) return new Response('not found', { status: 404 });
  if (photo.hidden && photo.ownerName !== user) {
    return new Response('forbidden', { status: 403 });
  }

  const file = thumbPath(photo.id);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return new Response('missing file', { status: 404 });
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
