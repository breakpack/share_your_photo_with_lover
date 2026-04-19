import fs from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { originalPath, thumbPath } from '@/lib/storage';
import { serializePhoto } from '@/lib/serialize';
import { extractImageMetadata, generateThumbnail } from '@/lib/image-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const photo = await prisma.photo.findUnique({ where: { id: ctx.params.id } });
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (!photo.mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'only image metadata can be reparsed' }, { status: 400 });
  }

  const src = originalPath(photo.id);
  try {
    await fs.stat(src);
  } catch {
    return NextResponse.json({ error: 'missing file' }, { status: 404 });
  }

  const parsed = await extractImageMetadata(src);

  try {
    await generateThumbnail(src, thumbPath(photo.id));
  } catch (err) {
    console.error('thumbnail reparse failed', err);
  }

  const updated = await prisma.photo.update({
    where: { id: photo.id },
    data: {
      width: parsed.width ?? undefined,
      height: parsed.height ?? undefined,
      takenAt: parsed.takenAt ?? undefined,
      sourceCreatedAt: parsed.sourceCreatedAt ?? undefined,
      sourceModifiedAt: parsed.sourceModifiedAt ?? undefined,
      gpsLat: parsed.gpsLat ?? undefined,
      gpsLng: parsed.gpsLng ?? undefined,
      cameraMake: parsed.cameraMake ?? undefined,
      cameraModel: parsed.cameraModel ?? undefined,
      artist: parsed.artist ?? undefined,
      exifJson: parsed.raw ?? undefined,
    },
    include: {
      tags: { include: { tag: true } },
      views: {
        where: { viewerName: user },
        select: { viewedAt: true },
        take: 1,
      },
    },
  });

  return NextResponse.json(
    serializePhoto({
      ...updated,
      unseen: updated.ownerName !== user && updated.views.length === 0,
      lastViewedAt: updated.views[0]?.viewedAt ?? null,
    }),
  );
}
