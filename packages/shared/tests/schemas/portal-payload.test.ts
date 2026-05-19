import { describe, expect, it } from 'vitest';

import { PortalPayloadSchema } from '../../src/schemas/portal-payload.js';

describe('PortalPayloadSchema (Plan 08 Task 18)', () => {
  it('accepts a minimal payload', () => {
    const p = PortalPayloadSchema.parse({
      bid_year: 2026,
      bid_session_id: '01HF3',
      rank_label: 'Lieutenant',
      station_label: 'Station 1',
      shift_label: 'A Shift',
      unit_label: 'Rescue 1',
      a_day_label: 'Pending Phase 2',
      position_id: 'A109',
      picked_at: '2026-09-22T14:23:00-04:00',
      idempotency_key: 'bid_01HF3_42_A109',
      is_forced: false,
      admin_actor_employee_id: null,
    });
    expect(p.position_id).toBe('A109');
  });

  it('rejects unknown shift label', () => {
    expect(() =>
      PortalPayloadSchema.parse({
        bid_year: 2026,
        bid_session_id: 'x',
        rank_label: 'Lieutenant',
        station_label: 'S',
        shift_label: 'Z Shift',
        unit_label: 'U',
        a_day_label: 'x',
        position_id: 'P',
        picked_at: '2026-09-22T14:23:00-04:00',
        idempotency_key: 'k',
        is_forced: false,
        admin_actor_employee_id: null,
      }),
    ).toThrow();
  });

  it('rejects non-integer bid_year', () => {
    expect(() =>
      PortalPayloadSchema.parse({
        bid_year: 2026.5,
        bid_session_id: 'x',
        rank_label: 'Lieutenant',
        station_label: 'S',
        shift_label: 'A Shift',
        unit_label: 'U',
        a_day_label: 'x',
        position_id: 'P',
        picked_at: 'x',
        idempotency_key: 'k',
        is_forced: false,
        admin_actor_employee_id: null,
      }),
    ).toThrow();
  });

  it('accepts an admin-forced pick with admin_actor_employee_id', () => {
    const p = PortalPayloadSchema.parse({
      bid_year: 2026,
      bid_session_id: '01HF3',
      rank_label: 'Captain',
      station_label: 'Station 4',
      shift_label: 'B Shift',
      unit_label: 'Engine 4',
      a_day_label: 'Group 2',
      position_id: 'B404',
      picked_at: '2026-09-22T14:23:00-04:00',
      idempotency_key: 'forced_bid_01HF3_88_B404',
      is_forced: true,
      admin_actor_employee_id: '12345',
    });
    expect(p.is_forced).toBe(true);
    expect(p.admin_actor_employee_id).toBe('12345');
  });
});
