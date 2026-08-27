import { PIN_COOKIE_NAME, PIN_COOKIE_OPTS } from '@/lib/cookies';
import { getWorkerBase } from '@/lib/worker-base';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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

/**
 * PIN gate proxy. Sends the candidate PIN to the Worker's KV-backed verifier
 * (`POST /api/auth/verify-pin`), then sets the gate cookie on success. The
 * Worker holds the source-of-truth value — both the staging bid admin UI and
 * the MBFD Hub Filament admin write to the same KV key, so a change in either
 * surface takes effect immediately for the next PIN entry.
 */
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

  let upstream: Response;
  try {
    upstream = await fetch(`${getWorkerBase()}/api/auth/verify-pin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Forward client IP so the Worker's per-IP rate-limiter is accurate.
        'cf-connecting-ip': clientKey(req),
      },
      body: JSON.stringify({ pin: parsed.data.pin }),
    });
  } catch (err) {
    console.error('[api.pin] worker fetch failed', err);
    return NextResponse.json({ error: 'misconfigured' }, { status: 503 });
  }

  if (upstream.status === 204) {
    attempts.delete(clientKey(req));
    const c = await cookies();
    c.set(PIN_COOKIE_NAME, 'ok', PIN_COOKIE_OPTS);
    return new NextResponse(null, { status: 204 });
  }
  if (upstream.status === 401) {
    return NextResponse.json({ error: 'invalid_pin' }, { status: 401 });
  }
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get('Retry-After') ?? '60';
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': retryAfter } },
    );
  }
  if (upstream.status === 503) {
    const body = (await upstream.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'PIN_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'PIN_NOT_CONFIGURED' }, { status: 503 });
    }
    return NextResponse.json({ error: 'misconfigured' }, { status: 503 });
  }
  return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
}
