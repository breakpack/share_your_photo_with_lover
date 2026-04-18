import { NextRequest, NextResponse } from 'next/server';
import { authenticate, createSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!authenticate(name, password)) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }
  createSession(name);
  return NextResponse.json({ name });
}
