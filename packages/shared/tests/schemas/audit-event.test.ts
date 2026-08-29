import { describe, expect, it } from 'vitest';

import { AuditEventSchema } from '../../src/schemas/audit-event.js';

describe('AuditEventSchema', () => {
  it('accepts a minimal pick event', () => {
    const e = AuditEventSchema.parse({
      seq: 1,
      bid_session_id: '01HF3',
      action: 'pick',
      actor_type: 'member',
      actor_id: 42,
      target_kind: 'position',
      target_id: 'A101',
      created_at: '2026-09-22T14:23:00Z',
    });
    expect(e.seq).toBe(1);
  });

  it('rejects unknown action', () => {
    expect(() =>
      AuditEventSchema.parse({
        seq: 1,
        bid_session_id: 'x',
        action: 'BOGUS',
        actor_type: 'member',
        actor_id: 1,
        created_at: '2026-09-22T14:23:00Z',
      }),
    ).toThrow();
  });

  it('rejects non-integer seq', () => {
    expect(() =>
      AuditEventSchema.parse({
        seq: 1.5,
        bid_session_id: 'x',
        action: 'pick',
        actor_type: 'member',
        actor_id: 1,
        created_at: '2026-09-22T14:23:00Z',
      }),
    ).toThrow();
  });

  it('accepts Plan 07 a_day_pick + forced_a_day_pick + dissent', () => {
    for (const action of ['a_day_pick', 'forced_a_day_pick', 'dissent'] as const) {
      expect(() =>
        AuditEventSchema.parse({
          seq: 1,
          bid_session_id: 'x',
          action,
          actor_type: 'member',
          actor_id: 1,
          created_at: '2026-09-22T14:23:00Z',
        }),
      ).not.toThrow();
    }
  });

  it('accepts qualification lifecycle evidence audit events', () => {
    expect(() =>
      AuditEventSchema.parse({
        seq: 1,
        bid_session_id: 'x',
        action: 'qualification_lifecycle',
        actor_type: 'admin',
        actor_id: 1,
        target_kind: 'credential',
        target_id: '1:10',
        created_at: '2026-09-22T14:23:00Z',
      }),
    ).not.toThrow();
  });
});
