#!/bin/sh
set -e

echo "[entrypoint] running prisma db push..."
npx --no-install prisma db push --skip-generate --accept-data-loss=false

echo "[entrypoint] ensuring source-created sort index..."
if ! node <<'NODE'
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Photo_source_created_sort_idx"
    ON "Photo" ((COALESCE("sourceCreatedAt", "createdAt")) DESC, "createdAt" DESC, id DESC)
  `);
  console.log('[index] ensured Photo_source_created_sort_idx');
}

main()
  .catch((err) => {
    console.error('[index] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
NODE
then
  echo "[entrypoint] source-created sort index ensure failed; continuing startup"
fi

echo "[entrypoint] backfilling duplicate-filename tag..."
if ! node <<'NODE'
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DUP_TAG = '중복파일';

async function main() {
  const duplicateRows = await prisma.$queryRaw`
    SELECT p.id
    FROM "Photo" p
    JOIN (
      SELECT p2."filename"
      FROM "Photo" p2
      GROUP BY p2."filename"
      HAVING COUNT(*) > 1
    ) d ON d."filename" = p."filename"
  `;

  if (!Array.isArray(duplicateRows) || duplicateRows.length === 0) {
    console.log('[backfill] no duplicate filenames found');
    return;
  }

  const tag = await prisma.tag.upsert({
    where: { name: DUP_TAG },
    update: {},
    create: { name: DUP_TAG },
  });

  const result = await prisma.tagOnPhoto.createMany({
    data: duplicateRows.map((r) => ({ photoId: r.id, tagId: tag.id })),
    skipDuplicates: true,
  });

  console.log(
    `[backfill] duplicate rows=${duplicateRows.length}, inserted=${result.count}`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
NODE
then
  echo "[entrypoint] duplicate-filename backfill failed; continuing startup"
fi

echo "[entrypoint] ensuring storage dirs..."
mkdir -p "${PHOTO_STORAGE_DIR:-/data/photos}/originals" "${PHOTO_STORAGE_DIR:-/data/photos}/thumbs"

echo "[entrypoint] starting app: $*"
exec "$@"
