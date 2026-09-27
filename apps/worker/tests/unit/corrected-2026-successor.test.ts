import type { BidDefinitionContent } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  map2026VersionPositionsByRole,
  remap2026PositionReferences,
  resolveReturned2026CaptainMemberId,
} from '../../src/lib/corrected-2026-successor.js';
import { buildCorrected2026Topology } from '../../src/lib/corrected-2026-topology.js';

const source = buildCorrected2026Topology().filter(
  (position) => position.canonicalIdentity === undefined,
);
const previous = source.map((position) => ({
  id: `prior-${position.id}`,
  shift: position.shift,
  station: position.station,
  division:
    position.station === 'Station #2' &&
    position.unit === 'Float 2' &&
    position.positionName === 'Firefighter #1 (C)' &&
    ['B', 'C'].includes(position.shift)
      ? 'Rescue'
      : position.division,
  unit:
    position.station === 'Station #3' && position.positionName.includes('INV')
      ? 'Ladder 3'
      : String(position.unit),
  rankRequired: position.rankRequired,
  positionName: position.positionName,
  isFloating: position.isFloating,
  isVacantByDesign: position.isVacantByDesign,
  isExcludedFromCount: position.isExcludedFromCount,
}));

describe('2026 successor semantic position mapping', () => {
  it('matches every MASTER role after approved source corrections, independent of prior IDs and row order', () => {
    const result = map2026VersionPositionsByRole(previous.reverse());
    expect(result.size).toBe(228);
    expect(new Set(result.values()).size).toBe(228);
    expect(result.get('prior-A305')).toBe('A305');
    expect(result.get('prior-B214')).toBe('B214');
    expect(result.get('prior-A211')).toBe('A211');
  });

  it('fails closed when a prior role cannot be reconciled', () => {
    const changed = previous.map((position) =>
      position.id === 'prior-A305'
        ? { ...position, positionName: 'Unreviewed Investigator' }
        : position,
    );
    expect(() => map2026VersionPositionsByRole(changed)).toThrow(
      'corrected_2026_semantic_role_mismatch',
    );
  });

  it('resolves the returned Captain by employee identity across internal ID changes', () => {
    expect(resolveReturned2026CaptainMemberId([{ memberId: 941, employeeId: '18148' }])).toBe(941);
    expect(() => resolveReturned2026CaptainMemberId([])).toThrow('not_unique');
    expect(() =>
      resolveReturned2026CaptainMemberId([
        { memberId: 9, employeeId: '18148' },
        { memberId: 941, employeeId: '18148' },
      ]),
    ).toThrow('not_unique');
  });

  it('remaps typed position scopes without changing identical narrative text', () => {
    const oldId = 'prior-A305';
    const narrative = `Policy excerpt ${oldId}\r\nSource ${oldId} — keep exact bytes.`;
    const operations = {
      requiredTopologyPositionIds: [oldId],
      specialties: [{ opportunityPositionIds: [oldId], sourceRef: narrative }],
      opportunityPools: [{ positionIds: [oldId], sourceRef: narrative }],
      assignmentTerms: [{ positionIds: [oldId], sourceRef: narrative }],
      fallbackPolicies: [{ positionIds: [oldId], sourceRef: narrative }],
      aDay: {
        execution: {
          timingExceptions: [{ positionIds: [oldId], sourceRef: narrative }],
          constraints: [{ positionIds: [oldId], sourceRef: narrative }],
        },
      },
    };
    const content = {
      notes: { bid: narrative, positions: narrative },
      policy: {
        policyText: narrative,
        executionPolicy: {
          stages: [{ opportunityPositionIds: [oldId], sourceRef: narrative }],
          annualOperations: operations,
        },
      },
      settings: {
        v: 3,
        livePolicy: {
          stages: [{ opportunityPositionIds: [oldId], sourceRef: narrative }],
          annualOperations: structuredClone(operations),
        },
      },
      staffingBindings: [{ positionId: oldId, authoritativeSourceRef: narrative }],
      sourceDecisions: [{ sourceRef: narrative, decision: narrative }],
    } as unknown as BidDefinitionContent;
    const mapped = remap2026PositionReferences(content, new Map([[oldId, 'A305']]));
    expect(mapped.policy?.executionPolicy.stages[0]?.opportunityPositionIds).toEqual(['A305']);
    expect(
      mapped.policy?.executionPolicy.annualOperations?.specialties?.[0]?.opportunityPositionIds,
    ).toEqual(['A305']);
    expect(
      mapped.policy?.executionPolicy.annualOperations?.aDay.execution?.constraints[0]?.positionIds,
    ).toEqual(['A305']);
    expect(
      mapped.settings?.v === 3 && mapped.settings.livePolicy.stages[0]?.opportunityPositionIds,
    ).toEqual(['A305']);
    expect(mapped.staffingBindings[0]?.positionId).toBe('A305');
    expect(mapped.notes).toEqual(content.notes);
    expect(mapped.policy?.policyText).toBe(narrative);
    expect(mapped.sourceDecisions).toEqual(content.sourceDecisions);
    expect(content.policy?.executionPolicy.stages[0]?.opportunityPositionIds).toEqual([oldId]);
  });
});
