import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('reuses the CSRF bootstrap across a bulk import and preserves each command key', async () => {
  vi.stubGlobal('window', { location: { origin: 'https://bid.mbfdhub.com' } });
  let bootstraps = 0;
  const writes: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf') {
        bootstraps++;
        return new Response(
          JSON.stringify(
            bootstraps > 5
              ? { error: 'rate_limited' }
              : { token: 'csrf_123e4567-e89b-12d3-a456-426614174000' },
          ),
          {
            status: bootstraps > 5 ? 429 : 200,
          },
        );
      }
      writes.push(init ?? {});
      return new Response(JSON.stringify({ processed: 20 }));
    }),
  );
  const { annualPost } = await import('../../app/admin/annual-plan/annual-plan-client');
  for (let group = 0; group < 10; group++) {
    await expect(
      annualPost(
        'targetsolutions/imports/reviewed/apply',
        {
          safe: true,
          reason: 'Reviewed source credentials',
        },
        `group-${group}`,
      ),
    ).resolves.toEqual({ processed: 20 });
  }
  expect(bootstraps).toBe(1);
  expect(writes).toHaveLength(10);
  expect(writes.map((write) => new Headers(write.headers).get('Idempotency-Key'))).toEqual(
    Array.from({ length: 10 }, (_, i) => `group-${i}`),
  );
  expect(writes.every((write) => new Headers(write.headers).has('X-MBFD-CSRF'))).toBe(true);
});
