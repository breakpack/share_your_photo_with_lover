import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Only return tags attached to photos the user can see.
  const tags = await prisma.tag.findMany({
    where: {
      photos: {
        some: {},
      },
    },
    orderBy: { name: 'asc' },
    include: { _count: { select: { photos: true } } },
  });

  return NextResponse.json({
    tags: tags.map((t) => ({ id: t.id, name: t.name, count: t._count.photos })),
  });
}

export async function POST(req: NextRequest) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const tag = await prisma.tag.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  return NextResponse.json({ id: tag.id, name: tag.name });
}
