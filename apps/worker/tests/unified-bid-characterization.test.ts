import { readFileSync } from 'node:fs';
import { type Member, type PositionRule, evaluateEligibility } from '@mbfd/eligibility';
import {
  type AnnualRuleProfile,
  AnnualRuleProfilesSchema,
  type BidSessionPolicySnapshot,
  FrozenAnnualSpecialtyPolicySchema,
  type FrozenLiveBidPolicy,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  ANNUAL_2026_STAGE_ORDER,
  type AnnualOperationsPolicy,
  declareUnreachable,
  initializeAnnualOperations,
  validateAnnualOperationsReadiness,
  validateSpecialtyADayMaximum,
} from '../src/lib/annual-bid-operations.js';
import { annualEligibilityImpact } from '../src/lib/annual-eligibility-impact.js';
import { compileAnnualRules } from '../src/lib/annual-rule-compiler.js';
import { rankFrozenSpecialtyCandidates } from '../src/lib/annual-specialty-policy.js';
import {
  computeFrozenStageOrder,
  isPositionAllowedForCurrentStage,
} from '../src/lib/live-bid-policy.js';
import { decodePositionRule } from '../src/lib/position-rule.js';

/**
 * Executable characterization of ec4087a, not policy-owner approval or a
 * historical replay. Committed seed rows are identified explicitly below;
 * all member facts, new configurations and stage populations are synthetic.
 * Expected outputs are literals, never captured by calling the implementation.
 * The separate private, approved replay manifest remains required for a
 * normative historical-policy claim; this suite supplies no substitute for it.
 */
const execution2026: AnnualOperationsPolicy = {
  v: 1,
  stageOrder: ['D_CAPTAIN', 'D_LIEUTENANT', 'ABC_CAPTAIN', 'ABC_LIEUTENANT', 'ABC_FIREFIGHTER'],
  requiredTopologyPositionIds: ['synthetic-required-seat'],
  contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
  aDay: {
    combatGroups: ['G1', 'G2', 'G3', 'G4'],
    min: 18,
    max: 19,
    captainDcMax: 2,
    specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 2, SWAT: 1 },
  },
};

function member(id: number, credentials: string[], rank: Member['rank'] = 'CPT'): Member {
  return {
    memberId: id,
    employeeId: `synthetic-${id}`,
    firstName: 'Synthetic',
    lastName: `Characterization ${id}`,
    rank,
    rscSeniority: id,
    rankSeniority: id,
    isProbationary: false,
    credentials: credentials.map((name) => ({ name })),
  };
}

function fixtureRule(positionId: string): PositionRule {
  const rows = JSON.parse(
    readFileSync(new URL('../seed/fixtures/2026_rules.json', import.meta.url), 'utf8'),
  ) as Array<{
    positionId: string;
    ruleBookVersion: string;
    requiredCriteria: unknown;
    pointsPreference: unknown;
    tieBreakChain: unknown;
  }>;
  const matches = rows.filter((row) => row.positionId === positionId);
  if (matches.length !== 1) throw new Error(`Expected one committed fixture rule: ${positionId}`);
  const row = matches[0];
  if (!row) throw new Error('Committed fixture row missing');
  const decoded = decodePositionRule({
    positionId: row.positionId,
    ruleBookVersion: row.ruleBookVersion,
    requiredCriteriaJson: JSON.stringify(row.requiredCriteria),
    pointsPreferenceJson: JSON.stringify(row.pointsPreference),
    tieBreakChainJson: JSON.stringify(row.tieBreakChain),
  });
  if (!decoded.ok) throw new Error(`Fixture decode failed: ${JSON.stringify(decoded.issues)}`);
  return decoded.rule;
}

const operationsCredentials = [
  'Hazardous Materials Operations',
  'Rope Rescue Operations',
  'Confined Space Operations',
  'Structural Collapse Operations',
  'Trench Rescue Operations',
  'Vehicle & Machinery Rescue Operations',
];
const technicianCredentials = [
  'State Certified Hazardous Materials Technician',
  'Rope Rescue Technician',
  'Confined Space Technician',
  'Structural Collapse Technician',
  'Trench Rescue Technician',
  'Vehicle & Machinery Rescue Technician',
];

describe('unified Bid: current executable 2026 characterization', () => {
  it('pins the current literal stage sequence independently of the exported constant', () => {
    expect(ANNUAL_2026_STAGE_ORDER).toEqual([
      'D_CAPTAIN',
      'D_LIEUTENANT',
      'ABC_CAPTAIN',
      'ABC_LIEUTENANT',
      'ABC_FIREFIGHTER',
    ]);
    expect(
      validateAnnualOperationsReadiness({
        operations: execution2026,
        bidYear: 2026,
        isMock: false,
        configuredStageIds: execution2026.stageOrder,
        missingTopologyIds: [],
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    ['ABC_CAPTAIN', 'D_CAPTAIN', 'D_LIEUTENANT', 'ABC_LIEUTENANT', 'ABC_FIREFIGHTER'],
    ['D_CAPTAIN', 'D_LIEUTENANT', 'ABC_CAPTAIN', 'ABC_LIEUTENANT'],
    ['D_CAPTAIN', 'D_LIEUTENANT', 'ABC_CAPTAIN', 'ABC_LIEUTENANT', 'ABC_FIREFIGHTER', 'NEW_STAGE'],
  ])('records the existing 2026 stage restriction: %j', (...stageOrder) => {
    expect(
      validateAnnualOperationsReadiness({
        operations: { ...execution2026, stageOrder },
        bidYear: 2026,
        isMock: true,
        configuredStageIds: stageOrder,
        missingTopologyIds: [],
      }),
    ).toEqual({ ok: false, code: 'ANNUAL_2026_STAGE_ORDER_INVALID' });
  });

  it('pins D101 cap and D102 mandatory credential behavior from committed seed rows', () => {
    const d101 = fixtureRule('D101');
    expect(
      evaluateEligibility(member(1, ['Firesafety Inspector I', 'Firesafety Inspector II']), d101),
    ).toEqual({
      eligible: true,
      reasons: [
        { code: 'RANK_OK', label: 'Rank Captain is eligible for this position', satisfied: true },
      ],
      points: 1,
      soPoints: 0,
      moPoints: 0,
      breakdown: {
        total: 1,
        soTotal: 0,
        moTotal: 0,
        // Legacy itemization is before the overall cap; preserve this fact.
        itemized: [
          { credential: 'Firesafety Inspector I', awarded: 1 },
          { credential: 'Firesafety Inspector II', awarded: 1 },
        ],
      },
    });
    expect(evaluateEligibility(member(1, []), fixtureRule('D102'))).toEqual({
      eligible: false,
      reasons: [
        { code: 'RANK_OK', label: 'Rank Captain is eligible for this position', satisfied: true },
        {
          code: 'CRED_MISSING',
          label: 'Missing required: Firesafety Inspector I',
          satisfied: false,
        },
      ],
      points: 0,
      soPoints: 0,
      moPoints: 0,
      breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
    });
  });

  it.each([
    { omittedOperation: false, points: 13, soPoints: 13 },
    { omittedOperation: true, points: 6, soPoints: 12 },
  ])(
    'pins A214 all-operations technician gating: $omittedOperation',
    ({ omittedOperation, points, soPoints }) => {
      const credentials = [
        'Paramedic',
        ...(omittedOperation ? operationsCredentials.slice(0, 5) : operationsCredentials),
        ...technicianCredentials,
        'Drone Operator Qualified-Part 107 sUAS',
      ];
      const result = evaluateEligibility(member(1, credentials, 'LT'), fixtureRule('A214'));
      expect({
        eligible: result.eligible,
        points: result.points,
        soPoints: result.soPoints,
        moPoints: result.moPoints,
      }).toEqual({ eligible: true, points, soPoints, moPoints: 1 });
      expect(result.breakdown.itemized.slice(6, 12)).toEqual(
        technicianCredentials.map((credential) => ({
          credential,
          awarded: omittedOperation ? 0 : 1,
          ...(omittedOperation
            ? { reason: 'Technician cert requires all six Operations certifications' }
            : {}),
        })),
      );
    },
  );
});

const profile: AnnualRuleProfile = {
  id: 'synthetic-inspector',
  name: 'Synthetic inspector opportunity',
  sourceRef: 'test-only executable D102 comparison; no policy approval',
  scope: { kind: 'department' },
  requirements: { credentials: ['Firesafety Inspector I'], custom: [] },
  scoring: {
    v: 1,
    total: [
      {
        id: 'inspector',
        cap: 1,
        items: [
          { credential: 'Firesafety Inspector I', alternatives: [], requiresAll: [], points: 1 },
        ],
      },
    ],
    so: [],
    mo: [],
  },
  tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
};
function compile(profiles: AnnualRuleProfile[]): PositionRule {
  const result = compileAnnualRules(
    [{ id: 'D102', rank: 'CPT', station: 'synthetic-station', shift: 'D' }],
    AnnualRuleProfilesSchema.parse(profiles),
    '2026.1',
  );
  if (!result.ok || result.compiled.length !== 1) throw new Error(JSON.stringify(result.conflicts));
  const compiled = result.compiled[0];
  if (!compiled) throw new Error('Compiled rule missing');
  return compiled.rule;
}

describe('unified Bid: supported configuration changes through existing services', () => {
  it('compiles literal D102 behavior and matches committed executable eligibility without changing evidence', () => {
    const rule = compile([profile]);
    expect(rule).toEqual({
      positionId: 'D102',
      ruleBookVersion: '2026.1',
      requiredCriteria: { rank: ['CPT'], credentials: ['Firesafety Inspector I'], custom: [] },
      pointsPreference: {
        max: 0,
        items: [],
        scoring: {
          v: 1,
          total: [
            {
              id: 'inspector',
              cap: 1,
              items: [
                {
                  credential: 'Firesafety Inspector I',
                  alternatives: [],
                  requiresAll: [],
                  points: 1,
                },
              ],
            },
          ],
          so: [],
          mo: [],
        },
      },
      tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
    });
    const cohort = [
      member(1, []),
      member(2, ['Firesafety Inspector I']),
      member(3, ['Firesafety Inspector I'], 'FF'),
    ];
    const inputs = cohort.map((evidence, index) => ({ memberId: index + 1, evidence }));
    const result = annualEligibilityImpact({
      beforeMembers: inputs,
      afterMembers: inputs,
      beforeRules: [fixtureRule('D102')],
      afterRules: [rule],
    });
    expect(result).toEqual({
      evaluatedComparisons: 3,
      changed: [],
      evidence: { evaluatedComparisons: 3, changed: [] },
      incomparable: {
        addedMemberIds: [],
        removedMemberIds: [],
        addedPositionIds: [],
        removedPositionIds: [],
      },
    });
  });

  it('evaluates AND/OR requirements, point changes and prerequisites using typed configuration', () => {
    const changed: AnnualRuleProfile = {
      ...profile,
      requirements: {
        credentials: ['Prerequisite'],
        anyOfCredentials: [
          ['Training A', 'Training B'],
          ['License A', 'License B'],
        ],
        custom: [],
      },
      scoring: {
        v: 1,
        total: [
          {
            id: 'new-training',
            cap: null,
            items: [
              {
                credential: 'Training A',
                alternatives: ['Training B'],
                requiresAll: ['Prerequisite'],
                points: 7,
              },
            ],
          },
        ],
        so: [],
        mo: [],
      },
    };
    const rule = compile([changed]);
    const cases = [
      { credentials: ['Prerequisite', 'Training B', 'License A'], eligible: true, points: 7 },
      { credentials: ['Training B', 'License A'], eligible: false, points: 0 },
      { credentials: ['Prerequisite', 'License A'], eligible: false, points: 0 },
      { credentials: ['Prerequisite', 'Training B'], eligible: false, points: 0 },
    ];
    expect(
      cases.map(({ credentials }) => {
        const result = evaluateEligibility(member(1, credentials), rule);
        return { eligible: result.eligible, points: result.points };
      }),
    ).toEqual([
      { eligible: true, points: 7 },
      { eligible: false, points: 0 },
      { eligible: false, points: 0 },
      { eligible: false, points: 0 },
    ]);
  });

  it('pins exact draft impact and relative priority for a configured tie-break change without mutation', () => {
    const before = compile([{ ...profile, requirements: { credentials: [], custom: [] } }]);
    const after = compile([
      {
        ...profile,
        requirements: { credentials: [], custom: [] },
        tieBreakChain: ['rsc_seniority'],
      },
    ]);
    const members = [
      { memberId: 1, evidence: member(1, []) },
      { memberId: 2, evidence: member(2, ['Firesafety Inspector I']) },
    ];
    const input = {
      beforeMembers: members,
      afterMembers: members,
      beforeRules: [before],
      afterRules: [after],
    };
    const unchanged = JSON.stringify(input);
    expect(annualEligibilityImpact(input)).toEqual({
      evaluatedComparisons: 2,
      changed: [
        {
          positionId: 'D102',
          memberId: 1,
          before: { eligible: true, points: 0, soPoints: 0, moPoints: 0, priority: 2, reasons: [] },
          after: { eligible: true, points: 0, soPoints: 0, moPoints: 0, priority: 1, reasons: [] },
        },
        {
          positionId: 'D102',
          memberId: 2,
          before: { eligible: true, points: 1, soPoints: 0, moPoints: 0, priority: 1, reasons: [] },
          after: { eligible: true, points: 1, soPoints: 0, moPoints: 0, priority: 2, reasons: [] },
        },
      ],
      evidence: { evaluatedComparisons: 2, changed: [] },
      incomparable: {
        addedMemberIds: [],
        removedMemberIds: [],
        addedPositionIds: [],
        removedPositionIds: [],
      },
    });
    expect(JSON.stringify(input)).toBe(unchanged);
  });

  it('applies a family profile to newly configured station/position identities with source provenance', () => {
    const result = compileAnnualRules(
      [
        {
          id: 'synthetic-station-7-engine-seat',
          station: 'synthetic-station-7',
          shift: 'B',
          rank: 'FF',
        },
      ],
      [
        {
          ...profile,
          scope: {
            kind: 'family',
            name: 'Synthetic new family',
            positionIds: ['synthetic-station-7-engine-seat'],
          },
        },
      ],
      'synthetic-current-version',
    );
    expect(result.ok).toBe(true);
    expect(
      result.compiled.map(({ rule, provenance }) => ({
        id: rule.positionId,
        ranks: rule.requiredCriteria.rank,
        provenance,
      })),
    ).toEqual([
      {
        id: 'synthetic-station-7-engine-seat',
        ranks: ['FF'],
        provenance: {
          requirements: ['synthetic-inspector'],
          scoring: ['synthetic-inspector'],
          priorities: ['synthetic-inspector'],
          matched: ['synthetic-inspector'],
        },
      },
    ]);
  });

  it('ranks a newly named specialty from frozen evidence and configured points', () => {
    const policy = FrozenAnnualSpecialtyPolicySchema.parse({
      id: 'synthetic-new-specialty',
      label: 'Synthetic new specialty',
      mode: 'PRIORITY_ONLY',
      opportunityPositionIds: ['synthetic-new-seat'],
      requiredCredentialNames: ['Prerequisite'],
      requiredSpecialtyCodes: [],
      points: [{ credentialName: 'Training B', value: 7 }],
      tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
    });
    expect(
      rankFrozenSpecialtyCandidates({
        policy,
        evaluationOn: '2026-09-12',
        members: [
          {
            memberId: 1,
            rscSeniority: 1,
            rankSeniority: 1,
            credentialNames: ['Prerequisite'],
            specialtyQualifications: [],
          },
          {
            memberId: 2,
            rscSeniority: 2,
            rankSeniority: 2,
            credentialNames: ['Prerequisite', 'Training B'],
            specialtyQualifications: [],
          },
          {
            memberId: 3,
            rscSeniority: 3,
            rankSeniority: 3,
            credentialNames: ['Training B'],
            specialtyQualifications: [],
          },
        ],
      }),
    ).toEqual([
      { memberId: 2, points: 7 },
      { memberId: 1, points: 0 },
    ]);
  });

  it('changes contact-attempt and specialty capacity thresholds by configuration', () => {
    const state = {
      ...initializeAnnualOperations({ preferenceSheets: [] }),
      contactAttempts: [
        { memberId: 1, actorMemberId: 99, method: 'PHONE' as const, atMs: 1 },
        { memberId: 1, actorMemberId: 99, method: 'TEXT' as const, atMs: 2 },
      ],
    };
    expect(declareUnreachable(state, execution2026, { memberId: 1, actorMemberId: 99 })).toEqual({
      ok: false,
      code: 'CONTACT_ATTEMPTS_INCOMPLETE',
    });
    const amended = {
      ...execution2026,
      contact: { ...execution2026.contact, minimumAttempts: 2 },
      aDay: {
        ...execution2026.aDay,
        specialtyMaximums: { ...execution2026.aDay.specialtyMaximums, SWAT: 2 },
      },
    };
    expect(declareUnreachable(state, amended, { memberId: 1, actorMemberId: 99 })).toEqual({
      ok: true,
      state: { ...state, unresolvedMemberIds: [1] },
    });
    expect(
      validateSpecialtyADayMaximum({ specialty: 'SWAT', existingCount: 1, policy: execution2026 }),
    ).toEqual({ ok: false, code: 'SPECIALTY_A_DAY_MAX_REACHED' });
    expect(
      validateSpecialtyADayMaximum({ specialty: 'SWAT', existingCount: 1, policy: amended }),
    ).toEqual({ ok: true });
    expect(state.unresolvedMemberIds).toEqual([]);
  });
});

describe('unified Bid: configured frozen stage projection', () => {
  // Deliberately minimal pure-function inputs; this is not a valid persisted
  // snapshot or a substitute for the schema/HTTP/canonical-command tests.
  const snapshot = {
    v: 3,
    members: [
      { memberId: 1, pool: 'FF', rscSeniority: 20, rankSeniority: 1 },
      { memberId: 2, pool: 'FF', rscSeniority: 10, rankSeniority: 2 },
      { memberId: 3, pool: 'FF', rscSeniority: 30, rankSeniority: 3 },
    ],
  } as unknown as BidSessionPolicySnapshot;
  function stages(
    rows: Array<{ id: string; order: number; memberIds: number[] }>,
  ): FrozenLiveBidPolicy {
    return {
      stages: rows.map((row) => ({
        ...row,
        label: row.id,
        kind: 'MIXED',
        opportunityPositionIds: [`${row.id}-seat`],
      })),
    } as unknown as FrozenLiveBidPolicy;
  }

  it('accepts stage reordering/addition/removal and changed populations at the pure projection boundary', () => {
    const one = stages([{ id: 'all', order: 0, memberIds: [3, 1, 2] }]);
    const two = stages([
      { id: 'later', order: 20, memberIds: [1, 2] },
      { id: 'first', order: 10, memberIds: [3] },
    ]);
    const three = stages([
      { id: 'one', order: 2, memberIds: [1] },
      { id: 'two', order: 1, memberIds: [2] },
      { id: 'three', order: 0, memberIds: [3] },
    ]);
    expect([one, two, three].map((policy) => computeFrozenStageOrder(snapshot, policy))).toEqual([
      {
        ok: true,
        entries: [
          { ordinal: 1, memberId: 2, stageId: 'all' },
          { ordinal: 2, memberId: 1, stageId: 'all' },
          { ordinal: 3, memberId: 3, stageId: 'all' },
        ],
      },
      {
        ok: true,
        entries: [
          { ordinal: 1, memberId: 3, stageId: 'first' },
          { ordinal: 2, memberId: 2, stageId: 'later' },
          { ordinal: 3, memberId: 1, stageId: 'later' },
        ],
      },
      {
        ok: true,
        entries: [
          { ordinal: 1, memberId: 3, stageId: 'three' },
          { ordinal: 2, memberId: 2, stageId: 'two' },
          { ordinal: 3, memberId: 1, stageId: 'one' },
        ],
      },
    ]);
    expect(isPositionAllowedForCurrentStage(two, 'first', 'first-seat')).toBe(true);
    expect(isPositionAllowedForCurrentStage(two, 'first', 'later-seat')).toBe(false);
    expect(
      computeFrozenStageOrder(snapshot, stages([{ id: 'missing', order: 0, memberIds: [1, 2] }])),
    ).toEqual({ ok: false, code: 'stage_coverage_incomplete' });
  });
});
