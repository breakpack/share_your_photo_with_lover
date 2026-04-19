import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { ensureStorage, originalPath, thumbPath } from '@/lib/storage';
import { serializePhoto } from '@/lib/serialize';
import {
  emptyImageMetadata,
  extractImageMetadata,
  generateThumbnail,
} from '@/lib/image-metadata';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const DUPLICATE_FILENAME_TAG = '중복파일';

// Client uploads a single file as the raw request body. Metadata comes from
// query params / headers. This avoids multipart buffering so original files
// of any size can be streamed directly to disk.
export async function POST(req: NextRequest) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!req.body) {
    return NextResponse.json({ error: 'empty body' }, { status: 400 });
  }

  const url = new URL(req.url);
  const filename = decodeURIComponent(url.searchParams.get('filename') || 'photo');
  const mimeType = req.headers.get('content-type') || 'application/octet-stream';
  const hidden = url.searchParams.get('hidden') === '1';
  const blurred = url.searchParams.get('blurred') === '1';
  const caption = url.searchParams.get('caption') || null;
  const clientLastModified = parseEpochMs(req.headers.get('x-file-last-modified'));
  const tagNamesParam = url.searchParams.get('tags') || '';
  const tagNames = tagNamesParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  if (!isImage && !isVideo) {
    return NextResponse.json(
      { error: 'only image/* or video/* content-type is allowed' },
      { status: 400 },
    );
  }

  await ensureStorage();

  const photo = await prisma.photo.create({
    data: {
      filename,
      mimeType,
      sizeBytes: BigInt(0),
      hidden,
      blurred,
      caption: caption || null,
      ownerName: user,
    },
  });

  const dest = originalPath(photo.id);

  try {
    const nodeStream = Readable.fromWeb(req.body as any);
    const out = createWriteStream(dest);
    await pipeline(nodeStream, out);

    const stat = await fs.stat(dest);

    const imageMeta = isImage ? await extractImageMetadata(dest) : emptyImageMetadata();
    if (isImage) {
      try {
        await generateThumbnail(dest, thumbPath(photo.id), mimeType);
      } catch (err) {
        console.error('thumbnail failed', err);
      }
    }

    const duplicateRows = await prisma.photo.findMany({
      where: { filename, id: { not: photo.id } },
      select: { id: true },
    });
    const hasDuplicateFilename = duplicateRows.length > 0;
    const effectiveTagNames = hasDuplicateFilename
      ? Array.from(new Set([...tagNames, DUPLICATE_FILENAME_TAG]))
      : tagNames;

    let tagConnects: { tagId: string }[] = [];
    const tagByName = new Map<string, { id: string; name: string }>();
    if (effectiveTagNames.length) {
      const tags = await Promise.all(
        effectiveTagNames.map((name) =>
          prisma.tag.upsert({ where: { name }, update: {}, create: { name } }),
        ),
      );
      for (const tag of tags) {
        tagByName.set(tag.name, { id: tag.id, name: tag.name });
      }
      tagConnects = tags.map((t) => ({ tagId: t.id }));
    }

    if (hasDuplicateFilename) {
      const duplicateTagId = tagByName.get(DUPLICATE_FILENAME_TAG)?.id;
      if (duplicateTagId) {
        await prisma.tagOnPhoto.createMany({
          data: duplicateRows.map((row) => ({
            photoId: row.id,
            tagId: duplicateTagId,
          })),
          skipDuplicates: true,
        });
      }
    }

    const updated = await prisma.photo.update({
      where: { id: photo.id },
      data: {
        sizeBytes: BigInt(stat.size),
        width: imageMeta.width ?? undefined,
        height: imageMeta.height ?? undefined,
        takenAt: imageMeta.takenAt,
        sourceCreatedAt: imageMeta.sourceCreatedAt ?? imageMeta.takenAt ?? undefined,
        sourceModifiedAt: imageMeta.sourceModifiedAt ?? clientLastModified ?? undefined,
        gpsLat: imageMeta.gpsLat,
        gpsLng: imageMeta.gpsLng,
        cameraMake: imageMeta.cameraMake,
        cameraModel: imageMeta.cameraModel,
        artist: imageMeta.artist,
        exifJson: imageMeta.raw ?? undefined,
        tags: tagConnects.length
          ? { create: tagConnects.map((t) => ({ tagId: t.tagId })) }
          : undefined,
      },
      include: { tags: { include: { tag: true } } },
    });

    return NextResponse.json(serializePhoto(updated));
  } catch (err) {
    console.error('upload failed', err);
    try {
      await fs.unlink(dest);
    } catch {}
    await prisma.photo.delete({ where: { id: photo.id } }).catch(() => {});
    return NextResponse.json({ error: 'upload failed' }, { status: 500 });
  }
}

function parseEpochMs(v: string | null): Date | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}
