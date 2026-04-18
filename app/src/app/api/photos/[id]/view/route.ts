import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const photo = await prisma.photo.findUnique({ where: { id: ctx.params.id } });
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (photo.hidden && photo.ownerName !== user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (photo.ownerName === user) {
    return NextResponse.json({ ok: true, recorded: false });
  }

  await prisma.photoView.upsert({
    where: {
      photoId_viewerName: {
        photoId: photo.id,
        viewerName: user,
      },
    },
    update: { viewedAt: new Date() },
    create: {
      photoId: photo.id,
      viewerName: user,
    },
  });

  return NextResponse.json({ ok: true, recorded: true });
}
