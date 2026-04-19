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
    out.takenAt = pickDate(data, TAKEN_AT_CANDIDATES);
    out.sourceCreatedAt = pickDate(data, SOURCE_CREATED_AT_CANDIDATES);
    out.sourceModifiedAt = pickDate(data, SOURCE_MODIFIED_AT_CANDIDATES);
    out.takenAt = out.takenAt ?? out.sourceCreatedAt ?? out.sourceModifiedAt;
    out.gpsLat = num(data.latitude) ?? num(data.GPSLatitude);
    out.gpsLng = num(data.longitude) ?? num(data.GPSLongitude);
    out.cameraMake = str(data.Make);
    out.cameraModel = str(data.Model);
    out.artist = str(data.Artist) || str(data.Creator) || str(data.Byline);
    out.raw = sanitize(data);
  }

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

type DateKeyCandidate = {
  key: string;
  offsetKeys?: string[];
};

const TAKEN_AT_CANDIDATES: DateKeyCandidate[] = [
  { key: 'DateTimeOriginal', offsetKeys: ['OffsetTimeOriginal', 'TimeZoneOffset'] },
  { key: 'SubSecDateTimeOriginal', offsetKeys: ['OffsetTimeOriginal', 'TimeZoneOffset'] },
  { key: 'CreateDate', offsetKeys: ['OffsetTimeDigitized', 'OffsetTime', 'TimeZoneOffset'] },
  { key: 'SubSecCreateDate', offsetKeys: ['OffsetTimeDigitized', 'OffsetTime', 'TimeZoneOffset'] },
  { key: 'CreationDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
];

const SOURCE_CREATED_AT_CANDIDATES: DateKeyCandidate[] = [
  { key: 'CreationDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'ContentCreateDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'MediaCreateDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'TrackCreateDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'DateCreated', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'CreateDate', offsetKeys: ['OffsetTimeDigitized', 'OffsetTime', 'TimeZoneOffset'] },
  { key: 'SubSecCreateDate', offsetKeys: ['OffsetTimeDigitized', 'OffsetTime', 'TimeZoneOffset'] },
  { key: 'DateTimeOriginal', offsetKeys: ['OffsetTimeOriginal', 'TimeZoneOffset'] },
  { key: 'SubSecDateTimeOriginal', offsetKeys: ['OffsetTimeOriginal', 'TimeZoneOffset'] },
];

const SOURCE_MODIFIED_AT_CANDIDATES: DateKeyCandidate[] = [
  { key: 'ContentModifyDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'MediaModifyDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'TrackModifyDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'ModifyDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
  { key: 'SubSecModifyDate', offsetKeys: ['OffsetTime', 'TimeZoneOffset'] },
];

function pickDate(data: any, candidates: DateKeyCandidate[]): Date | null {
  for (const c of candidates) {
    const assumedOffset = pickOffset(data, c.offsetKeys ?? []);
    const d = asDateWithOffset(data?.[c.key], assumedOffset);
    if (d) return d;
  }
  return null;
}

function asDate(v: unknown): Date | null {
  return asDateWithOffset(v, null);
}

function asDateWithOffset(v: unknown, assumedOffset: string | null): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;

    const parsed = parseExifDateLike(v);
    if (!parsed) return null;

    const { yy, mm, dd, hh, mi, ss, ms, tz } = parsed;
    const resolvedTz = normalizeOffset(tz) ?? assumedOffset;
    if (resolvedTz) {
      const iso = `${yy}-${mm}-${dd}T${hh}:${mi}:${ss}.${String(ms).padStart(3, '0')}${resolvedTz}`;
      const withOffset = new Date(iso);
      return Number.isNaN(withOffset.getTime()) ? null : withOffset;
    }

    // No offset metadata: keep legacy behavior (server-local interpretation).
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

function parseExifDateLike(v: string): null | {
  yy: string;
  mm: string;
  dd: string;
  hh: string;
  mi: string;
  ss: string;
  ms: number;
  tz: string | null;
} {
  const m =
    /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:\s*(Z|[+\-]\d{2}:?\d{2}))?$/.exec(
      v.trim(),
    );
  if (!m) return null;

  const [, yy, mm, dd, hh, mi, ss, sub = '', tz] = m;
  const ms = sub ? Number(sub.padEnd(3, '0').slice(0, 3)) : 0;
  return { yy, mm, dd, hh, mi, ss, ms, tz: tz ?? null };
}

function pickOffset(data: any, keys: string[]): string | null {
  for (const key of keys) {
    const normalized = normalizeOffset(data?.[key]);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeOffset(v: unknown): string | null {
  if (v == null) return null;

  if (Array.isArray(v) && v.length) {
    return normalizeOffset(v[0]);
  }

  if (typeof v === 'number' && Number.isFinite(v)) {
    const sign = v >= 0 ? '+' : '-';
    const abs = Math.abs(v);
    const hh = String(Math.trunc(abs)).padStart(2, '0');
    const mm = String(Math.round((abs % 1) * 60)).padStart(2, '0');
    return `${sign}${hh}:${mm}`;
  }

  if (typeof v !== 'string') return null;
  const t = v.trim().toUpperCase();
  if (!t) return null;
  if (t === 'Z' || t === '+00:00' || t === '-00:00') return 'Z';

  const m = /^([+\-])(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (!m) return null;
  const [, sign, hhRaw, mmRaw = '00'] = m;
  const hh = String(Number(hhRaw)).padStart(2, '0');
  const mm = String(Number(mmRaw)).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
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
