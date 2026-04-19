import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { serializePhoto } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') || 'source-created-desc';
  const tagParam = url.searchParams.get('tags') || '';
  const tagNames = tagParam.split(',').map((s) => s.trim()).filter(Boolean);
  const sourceCreatedSort = sort === 'source-created-desc' || sort === 'taken-desc';

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

  if (tagNames.length) {
    where.AND = tagNames.map((name) => ({
      tags: { some: { tag: { name } } },
    }));
  }

  // For source-created sort, use COALESCE(sourceCreatedAt, createdAt) so rows
  // without source creation date still sort by upload time.
  const rows =
    sourceCreatedSort
      ? await findManySourceCreatedDesc({
          tagNames,
          offset,
          take: limit + 1,
          viewerName: user,
        })
      : await prisma.photo.findMany({
          where,
          orderBy,
          skip: offset,
          take: limit + 1,
          include: {
            tags: { include: { tag: true } },
            views: {
              where: { viewerName: user },
              select: { viewedAt: true },
              take: 1,
            },
          },
        });

  const hasMore = rows.length > limit;
  const photos = (hasMore ? rows.slice(0, limit) : rows).map((row) =>
    serializePhoto({
      ...row,
      unseen: row.ownerName !== user && row.views.length === 0,
      lastViewedAt: row.views[0]?.viewedAt ?? null,
    }),
  );

  return NextResponse.json({
    photos,
    currentUser: user,
    hasMore,
    nextOffset: offset + photos.length,
  });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function findManySourceCreatedDesc({
  tagNames,
  offset,
  take,
  viewerName,
}: {
  tagNames: string[];
  offset: number;
  take: number;
  viewerName: string;
}) {
  const idsQuery =
    tagNames.length === 0
      ? Prisma.sql`
          SELECT p.id
          FROM "Photo" p
          ORDER BY COALESCE(p."sourceCreatedAt", p."createdAt") DESC, p."createdAt" DESC, p.id DESC
          OFFSET ${offset}
          LIMIT ${take}
        `
      : Prisma.sql`
          SELECT p.id
          FROM "Photo" p
          JOIN "TagOnPhoto" tp ON tp."photoId" = p.id
          JOIN "Tag" t ON t.id = tp."tagId"
          WHERE t.name IN (${Prisma.join(tagNames)})
          GROUP BY p.id, p."sourceCreatedAt", p."createdAt"
          HAVING COUNT(DISTINCT t.name) = ${tagNames.length}
          ORDER BY COALESCE(p."sourceCreatedAt", p."createdAt") DESC, p."createdAt" DESC, p.id DESC
          OFFSET ${offset}
          LIMIT ${take}
        `;

  const idRows = await prisma.$queryRaw<{ id: string }[]>(idsQuery);
  const orderedIds = idRows.map((r) => r.id);
  if (orderedIds.length === 0) return [];

  const loaded = await prisma.photo.findMany({
    where: { id: { in: orderedIds } },
    include: {
      tags: { include: { tag: true } },
      views: {
        where: { viewerName },
        select: { viewedAt: true },
        take: 1,
      },
    },
  });

  const byId = new Map(loaded.map((p) => [p.id, p]));
  return orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
}
