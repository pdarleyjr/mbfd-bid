import { describe, expect, it } from 'vitest';
import { guardNormalBidMutation } from '../../src/lib/specialty-interruption-guard.js';
import type { WorkerEnv } from '../../src/types/env.js';

function specialtyNamespace(
  fetchResponse: () => Response | Promise<Response>,
): WorkerEnv['BID_SESSION'] {
  const stub = { fetch: fetchResponse };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
  } as unknown as WorkerEnv['BID_SESSION'];
}

describe('guardNormalBidMutation', () => {
  it('allows a normal mutation only when the synthetic specialty status explicitly reports inactive', async () => {
    let requestedUrl = '';
    const result = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace((input?: Request | string) => {
          requestedUrl = typeof input === 'string' ? input : (input?.url ?? '');
          return new Response(JSON.stringify({ state: { active: null } }), { status: 200 });
        }),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(result).toEqual({ ok: true });
    expect(requestedUrl).toBe('https://do/admin/specialty-adjudication');
  });

  it('blocks a normal mutation while a synthetic specialty interruption is active', async () => {
    const result = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace(
          () =>
            new Response(
              JSON.stringify({ state: { active: { requestId: 'synthetic-request' } } }),
              {
                status: 200,
              },
            ),
        ),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(result).toEqual({ ok: false, error: 'specialty_adjudication_active' });
  });

  it('fails closed when the specialty status cannot be read or is malformed', async () => {
    const unavailable = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace(() => new Response('unavailable', { status: 503 })),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );
    const malformed = await guardNormalBidMutation(
      {
        BID_SESSION: specialtyNamespace(
          () => new Response(JSON.stringify({ state: {} }), { status: 200 }),
        ),
      },
      '01HZZ0000000000000SPECREHEARSE',
    );

    expect(unavailable).toEqual({ ok: false, error: 'specialty_adjudication_state_unavailable' });
    expect(malformed).toEqual({ ok: false, error: 'specialty_adjudication_state_unavailable' });
  });
});
