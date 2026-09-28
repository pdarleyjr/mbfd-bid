import type { BidDefinitionContent, FrozenAnnualOperationsPolicy } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import finalPositions from '../../seed/fixtures/final_2026_positions.json';
import {
  addReviewedBRescueLieutenantPolicySeat,
  map2026VersionPositionsByRole,
  remap2026PositionReferences,
  resolveReturned2026CaptainMemberId,
  withReviewed2026AdministrativeConnections,
} from '../../src/lib/corrected-2026-successor.js';
import { buildCorrected2026Topology } from '../../src/lib/corrected-2026-topology.js';

const source = buildCorrected2026Topology().filter(
  (position) => position.canonicalIdentity === undefined,
);
const previous = source.map((position) => {
  const raw = finalPositions.find((row) => row.id === position.id);
  if (!raw) throw new Error(`missing_raw_test_position:${position.id}`);
  return {
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
    rankRequired: raw.rankRequired as typeof position.rankRequired,
    positionName: raw.positionName,
    isFloating: position.isFloating,
    isVacantByDesign: position.isVacantByDesign,
    isExcludedFromCount: position.isExcludedFromCount,
  };
});

describe('2026 successor semantic position mapping', () => {
  it('adds the reviewed third B-shift Rescue Float Lieutenant to the selectable pool', () => {
    const operations = {
      opportunityPools: [{ id: 'rescue-float-B-lt', positionIds: ['B701', 'B702'] }],
      fallbackPolicies: [{ id: 'fallback-rescue-float', positionIds: ['B701', 'B702', 'B704'] }],
    } as unknown as FrozenAnnualOperationsPolicy;
    addReviewedBRescueLieutenantPolicySeat(operations);
    expect(operations.opportunityPools?.[0]?.positionIds).toEqual(['B701', 'B702', 'B703']);
    expect(operations.fallbackPolicies?.[0]?.positionIds).toEqual(['B701', 'B702', 'B703', 'B704']);
    expect(() => addReviewedBRescueLieutenantPolicySeat(operations)).toThrow(
      'corrected_2026_b_rescue_lieutenant_pool_unreviewed',
    );
    expect(() => addReviewedBRescueLieutenantPolicySeat({} as typeof operations)).toThrow(
      'corrected_2026_b_rescue_lieutenant_pool_unreviewed',
    );
  });
  it('binds only unique approved non-biddable Department slots, including the acting B command seat', () => {
    const roleRows = [
      ['A211', 'A Shift', 'Division Chief', 'Division Chief 300', 'Division Chief', 'DC'],
      ['B211', 'B Shift', 'Division Chief', 'Division Chief 300', 'Division Chief', 'CPT'],
      ['C211', 'C Shift', 'Division Chief', 'Division Chief 300', 'Division Chief', 'DC'],
      ['A801', 'A Shift', 'Fire Union', 'Union Position', 'Union President', 'CPT'],
    ] as const;
    const slots = roleRows.map(([id, shift, station, unit, positionName, applicableRank]) => ({
      id: `slot-${id}`,
      stableSlotKey: `TELSTAFF/v1/${id}`,
      shift,
      station,
      unit,
      positionName,
      applicableRank,
      reviewStatus: 'approved',
      activeFrom: '2026-08-24',
      activeTo: null,
    }));
    const content = { staffingBindings: [] } as unknown as BidDefinitionContent;
    const result = withReviewed2026AdministrativeConnections(content, slots);
    expect(result.staffingBindings.map((row) => [row.positionId, row.staffingPositionId])).toEqual([
      ['A211', 'slot-A211'],
      ['A801', 'slot-A801'],
      ['B211', 'slot-B211'],
      ['C211', 'slot-C211'],
    ]);
    expect(result.staffingBindings.every((row) => row.reviewStatus === 'approved')).toBe(true);
    expect(() => withReviewed2026AdministrativeConnections(content, slots.slice(1))).toThrow(
      'reviewed_2026_administrative_connection_not_unique:A211',
    );
    const firstSlot = slots.at(0);
    if (!firstSlot) throw new Error('synthetic slot missing');
    expect(() => withReviewed2026AdministrativeConnections(content, [...slots, firstSlot])).toThrow(
      'reviewed_2026_administrative_connection_not_unique:A211',
    );
    expect(() => withReviewed2026AdministrativeConnections(result, slots)).toThrow(
      'reviewed_2026_administrative_connection_already_present:A211',
    );
  });

  it('matches every MASTER role after approved source corrections, independent of prior IDs and row order', () => {
    const result = map2026VersionPositionsByRole(previous.reverse());
    expect(result.size).toBe(228);
    expect(new Set([...result.values()].filter((id) => id !== null)).size).toBe(227);
    expect(result.get('prior-A305')).toBe('A305');
    expect(result.get('prior-B214')).toBe('B214');
    expect(result.get('prior-A211')).toBe('A211');
    expect(result.get('prior-B703')).toBe('B704');
    expect(result.get('prior-B704')).toBe('B705');
    expect(result.get('prior-B705')).toBe('B706');
    expect(result.get('prior-B706')).toBeNull();
    expect([...result.values()]).not.toContain('B703');
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
