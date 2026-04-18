import path from 'node:path';
import fs from 'node:fs/promises';

export const STORAGE_DIR = process.env.PHOTO_STORAGE_DIR || path.join(process.cwd(), 'photos');
export const ORIGINALS_DIR = path.join(STORAGE_DIR, 'originals');
export const THUMBS_DIR = path.join(STORAGE_DIR, 'thumbs');

export async function ensureStorage() {
  await fs.mkdir(ORIGINALS_DIR, { recursive: true });
  await fs.mkdir(THUMBS_DIR, { recursive: true });
}

export function originalPath(id: string) {
  return path.join(ORIGINALS_DIR, id);
}

export function thumbPath(id: string) {
  return path.join(THUMBS_DIR, `${id}.jpg`);
}
