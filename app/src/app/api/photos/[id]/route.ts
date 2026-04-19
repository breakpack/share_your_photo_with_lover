import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { originalPath, thumbPath } from '@/lib/storage';
import { serializePhoto } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const photo = await prisma.photo.findUnique({
    where: { id: ctx.params.id },
    include: { giftBox: { select: { openedAt: true } } },
  });
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (photo.giftBoxId && !photo.giftBox?.openedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const isOwner = photo.ownerName === user;
  const data: any = {};
  const ownerOnly: string[] = [];

  // Owner-only fields
  if ('hidden' in body) {
    if (!isOwner) ownerOnly.push('hidden');
    else if (typeof body.hidden === 'boolean') data.hidden = body.hidden;
  }
  if ('caption' in body) {
    if (!isOwner) ownerOnly.push('caption');
    else {
      const c = typeof body.caption === 'string' ? body.caption.trim() : '';
      data.caption = c ? c : null;
    }
  }
  if ('tags' in body) {
    if (!isOwner) ownerOnly.push('tags');
  }

  // Anyone-can-edit fields
  if ('blurred' in body && typeof body.blurred === 'boolean') {
    if (photo.hidden) {
      return NextResponse.json(
        { error: 'blurred is locked while hidden=true' },
        { status: 400 },
      );
    }
    data.blurred = body.blurred;
  }

  if (ownerOnly.length) {
    return NextResponse.json(
      { error: `owner-only fields: ${ownerOnly.join(', ')}` },
      { status: 403 },
    );
  }

  // Tags: replace whole set (owner only, already gated)
  if (isOwner && Array.isArray(body.tags)) {
    const names: string[] = body.tags
      .map((t: any) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean);
    const tags = await Promise.all(
      names.map((name) => prisma.tag.upsert({ where: { name }, update: {}, create: { name } })),
    );
    await prisma.tagOnPhoto.deleteMany({ where: { photoId: photo.id } });
    if (tags.length) {
      await prisma.tagOnPhoto.createMany({
        data: tags.map((t) => ({ photoId: photo.id, tagId: t.id })),
      });
    }
  }

  const updated = await prisma.photo.update({
    where: { id: photo.id },
    data,
    include: {
      tags: { include: { tag: true } },
      views: {
        where: { viewerName: user },
        select: { viewedAt: true },
        take: 1,
      },
    },
  });

  return NextResponse.json(
    serializePhoto({
      ...updated,
      unseen: updated.ownerName !== user && updated.views.length === 0,
      lastViewedAt: updated.views[0]?.viewedAt ?? null,
    }),
  );
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const user = getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const photo = await prisma.photo.findUnique({
    where: { id: ctx.params.id },
    include: { giftBox: { select: { openedAt: true } } },
  });
  if (!photo) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (photo.giftBoxId && !photo.giftBox?.openedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (photo.ownerName !== user) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await prisma.photo.delete({ where: { id: photo.id } });
  await Promise.allSettled([
    fs.unlink(originalPath(photo.id)),
    fs.unlink(thumbPath(photo.id)),
  ]);
  return NextResponse.json({ ok: true });
}
