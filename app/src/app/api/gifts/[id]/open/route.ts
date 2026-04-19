import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const gift = await prisma.giftBox.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, openedAt: true, _count: { select: { photos: true } } },
  });
  if (!gift) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (gift.openedAt) {
    return NextResponse.json({
      ok: true,
      opened: false,
      photoCount: gift._count.photos,
      alreadyOpened: true,
    });
  }

  await prisma.giftBox.updateMany({
    where: { id: gift.id, openedAt: null },
    data: {
      openedAt: new Date(),
      openedByName: user,
    },
  });

  return NextResponse.json({
    ok: true,
    opened: true,
    photoCount: gift._count.photos,
  });
}
