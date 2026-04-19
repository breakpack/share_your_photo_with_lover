import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { serializePhoto } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const GIFT_PREVIEW_COUNT = 5;

export async function GET(req: NextRequest) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') || 'source-created-desc';
  const includeTagNames = parseTagList(url.searchParams.get('tags') || '');
  const excludeTagNames = parseTagList(url.searchParams.get('excludeTags') || '').filter(
    (name) => !includeTagNames.includes(name),
  );
  const sourceCreatedSort = sort === 'source-created-desc' || sort === 'taken-desc';
  const cursor = parseSourceCreatedCursor(url.searchParams.get('cursor'));

  const limit = clamp(
    parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) ||
      DEFAULT_LIMIT,
    1,
    MAX_LIMIT,
  );
  const offset = Math.max(
    0,
    parseInt(url.searchParams.get('offset') || '0', 10) || 0,
  );

  const orderBy: any =
    sort === 'time-asc'
      ? { createdAt: 'asc' as const }
      : sourceCreatedSort
        ? undefined
        : sort === 'size-desc'
          ? { sizeBytes: 'desc' as const }
          : sort === 'size-asc'
            ? { sizeBytes: 'asc' as const }
            : { createdAt: 'desc' as const };

  const where: any = {};

  const andClauses: any[] = [
    {
      OR: [{ giftBoxId: null }, { giftBox: { openedAt: { not: null } } }],
    },
  ];
  if (includeTagNames.length) {
    andClauses.push(
      ...includeTagNames.map((name) => ({
        tags: { some: { tag: { name } } },
      })),
    );
  }
  if (excludeTagNames.length) {
    andClauses.push({
      tags: {
        none: {
          tag: {
            name: { in: excludeTagNames },
          },
        },
      },
    });
  }
  where.AND = andClauses;

  const photoSelect = photoListSelect(user);

  // For source-created sort, use COALESCE(sourceCreatedAt, createdAt) so rows
  // without source creation date still sort by upload time.
  const rows =
    sourceCreatedSort
      ? await findManySourceCreatedDesc({
          includeTagNames,
          excludeTagNames,
          cursor,
          take: limit + 1,
          photoSelect,
        })
      : await prisma.photo.findMany({
          where,
          orderBy,
          skip: offset,
          take: limit + 1,
          select: photoSelect,
        });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const photos = pageRows.map((row) =>
    serializePhoto({
      ...row,
      unseen: row.ownerName !== user && row.views.length === 0,
      lastViewedAt: row.views[0]?.viewedAt ?? null,
    }),
  );
  const nextCursor =
    sourceCreatedSort && hasMore && pageRows.length
      ? encodeSourceCreatedCursor(pageRows[pageRows.length - 1])
      : null;

  const isFirstPage = sourceCreatedSort ? cursor == null : offset === 0;
  const giftBoxes = isFirstPage
    ? await findUnopenedGiftBoxes({ includeTagNames, excludeTagNames })
    : [];

  return NextResponse.json({
    photos,
    giftBoxes,
    currentUser: user,
    hasMore,
    nextOffset: sourceCreatedSort ? null : offset + photos.length,
    nextCursor,
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function photoListSelect(viewerName: string) {
  return {
    id: true,
    filename: true,
    mimeType: true,
    sizeBytes: true,
    width: true,
    height: true,
    hidden: true,
    blurred: true,
    caption: true,
    takenAt: true,
    sourceCreatedAt: true,
    sourceModifiedAt: true,
    gpsLat: true,
    gpsLng: true,
    cameraMake: true,
    cameraModel: true,
    artist: true,
    ownerName: true,
    giftBoxId: true,
    createdAt: true,
    tags: { select: { tag: { select: { id: true, name: true } } } },
    views: {
      where: { viewerName },
      select: { viewedAt: true },
      take: 1,
    },
  } satisfies Prisma.PhotoSelect;
}

type PhotoListRow = Prisma.PhotoGetPayload<{
  select: ReturnType<typeof photoListSelect>;
}>;

async function findManySourceCreatedDesc({
  includeTagNames,
  excludeTagNames,
  cursor,
  take,
  photoSelect,
}: {
  includeTagNames: string[];
  excludeTagNames: string[];
  cursor: SourceCreatedCursor | null;
  take: number;
  photoSelect: ReturnType<typeof photoListSelect>;
}) {
  const excludePredicate = excludeTagNames.length
    ? Prisma.sql`
        NOT EXISTS (
          SELECT 1
          FROM "TagOnPhoto" xtp
          JOIN "Tag" xt ON xt.id = xtp."tagId"
          WHERE xtp."photoId" = p.id
            AND xt.name IN (${Prisma.join(excludeTagNames)})
        )
      `
    : Prisma.sql`TRUE`;

  const visiblePredicate = Prisma.sql`
    (
      p."giftBoxId" IS NULL
      OR EXISTS (
        SELECT 1
        FROM "GiftBox" gb0
        WHERE gb0.id = p."giftBoxId"
          AND gb0."openedAt" IS NOT NULL
      )
    )
  `;

  const baseQuery =
    includeTagNames.length === 0
      ? Prisma.sql`
          SELECT p.id AS id,
                 COALESCE(p."sourceCreatedAt", p."createdAt") AS sort_key,
                 p."createdAt" AS created_at
          FROM "Photo" p
          WHERE ${visiblePredicate}
            AND ${excludePredicate}
        `
      : Prisma.sql`
          SELECT p.id AS id,
                 COALESCE(p."sourceCreatedAt", p."createdAt") AS sort_key,
                 p."createdAt" AS created_at
          FROM "Photo" p
          JOIN "TagOnPhoto" tp ON tp."photoId" = p.id
          JOIN "Tag" t ON t.id = tp."tagId"
          WHERE t.name IN (${Prisma.join(includeTagNames)})
            AND ${visiblePredicate}
            AND ${excludePredicate}
          GROUP BY p.id, p."sourceCreatedAt", p."createdAt"
          HAVING COUNT(DISTINCT t.name) = ${includeTagNames.length}
        `;

  const cursorPredicate = cursor
    ? Prisma.sql`
        (
          s.sort_key < ${cursor.sortKey}
          OR (
            s.sort_key = ${cursor.sortKey}
            AND (
              s.created_at < ${cursor.createdAt}
              OR (s.created_at = ${cursor.createdAt} AND s.id < ${cursor.id})
            )
          )
        )
      `
    : Prisma.sql`TRUE`;

  const idsQuery = Prisma.sql`
    SELECT s.id
    FROM (${baseQuery}) s
    WHERE ${cursorPredicate}
    ORDER BY s.sort_key DESC, s.created_at DESC, s.id DESC
    LIMIT ${take}
  `;

  const idRows = await prisma.$queryRaw<{ id: string }[]>(idsQuery);
  const orderedIds = idRows.map((r) => r.id);
  if (orderedIds.length === 0) return [];

  const loaded = await prisma.photo.findMany({
    where: { id: { in: orderedIds } },
    select: photoSelect,
  });

  const byId = new Map(loaded.map((p) => [p.id, p]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is PhotoListRow => Boolean(p));
}

async function findUnopenedGiftBoxes({
  includeTagNames,
  excludeTagNames,
}: {
  includeTagNames: string[];
  excludeTagNames: string[];
}) {
  const andClauses: any[] = [];
  if (includeTagNames.length) {
    andClauses.push(
      ...includeTagNames.map((name) => ({
        photos: {
          some: {
            tags: {
              some: {
                tag: { name },
              },
            },
          },
        },
      })),
    );
  }
  if (excludeTagNames.length) {
    andClauses.push({
      photos: {
        none: {
          tags: {
            some: {
              tag: {
                name: { in: excludeTagNames },
              },
            },
          },
        },
      },
    });
  }

  const gifts = await prisma.giftBox.findMany({
    where: {
      openedAt: null,
      photos: { some: {} },
      AND: andClauses,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { photos: true } },
      photos: {
        select: { id: true },
        orderBy: [{ giftOrder: 'asc' }, { createdAt: 'asc' }],
        take: GIFT_PREVIEW_COUNT,
      },
    },
  });

  return gifts.map((g) => ({
    id: g.id,
    ownerName: g.ownerName,
    createdAt: g.createdAt,
    photoCount: g._count.photos,
    previewPhotoIds: g.photos.map((p) => p.id),
  }));
}

type SourceCreatedCursor = {
  sortKey: Date;
  createdAt: Date;
  id: string;
};

function parseSourceCreatedCursor(raw: string | null): SourceCreatedCursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as { s?: string; c?: string; i?: string };
    if (!parsed?.s || !parsed?.c || !parsed?.i) return null;
    const sortKey = new Date(parsed.s);
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(sortKey.getTime()) || Number.isNaN(createdAt.getTime())) return null;
    return { sortKey, createdAt, id: parsed.i };
  } catch {
    return null;
  }
}

function encodeSourceCreatedCursor(row: { sourceCreatedAt: Date | null; createdAt: Date; id: string }) {
  const payload = JSON.stringify({
    s: (row.sourceCreatedAt ?? row.createdAt).toISOString(),
    c: row.createdAt.toISOString(),
    i: row.id,
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function parseTagList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}
