import { BidDefinitionContentSchema, prepare2026StationTwoSpecialtyWorkflow } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { stationTwoSourceDefinition } from './helpers/station-two-definition.js';

describe('source-backed 2026 specialty workflow draft', () => {
  it('copies the corrected source scoring for exactly 6 CPT, 6 LT and 18 FF seats and preserves all other material', () => {
    const original = stationTwoSourceDefinition();
    const before = structuredClone(original);
    const prepared = prepare2026StationTwoSpecialtyWorkflow(original);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (!prepared.ok || prepared.content.settings?.v !== 3 || original.settings?.v !== 3)
      throw new Error('Prepared V3 required');
    expect(prepared.status).toBe('PREPARED');
    expect(original).toEqual(before);
    const oldAnnual = original.settings.livePolicy.annualOperations;
    const annual = prepared.content.settings.livePolicy.annualOperations;
    expect(annual?.specialties?.[0]).toEqual(oldAnnual?.specialties?.[0]);
    expect(annual?.aDay.execution?.timingExceptions?.[0]).toEqual(
      oldAnnual?.aDay.execution?.timingExceptions?.[0],
    );
    expect(annual?.aDay.execution?.constraints).toEqual(oldAnnual?.aDay.execution?.constraints);
    expect(annual?.aDay.specialtyMaximums).toEqual(oldAnnual?.aDay.specialtyMaximums);
    expect(
      annual?.specialties
        ?.slice(1)
        .map((policy) => [policy.id, policy.opportunityPositionIds.length]),
    ).toEqual([
      ['2026-station-two-cpt', 6],
      ['2026-station-two-lt', 6],
      ['2026-station-two-ff', 18],
    ]);
    for (const specialty of annual?.specialties?.slice(1) ?? []) {
      expect(specialty.mode).toBe('INTERRUPTING');
      expect(specialty.points).toEqual([]);
      expect(specialty.rankingChannel).toBe('total');
      for (const id of specialty.opportunityPositionIds) {
        const rule = original.rules.find((entry) => entry.positionId === id);
        expect(specialty.scoring).toEqual(JSON.parse(rule?.pointsPreferenceJson ?? '{}').scoring);
        expect(
          annual?.aDay.execution?.timingExceptions?.find((entry) => entry.positionIds.includes(id))
            ?.timing,
        ).toBe('AFTER_POSITION_SELECTION');
        expect(id).not.toMatch(/202$|203$|212$|213$|215$/);
      }
    }
    for (const key of [
      'positions',
      'rules',
      'participation',
      'staffingBindings',
      'sourceDecisions',
      'notes',
      'authoring',
      'planning',
    ] as const)
      expect(prepared.content[key]).toEqual(original[key]);
    expect(prepared.content.policy?.policyText).toBe(original.policy?.policyText);
    expect(BidDefinitionContentSchema.safeParse(prepared.content).success).toBe(true);
    expect(prepare2026StationTwoSpecialtyWorkflow(prepared.content)).toMatchObject({
      ok: true,
      status: 'ALREADY_CONFIGURED',
      content: prepared.content,
    });
  });
  it.each(['year', 'qualifications', 'scoring', 'ordering', 'seat', 'overlap', 'timing'] as const)(
    'fails closed for changed %s while preserving the input',
    (change) => {
      const draft = stationTwoSourceDefinition();
      const rule = draft.rules.find((entry) => entry.positionId === 'A201');
      if (!rule || draft.settings?.v !== 3 || !draft.policy)
        throw new Error('Source fixture required');
      const annual = draft.settings.livePolicy.annualOperations;
      if (!annual) throw new Error('Annual source required');
      if (change === 'year') draft.bidYear = 2027;
      if (change === 'qualifications')
        rule.requiredCriteriaJson = JSON.stringify({
          rank: ['CPT'],
          credentials: ['Invented prerequisite'],
          custom: [],
        });
      if (change === 'scoring') {
        const points = JSON.parse(rule.pointsPreferenceJson);
        points.scoring.total[0].items[0].points = 2;
        rule.pointsPreferenceJson = JSON.stringify(points);
      }
      if (change === 'ordering') rule.tieBreakChainJson = '["points","rank_seniority"]';
      if (change === 'seat')
        draft.positions = draft.positions.filter((position) => position.id !== 'A718');
      const existing = annual.specialties?.[0];
      if (!existing) throw new Error('Existing specialty required');
      if (change === 'overlap')
        annual.specialties?.push({
          ...existing,
          id: 'existing-custom',
          opportunityPositionIds: ['A201'],
        });
      if (change === 'timing')
        annual.aDay.execution?.timingExceptions?.push({
          id: 'existing-custom',
          label: 'Existing custom',
          timing: 'SIMULTANEOUS',
          sourceRef: 'Custom source timing',
          positionIds: ['A201'],
          profileIds: [],
        });
      draft.policy.executionPolicy = structuredClone(draft.settings.livePolicy);
      const before = structuredClone(draft);
      expect(prepare2026StationTwoSpecialtyWorkflow(draft).ok).toBe(false);
      expect(draft).toEqual(before);
    },
  );
});
