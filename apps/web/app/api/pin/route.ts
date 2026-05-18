import { cfEnv } from '@/lib/cf-env';
import { PIN_COOKIE_NAME, PIN_COOKIE_OPTS } from '@/lib/cookies';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'edge';

const Body = z.object({ pin: z.string().min(4).max(8) });

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const expected = cfEnv('PIN_PLAIN') ?? '2300';
  const ok = parsed.data.pin === expected;
  if (!ok) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 401 });
  }

  const c = await cookies();
  c.set(PIN_COOKIE_NAME, 'ok', PIN_COOKIE_OPTS);
  return new NextResponse(null, { status: 204 });
}
