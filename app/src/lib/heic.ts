export function isHeicMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  const m = mimeType.toLowerCase();
  return (
    m === 'image/heic' ||
    m === 'image/heif' ||
    m === 'image/heic-sequence' ||
    m === 'image/heif-sequence'
  );
}

let cachedConvert: ((opts: {
  buffer: Buffer | Uint8Array;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<Buffer | Uint8Array>) | undefined;

async function loadHeicConvert(): Promise<(opts: {
  buffer: Buffer | Uint8Array;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<Buffer | Uint8Array>> {
  if (cachedConvert) return cachedConvert;
  const mod = (await import('heic-convert')) as any;
  cachedConvert = (mod.default ?? mod) as (opts: {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }) => Promise<Buffer | Uint8Array>;
  return cachedConvert;
}

export async function convertHeicToJpegBuffer(
  input: Buffer | Uint8Array,
  quality = 0.9,
): Promise<Buffer> {
  const convert = await loadHeicConvert();
  const out = await convert({
    buffer: input,
    format: 'JPEG',
    quality,
  });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
