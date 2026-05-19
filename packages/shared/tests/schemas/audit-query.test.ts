import { describe, expect, it } from 'vitest';
import { AuditQuerySchema } from '../../src/schemas/audit-query.js';

describe('AuditQuerySchema', () => {
  it('defaults limit to 50 and offset to 0', () => {
    const ok = AuditQuerySchema.parse({});
    expect(ok.limit).toBe(50);
    expect(ok.offset).toBe(0);
  });

  it('caps limit at 500', () => {
    expect(() => AuditQuerySchema.parse({ limit: '9999' })).toThrow();
  });

  it('coerces string limit/offset to numbers', () => {
    const ok = AuditQuerySchema.parse({ limit: '100', offset: '200' });
    expect(ok.limit).toBe(100);
    expect(ok.offset).toBe(200);
  });

  it('accepts ISO datetime for from/to', () => {
    const ok = AuditQuerySchema.parse({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.000Z',
    });
    expect(ok.from).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects from > to', () => {
    expect(() =>
      AuditQuerySchema.parse({
        from: '2026-12-31T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts action filter', () => {
    const ok = AuditQuerySchema.parse({ action: 'forced_pick' });
    expect(ok.action).toBe('forced_pick');
  });

  it('rejects unknown action filter', () => {
    expect(() => AuditQuerySchema.parse({ action: 'sandwich' })).toThrow();
  });
});
