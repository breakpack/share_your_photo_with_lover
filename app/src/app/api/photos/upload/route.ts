import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { ensureStorage, originalPath, thumbPath } from '@/lib/storage';
import { serializePhoto } from '@/lib/serialize';
import { enqueueBackgroundJob } from '@/lib/background-queue';
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
  const bulkMode = url.searchParams.get('bulk') === '1';
  const hidden = url.searchParams.get('hidden') === '1';
  const blurred = url.searchParams.get('blurred') === '1';
  const caption = url.searchParams.get('caption') || null;
  const giftBoxId = parseGiftBoxId(url.searchParams.get('giftBoxId'));
  const giftOrder = parseGiftOrder(url.searchParams.get('giftOrder'));
  const clientLastModified = parseEpochMs(req.headers.get('x-file-last-modified'));
  const tagNamesParam = url.searchParams.get('tags') || '';
  const tagNames = Array.from(
    new Set(
      tagNamesParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );

  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  if (!isImage && !isVideo) {
    return NextResponse.json(
      { error: 'only image/* or video/* content-type is allowed' },
      { status: 400 },
    );
  }

  await ensureStorage();

  if (giftBoxId) {
    const box = await prisma.giftBox.upsert({
      where: { id: giftBoxId },
      update: {},
      create: {
        id: giftBoxId,
        ownerName: user,
      },
      select: { ownerName: true, openedAt: true },
    });
    if (box.ownerName !== user) {
      return NextResponse.json({ error: 'invalid giftBox owner' }, { status: 403 });
    }
    if (box.openedAt) {
      return NextResponse.json({ error: 'gift box already opened' }, { status: 409 });
    }
  }

  const photo = await prisma.photo.create({
    data: {
      filename,
      mimeType,
      sizeBytes: BigInt(0),
      hidden,
      blurred,
      caption: caption || null,
      ownerName: user,
      giftBoxId: giftBoxId ?? undefined,
      giftOrder: giftBoxId ? (giftOrder ?? undefined) : undefined,
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
      if (bulkMode) {
        enqueueBackgroundJob(async () => {
          try {
            await generateThumbnail(dest, thumbPath(photo.id), mimeType);
          } catch (err) {
            console.error('thumbnail deferred failed', err);
          }
        });
      } else {
        try {
          await generateThumbnail(dest, thumbPath(photo.id), mimeType);
        } catch (err) {
          console.error('thumbnail failed', err);
        }
      }
    }

    const hasDuplicateFilename =
      (await prisma.photo.count({ where: { filename } })) > 1;
    const effectiveTagNames = hasDuplicateFilename
      ? Array.from(new Set([...tagNames, DUPLICATE_FILENAME_TAG]))
      : tagNames;

    const tagByName = new Map<string, { id: string; name: string }>();
    if (effectiveTagNames.length) {
      await prisma.tag.createMany({
        data: effectiveTagNames.map((name) => ({ name })),
        skipDuplicates: true,
      });
      const tags = await prisma.tag.findMany({
        where: { name: { in: effectiveTagNames } },
        select: { id: true, name: true },
      });
      for (const tag of tags) {
        tagByName.set(tag.name, tag);
      }

      if (tags.length) {
        await prisma.tagOnPhoto.createMany({
          data: tags.map((t) => ({ photoId: photo.id, tagId: t.id })),
          skipDuplicates: true,
        });
      }
    }

    if (hasDuplicateFilename) {
      const duplicateTagId = tagByName.get(DUPLICATE_FILENAME_TAG)?.id;
      if (duplicateTagId) {
        await prisma.$executeRaw`
          INSERT INTO "TagOnPhoto" ("photoId", "tagId")
          SELECT p.id, ${duplicateTagId}
          FROM "Photo" p
          WHERE p."filename" = ${filename}
          ON CONFLICT ("photoId", "tagId") DO NOTHING
        `;
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

function parseGiftBoxId(v: string | null): string | null {
  if (!v) return null;
  const id = v.trim();
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) return null;
  return id;
}

function parseGiftOrder(v: string | null): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
