import fs from 'node:fs/promises';
import sharp from 'sharp';
import exifr from 'exifr';

export type ParsedImageMetadata = {
  width: number | null;
  height: number | null;
  takenAt: Date | null;
  sourceCreatedAt: Date | null;
  sourceModifiedAt: Date | null;
  gpsLat: number | null;
  gpsLng: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  artist: string | null;
  raw: any;
};

export function emptyImageMetadata(): ParsedImageMetadata {
  return {
    width: null,
    height: null,
    takenAt: null,
    sourceCreatedAt: null,
    sourceModifiedAt: null,
    gpsLat: null,
    gpsLng: null,
    cameraMake: null,
    cameraModel: null,
    artist: null,
    raw: null,
  };
}

export async function generateThumbnail(inputPath: string, outputPath: string) {
  await sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(outputPath);
}

export async function extractImageMetadata(path: string): Promise<ParsedImageMetadata> {
  const out = emptyImageMetadata();
  let sharpMeta: sharp.Metadata | null = null;

  try {
    sharpMeta = await sharp(path, { failOn: 'none' }).metadata();
    out.width = sharpMeta.width ?? null;
    out.height = sharpMeta.height ?? null;
  } catch {
    // keep null width/height
  }

  const data = await parseExifData(path, sharpMeta?.exif ? Buffer.from(sharpMeta.exif) : null);
  if (data) {
    out.sourceCreatedAt = pickDate(data, [
      'DateTimeOriginal',
      'SubSecDateTimeOriginal',
      'CreateDate',
      'SubSecCreateDate',
      'CreationDate',
      'DateCreated',
      'ContentCreateDate',
      'MediaCreateDate',
      'TrackCreateDate',
    ]);
    out.sourceModifiedAt = pickDate(data, [
      'ModifyDate',
      'SubSecModifyDate',
      'ContentModifyDate',
      'MediaModifyDate',
      'TrackModifyDate',
    ]);
    out.takenAt =
      pickDate(data, ['DateTimeOriginal']) ??
      out.sourceCreatedAt ??
      out.sourceModifiedAt;
    out.gpsLat = typeof data.latitude === 'number' ? data.latitude : null;
    out.gpsLng = typeof data.longitude === 'number' ? data.longitude : null;
    out.cameraMake = str(data.Make);
    out.cameraModel = str(data.Model);
    out.artist = str(data.Artist) || str(data.Creator) || str(data.Byline);
    out.raw = sanitize(data);
  }

  // Fallback: if EXIF container dates are absent, use filesystem timestamps.
  // This guarantees "정보 재파싱" after legacy uploads can still fill dates.
  try {
    const stat = await fs.stat(path);
    out.sourceCreatedAt =
      out.sourceCreatedAt ??
      asDate(stat.birthtime) ??
      asDate(stat.ctime);
    out.sourceModifiedAt = out.sourceModifiedAt ?? asDate(stat.mtime);
  } catch {
    // ignore stat fallback failure
  }

  out.takenAt = out.takenAt ?? out.sourceCreatedAt ?? out.sourceModifiedAt;

  return out;
}

const EXIFR_OPTS = {
  gps: true,
  tiff: true,
  exif: true,
  iptc: true,
  xmp: true,
} as const;

async function parseExifData(path: string, embeddedExif: Buffer | null): Promise<any | null> {
  const fromPath = await tryParseExif(path);
  if (fromPath) return fromPath;

  // Some files are stored without extension (id-only filename). For HEIC/HEIF
  // this can make path-based detection miss. Buffer parse is more robust.
  try {
    const file = await fs.readFile(path);
    const fromBuffer = await tryParseExif(file);
    if (fromBuffer) return fromBuffer;
  } catch {
    // ignore and continue
  }

  if (embeddedExif && embeddedExif.length > 0) {
    const fromEmbedded = await tryParseExif(embeddedExif);
    if (fromEmbedded) return fromEmbedded;
  }

  return null;
}

async function tryParseExif(input: string | Buffer | Uint8Array): Promise<any | null> {
  try {
    return await exifr.parse(input as any, EXIFR_OPTS);
  } catch {
    return null;
  }
}

function pickDate(data: any, keys: string[]): Date | null {
  for (const key of keys) {
    const d = asDate(data?.[key]);
    if (d) return d;
  }
  return null;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;

    // EXIF-like string: "YYYY:MM:DD HH:mm:ss" (optionally subseconds/tz)
    const m =
      /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:\s*(Z|[+\-]\d{2}:?\d{2}))?$/.exec(
        v.trim(),
      );
    if (!m) return null;

    const [, yy, mm, dd, hh, mi, ss, sub = '', tz] = m;
    const ms = sub ? Number(sub.padEnd(3, '0').slice(0, 3)) : 0;
    if (tz) {
      const normTz = tz === 'Z' ? 'Z' : `${tz.slice(0, 3)}:${tz.slice(-2)}`;
      const iso = `${yy}-${mm}-${dd}T${hh}:${mi}:${ss}.${String(ms).padStart(3, '0')}${normTz}`;
      const withTz = new Date(iso);
      return Number.isNaN(withTz.getTime()) ? null : withTz;
    }

    const local = new Date(
      Number(yy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(mi),
      Number(ss),
      ms,
    );
    return Number.isNaN(local.getTime()) ? null : local;
  }
  return null;
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
