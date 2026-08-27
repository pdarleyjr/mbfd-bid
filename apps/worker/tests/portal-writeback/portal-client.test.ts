import type { PortalPayload } from '@mbfd/shared';
import { describe, expect, it, vi } from 'vitest';

import { postBidAssignment } from '../../src/portal-writeback/portal-client.js';

const payload: PortalPayload = {
  bid_year: 2026,
  bid_session_id: '01HF3',
  rank_label: 'Lieutenant',
  station_label: 'Station 1',
  shift_label: 'A Shift',
  unit_label: 'Rescue 1',
  a_day_label: 'Pending Phase 2',
  position_id: 'A109',
  picked_at: '2026-09-22T18:23:00Z',
  idempotency_key: 'bid_x',
  is_forced: false,
  admin_actor_employee_id: null,
};

describe('postBidAssignment (Plan 08 Task 20)', () => {
  it('returns synced on 200', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ stored: true }), { status: 200 }),
    );
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: true,
      token: 't',
      fetchImpl,
    });
    expect(out.kind).toBe('synced');
  });

  it('returns synced on 409 (idempotency)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 409 }));
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: true,
      token: 't',
      fetchImpl,
    });
    expect(out.kind).toBe('synced');
  });

  it('returns transient on 500', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: true,
      token: 't',
      fetchImpl,
    });
    expect(out.kind).toBe('transient');
  });

  it('returns permanent on 400', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 400 }));
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: true,
      token: 't',
      fetchImpl,
    });
    expect(out.kind).toBe('permanent');
    if (out.kind === 'permanent') expect(out.message).toContain('400');
  });

  it('returns transient on network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENETUNREACH');
    });
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: true,
      token: 't',
      fetchImpl,
    });
    expect(out.kind).toBe('transient');
  });

  it('sends Authorization: Bearer token', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: true,
      token: 'SVC_TOKEN',
      fetchImpl,
    });
    const calls = fetchImpl.mock.calls as unknown as [[string, RequestInit]];
    const init = calls[0][1];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer SVC_TOKEN');
  });

  it('does not make a network request when publication is not explicitly enabled', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: false,
      token: 'SVC_TOKEN',
      fetchImpl,
    });

    expect(out.kind).toBe('permanent');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not make a network request without a writer credential', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal.mbfdhub.com',
      publicationEnabled: true,
      token: '',
      fetchImpl,
    });

    expect(out.kind).toBe('permanent');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not send credentials to a plain HTTP writeback endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const out = await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'http://portal-writeback.example',
      publicationEnabled: true,
      token: 'SVC_TOKEN',
      fetchImpl,
    });

    expect(out.kind).toBe('permanent');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('disallows redirects at the credentialed write boundary', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    await postBidAssignment({
      employeeId: '14523',
      payload,
      portalBaseUrl: 'https://portal-writeback.example',
      publicationEnabled: true,
      token: 'SVC_TOKEN',
      fetchImpl,
    });

    const calls = fetchImpl.mock.calls as unknown as [[string, RequestInit]];
    expect(calls[0][1].redirect).toBe('error');
  });
});
