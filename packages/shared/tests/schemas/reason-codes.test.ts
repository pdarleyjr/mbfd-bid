import { describe, expect, it } from 'vitest';
import { REASON_CODE_DESCRIPTIONS, ReasonCodeSchema } from '../../src/schemas/reason-codes.js';

describe('ReasonCodeSchema', () => {
  it('accepts a known force code', () => {
    expect(ReasonCodeSchema.parse('force.reverse_seniority')).toBe('force.reverse_seniority');
  });

  it('accepts a known skip code', () => {
    expect(ReasonCodeSchema.parse('skip.unreachable')).toBe('skip.unreachable');
  });

  it('rejects an unknown code', () => {
    expect(() => ReasonCodeSchema.parse('force.because_i_said_so')).toThrow();
  });

  it('every code has a non-empty description', () => {
    const codes = Object.keys(REASON_CODE_DESCRIPTIONS);
    expect(codes.length).toBeGreaterThan(8);
    for (const code of codes) {
      const desc = REASON_CODE_DESCRIPTIONS[code as keyof typeof REASON_CODE_DESCRIPTIONS];
      expect(desc).toBeTruthy();
      expect(desc.length).toBeGreaterThan(10);
    }
  });

  it('every enum value has a description (no gaps)', () => {
    const valid = [
      'force.reverse_seniority',
      'force.cert_mandate',
      'skip.unreachable',
      'skip.declined',
      'bid_for_member.unreachable_phone',
      'rule_override.fix_misconfig',
      'cert_override.late_correction',
      'lock_position.probationary_placement',
      'lock_position.swat_medic_placement',
      'session.day_end_scheduled',
      'session.pause_emergency',
    ] as const;
    for (const v of valid) {
      expect(REASON_CODE_DESCRIPTIONS).toHaveProperty(v);
    }
  });
});
