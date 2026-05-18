import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyCredentials } from '../../src/lib/portal-client';

const ORIG_FETCH = globalThis.fetch;

describe('verifyCredentials', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it('returns the portal payload on 200', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          member_id: 555,
          employee_id: '20731',
          first_name: 'Peter',
          last_name: 'Darley',
          rank: 'LT',
          role: 'member',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await verifyCredentials({
      portalBaseUrl: 'https://portal.test',
      token: 'tok',
      employee_id: '20731',
      password: 'pw',
    });
    expect(result?.member_id).toBe(555);
  });

  it('returns null on 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    const result = await verifyCredentials({
      portalBaseUrl: 'https://portal.test',
      token: 'tok',
      employee_id: 'x',
      password: 'y',
    });
    expect(result).toBeNull();
  });

  it('throws on 5xx', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('boom', { status: 502 }),
    );
    await expect(
      verifyCredentials({
        portalBaseUrl: 'https://portal.test',
        token: 'tok',
        employee_id: 'x',
        password: 'y',
      }),
    ).rejects.toThrow(/portal_unavailable/);
  });
});
