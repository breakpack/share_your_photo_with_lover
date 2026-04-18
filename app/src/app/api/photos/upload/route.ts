import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import exifr from 'exifr';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { ensureStorage, originalPath, thumbPath } from '@/lib/storage';
import { serializePhoto } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    let width: number | undefined;
    let height: number | undefined;
    if (isImage) {
      try {
        const meta = await sharp(dest, { failOn: 'none' }).metadata();
        width = meta.width;
        height = meta.height;
        await sharp(dest, { failOn: 'none' })
          .rotate()
          .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(thumbPath(photo.id));
      } catch (err) {
        console.error('thumbnail failed', err);
      }
    }

    const exif = isImage ? await parseExif(dest) : empty();

    let tagConnects: { tagId: string }[] = [];
    if (tagNames.length) {
      const tags = await Promise.all(
        tagNames.map((name) =>
          prisma.tag.upsert({ where: { name }, update: {}, create: { name } }),
        ),
      );
      tagConnects = tags.map((t) => ({ tagId: t.id }));
    }

    const updated = await prisma.photo.update({
      where: { id: photo.id },
      data: {
        sizeBytes: BigInt(stat.size),
        width,
        height,
        takenAt: exif.takenAt,
        gpsLat: exif.gpsLat,
        gpsLng: exif.gpsLng,
        cameraMake: exif.cameraMake,
        cameraModel: exif.cameraModel,
        artist: exif.artist,
        exifJson: exif.raw ?? undefined,
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

type ParsedExif = {
  takenAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  artist: string | null;
  raw: any;
};

async function parseExif(path: string): Promise<ParsedExif> {
  try {
    const data = await exifr.parse(path, {
      gps: true,
      tiff: true,
      exif: true,
      iptc: true,
      xmp: true,
    });
    if (!data) return empty();
    const takenAtRaw =
      data.DateTimeOriginal || data.CreateDate || data.ModifyDate || null;
    const takenAt = takenAtRaw instanceof Date ? takenAtRaw : null;
    const gpsLat = typeof data.latitude === 'number' ? data.latitude : null;
    const gpsLng = typeof data.longitude === 'number' ? data.longitude : null;
    const cameraMake = str(data.Make);
    const cameraModel = str(data.Model);
    const artist = str(data.Artist) || str(data.Creator) || str(data.Byline);
    return {
      takenAt,
      gpsLat,
      gpsLng,
      cameraMake,
      cameraModel,
      artist,
      raw: sanitize(data),
    };
  } catch {
    return empty();
  }
}

function empty(): ParsedExif {
  return {
    takenAt: null,
    gpsLat: null,
    gpsLng: null,
    cameraMake: null,
    cameraModel: null,
    artist: null,
    raw: null,
  };
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

// Strip binary/unserializable values so JSON can store the EXIF blob.
function sanitize(obj: any, depth = 0): any {
  if (depth > 4 || obj == null) return null;
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) return undefined;
  if (Array.isArray(obj)) {
    const out = obj.map((v) => sanitize(v, depth + 1)).filter((v) => v !== undefined);
    return out.length ? out : null;
  }
  if (typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const s = sanitize(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return Object.keys(out).length ? out : null;
  }
  if (typeof obj === 'number' || typeof obj === 'string' || typeof obj === 'boolean') {
    return obj;
  }
  return undefined;
}
