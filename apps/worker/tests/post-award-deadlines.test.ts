import { PostAwardObligationSchema } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { finalAwardEvidence, obligationDueOn } from '../src/lib/post-award-obligations.js';
describe('explicit post-award deadline calendar', () => {
  const deadline = {
    basis: 'FINAL_POSITION_AWARD' as const,
    unit: 'CALENDAR_MONTHS' as const,
    count: 1,
    timeZone: 'America/New_York' as const,
  };
  it('retains an explicit approved bid start through later award amendments and rejects missing or invalid dates', () => {
    const explicit = {
      ...deadline,
      basis: 'APPROVED_BID_START_DATE' as const,
      startOn: '2027-01-31',
    };
    expect(obligationDueOn(Date.parse('2027-02-05T18:00:00Z'), explicit)).toBe('2027-02-28');
    expect(obligationDueOn(Date.parse('2027-02-22T18:00:00Z'), explicit)).toBe('2027-02-28');
    expect(
      obligationDueOn(Date.parse('2027-02-05T18:00:00Z'), { ...explicit, startOn: '2027-02-29' }),
    ).toBeNull();
    const term = {
      id: 'synthetic-start',
      credential: 'Synthetic credential',
      sourceRef: 'Synthetic date authority',
      deadline: explicit,
    };
    expect(PostAwardObligationSchema.safeParse(term).success).toBe(true);
    for (const value of [
      { ...explicit, startOn: undefined },
      { ...explicit, startOn: '2027-02-29' },
      { ...deadline, startOn: '2027-01-31' },
    ])
      expect(PostAwardObligationSchema.safeParse({ ...term, deadline: value }).success).toBe(false);
    expect(obligationDueOn(Number.NaN, explicit)).toBeNull();
  });
  it('clamps month ends and applies the selected calendar zone including daylight saving boundaries', () => {
    expect(obligationDueOn(Date.parse('2028-01-31T18:00:00Z'), deadline)).toBe('2028-02-29');
    expect(obligationDueOn(Date.parse('2027-01-31T18:00:00Z'), deadline)).toBe('2027-02-28');
    expect(obligationDueOn(Date.parse('2027-03-01T01:00:00Z'), deadline)).toBe('2027-03-28');
    expect(
      obligationDueOn(Date.parse('2027-03-01T01:00:00Z'), { ...deadline, timeZone: 'UTC' }),
    ).toBe('2027-04-01');
    expect(
      obligationDueOn(Date.parse('2027-03-13T18:00:00Z'), { ...deadline, unit: 'CALENDAR_DAYS' }),
    ).toBe('2027-03-14');
    expect(obligationDueOn(Number.NaN, deadline)).toBeNull();
  });
  it('rejects duplicate, wrong-member, wrong-position and post-completion award clocks', () => {
    const event = {
      id: 'event',
      commandId: 'command',
      commandType: 'live.record_selection',
      seq: 2,
      createdAtMs: 1000,
      payload: {
        operation: 'record_selection',
        bidId: 'bid',
        positionId: 'position',
        memberId: 100,
      },
    };
    const fill = { bidId: 'bid', memberId: 100 };
    const completion = { revision: 3, completedAtMs: 2000 };
    expect(finalAwardEvidence([event], fill, 'position', completion)?.id).toBe('event');
    expect(
      finalAwardEvidence([{ ...event, commandType: 'live.pass' }], fill, 'position', completion),
    ).toBeNull();
    expect(finalAwardEvidence([event, event], fill, 'position', completion)).toBeNull();
    expect(
      finalAwardEvidence([event], { ...fill, memberId: 101 }, 'position', completion),
    ).toBeNull();
    expect(finalAwardEvidence([event], fill, 'other', completion)).toBeNull();
    expect(
      finalAwardEvidence([{ ...event, createdAtMs: 3000 }], fill, 'position', completion),
    ).toBeNull();
  });
});
