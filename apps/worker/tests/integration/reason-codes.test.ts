import { describe, expect, it } from 'vitest';
import { isReasonValidForAction } from '../../src/lib/reason-codes.js';

describe('isReasonValidForAction', () => {
  it('forced_pick accepts force.reverse_seniority', () => {
    expect(isReasonValidForAction('forced_pick', 'force.reverse_seniority')).toBe(true);
  });

  it('forced_pick accepts force.cert_mandate', () => {
    expect(isReasonValidForAction('forced_pick', 'force.cert_mandate')).toBe(true);
  });

  it('forced_pick rejects skip.unreachable', () => {
    expect(isReasonValidForAction('forced_pick', 'skip.unreachable')).toBe(false);
  });

  it('skip accepts both skip codes', () => {
    expect(isReasonValidForAction('skip', 'skip.unreachable')).toBe(true);
    expect(isReasonValidForAction('skip', 'skip.declined')).toBe(true);
  });

  it('skip rejects a force code', () => {
    expect(isReasonValidForAction('skip', 'force.reverse_seniority')).toBe(false);
  });

  it('admin_bid_for_member accepts bid_for_member.unreachable_phone', () => {
    expect(isReasonValidForAction('admin_bid_for_member', 'bid_for_member.unreachable_phone')).toBe(
      true,
    );
  });

  it('lock_position accepts probationary and swat codes', () => {
    expect(isReasonValidForAction('lock_position', 'lock_position.probationary_placement')).toBe(
      true,
    );
    expect(isReasonValidForAction('lock_position', 'lock_position.swat_medic_placement')).toBe(
      true,
    );
  });

  it('pause accepts session codes', () => {
    expect(isReasonValidForAction('pause', 'session.pause_emergency')).toBe(true);
    expect(isReasonValidForAction('pause', 'session.day_end_scheduled')).toBe(true);
  });
});
