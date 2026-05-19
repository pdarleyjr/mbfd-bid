import { describe, expect, it } from 'vitest';

import { type BuildArgs, buildPortalPayload } from '../../src/portal-writeback/payload-builder.js';

const baseArgs: BuildArgs = {
  bid: {
    id: 'bid_01HF3_42_A109',
    bidSessionId: '01HF3',
    memberId: 42,
    positionId: 'A109',
    aDay: null,
    pickedAt: new Date('2026-09-22T18:23:00Z'),
    forced: false,
    adminActorId: null,
  },
  member: { id: 42, employeeId: '14523', rank: 'LT' },
  adminActor: null,
  position: { id: 'A109', shift: 'A', station: '1', unit: 'Rescue 1' },
  bidYear: 2026,
};

describe('buildPortalPayload (Plan 08 Task 18)', () => {
  it('produces payload matching spec §11.8.3', () => {
    const p = buildPortalPayload(baseArgs);
    expect(p).toEqual({
      bid_year: 2026,
      bid_session_id: '01HF3',
      rank_label: 'Lieutenant',
      station_label: 'Station 1',
      shift_label: 'A Shift',
      unit_label: 'Rescue 1',
      a_day_label: 'Pending Phase 2',
      position_id: 'A109',
      picked_at: '2026-09-22T18:23:00.000Z',
      idempotency_key: 'bid_01HF3_42_A109',
      is_forced: false,
      admin_actor_employee_id: null,
    });
  });

  it('translates a_day group code → label', () => {
    const p = buildPortalPayload({ ...baseArgs, bid: { ...baseArgs.bid, aDay: 'G4' } });
    expect(p.a_day_label).toBe('Group 4');
  });

  it('translates D-shift weekday code → label', () => {
    const p = buildPortalPayload({
      ...baseArgs,
      bid: { ...baseArgs.bid, aDay: 'FRI' },
      position: { ...baseArgs.position, shift: 'D' },
    });
    expect(p.a_day_label).toBe('Friday');
    expect(p.shift_label).toBe('D Shift');
  });

  it('sets admin_actor_employee_id when admin bid for member', () => {
    const p = buildPortalPayload({
      ...baseArgs,
      bid: { ...baseArgs.bid, adminActorId: 1, forced: true },
      adminActor: { id: 1, employeeId: '12345' },
    });
    expect(p.admin_actor_employee_id).toBe('12345');
    expect(p.is_forced).toBe(true);
  });

  it('passes through unknown a_day code unchanged', () => {
    const p = buildPortalPayload({ ...baseArgs, bid: { ...baseArgs.bid, aDay: 'CUSTOM' } });
    expect(p.a_day_label).toBe('CUSTOM');
  });

  it('throws on unknown rank code', () => {
    expect(() =>
      buildPortalPayload({
        ...baseArgs,
        member: { ...baseArgs.member, rank: 'BOGUS' as never },
      }),
    ).toThrow(/rank/);
  });
});
