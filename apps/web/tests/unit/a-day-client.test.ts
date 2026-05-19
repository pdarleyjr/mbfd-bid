import { describe, expect, it, vi } from 'vitest';
import {
  aDayCandidatesForShift,
  classifyADayEvent,
  fetchADayState,
  newIdempotencyKey,
  submitADayPickViaRest,
} from '../../lib/a-day-client';

describe('newIdempotencyKey', () => {
  it('returns an RFC-4122 v4 UUID', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns a unique value each call', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
  });
});

describe('aDayCandidatesForShift', () => {
  it('returns combat groups for A/B/C', () => {
    expect(aDayCandidatesForShift('A')).toEqual(['G1', 'G2', 'G3', 'G4']);
    expect(aDayCandidatesForShift('B')).toEqual(['G1', 'G2', 'G3', 'G4']);
    expect(aDayCandidatesForShift('C')).toEqual(['G1', 'G2', 'G3', 'G4']);
  });
  it('returns weekdays for D', () => {
    expect(aDayCandidatesForShift('D')).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  });
});

describe('classifyADayEvent', () => {
  it('parses an a_day_pick_made envelope', () => {
    const result = classifyADayEvent({
      type: 'a_day_pick_made',
      payload: {
        v: 1,
        seq: 41,
        memberId: 123,
        shift: 'A',
        aDay: 'G2',
        pickedAtMs: 1717000000000,
        forced: false,
        adminActorId: null,
        nextMemberId: 124,
        meters: { groups: [], weekdays: [] },
      },
    });
    expect(result).not.toBeNull();
    if (result) expect(result.type).toBe('a_day_pick_made');
  });

  it('parses a phase_changed envelope', () => {
    const result = classifyADayEvent({
      type: 'phase_changed',
      payload: { v: 1, from: 'a_day_bid', to: 'complete' },
    });
    expect(result).not.toBeNull();
    if (result) expect(result.type).toBe('phase_changed');
  });

  it('returns null for non-A-Day events', () => {
    const result = classifyADayEvent({ type: 'pick_made', payload: {} });
    expect(result).toBeNull();
  });

  it('returns null for malformed payloads', () => {
    const result = classifyADayEvent({
      type: 'a_day_pick_made',
      payload: { wrong: 'shape' },
    });
    expect(result).toBeNull();
  });
});

describe('fetchADayState', () => {
  it('GETs the snapshot endpoint with bearer auth', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        currentPhase: 'a_day_bid',
        isMyTurn: true,
        shift: 'A',
        eligibleADays: ['G1', 'G2'],
        meters: { groups: [], weekdays: [] },
      }),
    } as Response);
    const state = await fetchADayState('sess-1', 'jwt-token', fakeFetch as never);
    expect(fakeFetch).toHaveBeenCalledWith(
      '/api/bid/a-day-state?session=sess-1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer jwt-token' },
      }),
    );
    expect(state.currentPhase).toBe('a_day_bid');
    expect(state.isMyTurn).toBe(true);
  });

  it('throws on non-2xx', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);
    await expect(fetchADayState('sess-1', 'jwt', fakeFetch as never)).rejects.toThrow(/401/);
  });
});

describe('submitADayPickViaRest', () => {
  it('POSTs the request body and returns the status+body', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ kind: 'accepted', pick: { memberId: 1, shift: 'A', aDay: 'G1' } }),
    } as Response);
    const result = await submitADayPickViaRest(
      {
        v: 1,
        bidSessionId: 'sess-1',
        aDay: 'G1',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      },
      'jwt',
      fakeFetch as never,
    );
    expect(result.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalledWith(
      '/api/bid/a-day-pick',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
