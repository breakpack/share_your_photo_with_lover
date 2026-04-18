import { NextRequest, NextResponse } from 'next/server';
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
  const sort = url.searchParams.get('sort') || 'time-desc';
  const tagParam = url.searchParams.get('tags') || '';
  const tagNames = tagParam.split(',').map((s) => s.trim()).filter(Boolean);

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
      : sort === 'taken-desc'
        ? [
            { takenAt: { sort: 'desc' as const, nulls: 'last' as const } },
            { createdAt: 'desc' as const },
          ]
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

  // Over-fetch by one to detect hasMore without a COUNT(*).
  const rows = await prisma.photo.findMany({
    where,
    orderBy,
    skip: offset,
    take: limit + 1,
    include: {
      tags: { include: { tag: true } },
      views: {
        where: { viewerName: user },
        select: { viewerName: true },
        take: 1,
      },
    },
  });

  const hasMore = rows.length > limit;
  const photos = (hasMore ? rows.slice(0, limit) : rows).map((row) =>
    serializePhoto({
      ...row,
      unseen: row.ownerName !== user && row.views.length === 0,
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
