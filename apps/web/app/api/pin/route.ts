import { cfEnv } from '@/lib/cf-env';
import { PIN_COOKIE_NAME, PIN_COOKIE_OPTS } from '@/lib/cookies';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'edge';

const Body = z.object({ pin: z.string().min(4).max(8) });
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function rateLimit(req: Request): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const key = clientKey(req);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true };
  }
  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    return { ok: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
  }
  return { ok: true };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function verifyPin(pin: string): Promise<boolean> {
  const expectedHash = cfEnv('PIN_HASH');
  if (expectedHash) {
    const normalized = expectedHash.startsWith('sha256:')
      ? expectedHash.slice('sha256:'.length)
      : expectedHash;
    return constantTimeEqual(await sha256Hex(pin), normalized.toLowerCase());
  }

  const expectedPlain = cfEnv('PIN_PLAIN');
  if (expectedPlain) return constantTimeEqual(pin, expectedPlain);
  throw new Error('PIN gate is not configured');
}

export async function POST(req: Request) {
  const limit = rateLimit(req);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  let ok = false;
  try {
    ok = await verifyPin(parsed.data.pin);
  } catch {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }
  if (!ok) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 401 });
  }

  attempts.delete(clientKey(req));
  const c = await cookies();
  c.set(PIN_COOKIE_NAME, 'ok', PIN_COOKIE_OPTS);
  return new NextResponse(null, { status: 204 });
}
