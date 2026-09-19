import { evaluateEligibility } from '@mbfd/eligibility';
import type { AnnualRuleProfile, BidDefinitionContent } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  materializeBidDefinitionProfiles,
  validateMaterializedBidDefinitionProfiles,
} from '../src/lib/bid-profile-review.js';
import { decodePositionRule } from '../src/lib/position-rule.js';

const emptyScoring = { v: 1 as const, total: [], so: [], mo: [] };
const profile = (id: string, scope: AnnualRuleProfile['scope']): AnnualRuleProfile => ({
  id,
  name: `Synthetic ${id}`,
  sourceRef: `synthetic://${id}`,
  scope,
  requirements: { credentials: [], custom: [] },
  scoring: emptyScoring,
  tieBreakChain: ['rsc_seniority'],
});

function contentWith(profiles: AnnualRuleProfile[]): BidDefinitionContent {
  return {
    v: 1,
    bidYear: 2027,
    settings: null,
    notes: { bid: null, positions: null },
    policy: null,
    planning: null,
    authoring: {
      profiles,
      compiled: [],
      reconciliation: 'MATCHES_CAPTURED_RULE_REVISION',
    },
    positions: [
      {
        id: 'rescue-lt',
        shift: 'A',
        station: '1',
        division: 'Operations',
        unit: 'Rescue 1',
        rankRequired: 'LT',
        positionName: 'Rescue Lieutenant',
        isFloating: false,
        isVacantByDesign: false,
        isExcludedFromCount: false,
      },
      {
        id: 'engine-ff',
        shift: 'B',
        station: '2',
        division: 'Operations',
        unit: 'Engine 2',
        rankRequired: 'FF',
        positionName: 'Engine Firefighter',
        isFloating: false,
        isVacantByDesign: false,
        isExcludedFromCount: false,
      },
      {
        id: 'excluded-seat',
        shift: 'C',
        station: '3',
        division: 'Operations',
        unit: 'Administrative',
        rankRequired: 'FF',
        positionName: 'Excluded Seat',
        isFloating: false,
        isVacantByDesign: false,
        isExcludedFromCount: true,
      },
    ],
    rules: [],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  };
}

describe('Bid definition profile materialization', () => {
  it('compiles explicit-profile inheritance into biddable concrete rules with source mapping', () => {
    const department = profile('department', { kind: 'department' });
    const lieutenant: AnnualRuleProfile = {
      ...profile('lieutenant', { kind: 'rank', rank: 'LT' }),
      requirements: { ranks: ['LT'], credentials: ['Incident Command'], custom: [] },
    };
    const rescue = {
      ...profile('rescue-family', {
        kind: 'family' as const,
        name: 'Rescue',
        positionIds: ['rescue-lt'],
      }),
      requirements: { credentials: ['Rescue Operations'], custom: [] },
    };
    const rescueScoring: AnnualRuleProfile = {
      ...profile('rescue-scoring', { kind: 'position', positionId: 'rescue-lt' }),
      scoring: {
        v: 1 as const,
        total: [
          {
            id: 'technical-credit',
            cap: null,
            items: [
              {
                credential: 'Technical Rescue',
                alternatives: [],
                requiresAll: ['Operations Pair'],
                points: 4,
              },
            ],
          },
        ],
        so: [],
        mo: [],
      },
      tieBreakChain: ['points', 'rank_seniority'],
    };
    const engineScoring = {
      ...profile('engine-scoring', { kind: 'position', positionId: 'engine-ff' }),
      scoring: {
        v: 1 as const,
        total: [
          {
            id: 'engine-credit',
            cap: null,
            items: [
              {
                credential: 'Driver Engineer',
                alternatives: [],
                requiresAll: [],
                points: 7,
              },
            ],
          },
        ],
        so: [],
        mo: [],
      },
    };

    const result = materializeBidDefinitionProfiles(
      contentWith([department, lieutenant, rescue, rescueScoring, engineScoring]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.rules.map((rule) => rule.positionId)).toEqual(['engine-ff', 'rescue-lt']);
    expect(result.content.authoring?.reconciliation).toBe('MATERIALIZED_FOR_CURRENT_VERSION');
    expect(result.profileMappings).toContainEqual(
      expect.objectContaining({ id: 'rescue-family', positionIds: ['rescue-lt'] }),
    );
    expect(result.profileMappings).toContainEqual(
      expect.objectContaining({ id: 'department', positionIds: ['engine-ff', 'rescue-lt'] }),
    );

    const rescueRule = result.compiled.find((entry) => entry.rule.positionId === 'rescue-lt');
    const engineRule = result.compiled.find((entry) => entry.rule.positionId === 'engine-ff');
    if (!rescueRule || !engineRule) throw new Error('Expected compiled rescue and engine rules');
    const decodedRescue = decodePositionRule({
      ...rescueRule.rule,
      ruleBookVersion: 'synthetic',
    });
    expect(decodedRescue.ok).toBe(true);
    if (!decodedRescue.ok) return;
    expect(decodedRescue.rule).toMatchObject({
      requiredCriteria: {
        rank: ['LT'],
        credentials: ['Incident Command', 'Rescue Operations'],
      },
      tieBreakChain: ['points', 'rank_seniority'],
    });
    expect(rescueRule).toMatchObject({
      provenance: {
        requirements: ['department', 'lieutenant', 'rescue-family', 'rescue-scoring'],
        scoring: ['rescue-scoring'],
        priorities: ['rescue-scoring'],
        matched: ['department', 'lieutenant', 'rescue-family', 'rescue-scoring'],
      },
    });
    expect(JSON.parse(engineRule.rule.pointsPreferenceJson).scoring.total[0].items[0].points).toBe(
      7,
    );

    // Conditional scoring remains the established engine behavior: holding the
    // score credential without its required companion receives no credit.
    expect(
      evaluateEligibility(
        {
          employeeId: 'synthetic-1',
          firstName: 'Synthetic',
          lastName: 'Member',
          rank: 'LT',
          rscSeniority: 1,
          rankSeniority: 1,
          isProbationary: false,
          credentials: ['Incident Command', 'Rescue Operations', 'Technical Rescue'].map(
            (name) => ({ name }),
          ),
        },
        decodedRescue.rule,
      ).points,
    ).toBe(0);
    expect(
      evaluateEligibility(
        {
          employeeId: 'synthetic-2',
          firstName: 'Synthetic',
          lastName: 'Positive scoring',
          rank: 'LT',
          rscSeniority: 2,
          rankSeniority: 2,
          isProbationary: false,
          credentials: [
            'Incident Command',
            'Rescue Operations',
            'Technical Rescue',
            'Operations Pair',
          ].map((name) => ({ name })),
        },
        decodedRescue.rule,
      ).points,
    ).toBe(4);
    expect(
      evaluateEligibility(
        {
          employeeId: 'synthetic-3',
          firstName: 'Synthetic',
          lastName: 'Missing requirement',
          rank: 'LT',
          rscSeniority: 3,
          rankSeniority: 3,
          isProbationary: false,
          credentials: ['Incident Command', 'Technical Rescue', 'Operations Pair'].map((name) => ({
            name,
          })),
        },
        decodedRescue.rule,
      ).eligible,
    ).toBe(false);
  });

  it('keeps two explicitly selected specialty families distinct when they score the same credential', () => {
    const department = profile('department', { kind: 'department' });
    const rescue = {
      ...profile('rescue-specialty', {
        kind: 'family' as const,
        name: 'Rescue specialty',
        positionIds: ['rescue-lt'],
      }),
      scoring: {
        ...emptyScoring,
        total: [
          {
            id: 'rescue-specialty-credit',
            cap: null,
            items: [
              { credential: 'Shared Specialty', alternatives: [], requiresAll: [], points: 2 },
            ],
          },
        ],
      },
    };
    const engine = {
      ...profile('engine-specialty', {
        kind: 'family' as const,
        name: 'Engine specialty',
        positionIds: ['engine-ff'],
      }),
      scoring: {
        ...emptyScoring,
        total: [
          {
            id: 'engine-specialty-credit',
            cap: null,
            items: [
              { credential: 'Shared Specialty', alternatives: [], requiresAll: [], points: 5 },
            ],
          },
        ],
      },
    };
    const result = materializeBidDefinitionProfiles(contentWith([department, rescue, engine]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPosition = new Map(
      result.compiled.map((entry) => [
        entry.rule.positionId,
        JSON.parse(entry.rule.pointsPreferenceJson).scoring.total[0].items[0].points,
      ]),
    );
    expect(byPosition).toEqual(
      new Map([
        ['engine-ff', 5],
        ['rescue-lt', 2],
      ]),
    );
    expect(result.profileMappings).toContainEqual(
      expect.objectContaining({ id: 'rescue-specialty', positionIds: ['rescue-lt'] }),
    );
    expect(result.profileMappings).toContainEqual(
      expect.objectContaining({ id: 'engine-specialty', positionIds: ['engine-ff'] }),
    );
  });

  it('reports equal-specificity scoring disagreement without choosing a winner', () => {
    const department = profile('department', { kind: 'department' });
    const left = {
      ...profile('left-family', {
        kind: 'family' as const,
        name: 'Synthetic family',
        positionIds: ['rescue-lt'],
      }),
      scoring: {
        ...emptyScoring,
        total: [
          {
            id: 'left',
            cap: null,
            items: [{ credential: 'Left', alternatives: [], requiresAll: [], points: 1 }],
          },
        ],
      },
    };
    const right = {
      ...left,
      id: 'right-family',
      name: 'Synthetic right family',
      sourceRef: 'synthetic://right-family',
      scoring: {
        ...emptyScoring,
        total: [
          {
            id: 'right',
            cap: null,
            items: [{ credential: 'Right', alternatives: [], requiresAll: [], points: 2 }],
          },
        ],
      },
    };

    const result = materializeBidDefinitionProfiles(contentWith([department, left, right]));

    expect(result).toMatchObject({
      ok: false,
      code: 'profile_compilation_conflict',
      conflicts: [
        expect.objectContaining({
          positionId: 'rescue-lt',
          field: 'scoring',
          profileIds: ['left-family', 'right-family'],
        }),
      ],
    });
  });

  it('requires exact server materialization for new profile-backed saves but preserves legacy divergence', () => {
    const materialized = materializeBidDefinitionProfiles(
      contentWith([profile('department', { kind: 'department' })]),
    );
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    expect(validateMaterializedBidDefinitionProfiles(materialized.content)).toEqual({ ok: true });

    const pending = structuredClone(materialized.content);
    if (!pending.authoring) throw new Error('Expected materialized profile authoring');
    pending.authoring.reconciliation = 'PROFILE_EDITS_PENDING_REVIEW';
    expect(validateMaterializedBidDefinitionProfiles(pending)).toEqual({
      ok: false,
      error: 'profile_review_required',
    });

    const changed = structuredClone(materialized.content);
    const changedRule = changed.rules[0];
    if (!changedRule || !changed.authoring)
      throw new Error('Expected materialized rule and authoring');
    changedRule.tieBreakChainJson = JSON.stringify(['points']);
    expect(validateMaterializedBidDefinitionProfiles(changed)).toEqual({
      ok: false,
      error: 'profile_authoring_unapplied',
    });

    changed.authoring.reconciliation = 'RULES_CHANGED_AFTER_COMPILATION';
    expect(validateMaterializedBidDefinitionProfiles(changed)).toEqual({ ok: true });
  });
});

describe('closed opportunity profile preservation', () => {
  it('preserves closed and excluded source profiles while materializing only open family members', () => {
    const profiles = [
      profile('base', { kind: 'department' }),
      profile('closed-source', { kind: 'position', positionId: 'rescue-lt' }),
      profile('excluded-source', { kind: 'position', positionId: 'excluded-seat' }),
      profile('mixed-family', {
        kind: 'family',
        name: 'Source family',
        positionIds: ['engine-ff', 'rescue-lt', 'excluded-seat'],
      }),
    ];
    const input = contentWith(profiles);
    input.participation = [
      {
        positionId: 'rescue-lt',
        bidParticipation: 'RESERVED_NON_BIDDABLE',
        authoritativeSourceRef: 'Synthetic source: closed this year',
      },
    ];
    const result = materializeBidDefinitionProfiles(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.rules.map((rule) => rule.positionId)).toEqual(['engine-ff']);
    expect(result.content.authoring?.profiles).toEqual(
      [...profiles].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(result.content.authoring?.profiles.find((p) => p.id === 'mixed-family')?.scope).toEqual({
      kind: 'family',
      name: 'Source family',
      positionIds: ['engine-ff', 'rescue-lt', 'excluded-seat'],
    });
    expect(validateMaterializedBidDefinitionProfiles(result.content)).toEqual({ ok: true });
  });
  it('still rejects unknown profile targets rather than silently treating them as closed', () => {
    const input = contentWith([
      profile('base', { kind: 'department' }),
      profile('unknown', { kind: 'position', positionId: 'not-in-definition' }),
    ]);
    const result = materializeBidDefinitionProfiles(input);
    expect(result).toMatchObject({
      ok: false,
      code: 'profile_compilation_conflict',
      conflicts: [{ positionId: 'not-in-definition', field: 'scope' }],
    });
  });
});
