import { describe, expect, it } from 'vitest';
import { configuredChannel } from '../src/points/configured.js';
import type { Member, ScoringGroup } from '../src/types.js';

describe('approved completion credit', () => {
  const member = {
    credentials: [],
    memberId: 12,
    scoringEvidence: { evaluationOn: '2026-09-01', completedCredentialNames: ['Certificate'] },
  } as unknown as Member;
  const groups = [
    {
      id: 'credit',
      cap: 3,
      items: [
        {
          credential: 'Certificate',
          alternatives: [],
          requiresAll: [],
          points: 5,
          completionCredit: {
            sourceRef: 'Synthetic approved decision',
            effectiveFrom: '2026-01-01',
            effectiveThrough: '2026-12-31',
            memberIds: [12],
          },
        },
      ],
    },
  ] as ScoringGroup[];
  it('awards only the scoped credit and retains the group cap', () => {
    expect(configuredChannel(member, groups).total).toBe(3);
    expect(configuredChannel({ ...member, memberId: 13 }, groups).total).toBe(0);
    expect(
      configuredChannel(
        {
          ...member,
          scoringEvidence: {
            completedCredentialNames: ['Certificate'],
            evaluationOn: '2027-01-01',
          },
        },
        groups,
      ).total,
    ).toBe(0);
  });
  it('never turns completion into an active prerequisite or assumes absent historical evidence', () => {
    const gated = structuredClone(groups);
    const item = gated[0]?.items[0];
    if (!item) throw new Error('Missing fixture item');
    item.requiresAll = ['Certificate'];
    expect(configuredChannel(member, gated).total).toBe(0);
    expect(configuredChannel({ credentials: [] }, groups).total).toBe(0);
  });
  it('explains uncapped completion credit and permits explicitly unscoped policy credit', () => {
    const uncapped = structuredClone(groups);
    const item = uncapped[0]?.items[0];
    const group = uncapped[0];
    if (!item?.completionCredit || !group) throw new Error('Missing fixture');
    group.cap = null;
    item.completionCredit.memberIds = undefined;
    const result = configuredChannel(member, uncapped);
    expect(result.total).toBe(5);
    expect(result.itemized[0]?.reason).toContain('Completion credit authorized');
    expect(
      configuredChannel({ ...member, credentials: [{ name: 'Certificate' }] }, uncapped).itemized[0]
        ?.reason,
    ).toBeUndefined();
    item.completionCredit.sourceRef = '';
    expect(configuredChannel(member, uncapped).total).toBe(0);
  });
  it('does not use an exception before its start or for unknown member/completion evidence', () => {
    expect(
      configuredChannel({ ...member, memberId: undefined } as unknown as Member, groups).total,
    ).toBe(0);
    expect(
      configuredChannel(
        {
          ...member,
          scoringEvidence: {
            evaluationOn: '2025-12-31',
            completedCredentialNames: ['Certificate'],
          },
        },
        groups,
      ).total,
    ).toBe(0);
    expect(
      configuredChannel(
        {
          ...member,
          scoringEvidence: { evaluationOn: '2026-09-01', completedCredentialNames: [] },
        },
        groups,
      ).total,
    ).toBe(0);
  });
});
