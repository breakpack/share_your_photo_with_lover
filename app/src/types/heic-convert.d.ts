declare module 'heic-convert' {
  export interface HeicConvertOptions {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }

  function convert(options: HeicConvertOptions): Promise<Buffer | Uint8Array>;

  export default convert;
}
