import {
  BidDefinitionContentSchema,
  BidDispositionSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_2026_ADMIN_EMPLOYEE_IDS,
  applyKnown2026Setup,
} from '../../app/admin/current-bid/known-2026-setup';

const members = [
  ['20731', 101, 'LT'],
  ['19545', 102, 'CPT'],
  ['20732', 103, 'FF'],
  ['18156', 104, 'FF'],
  ['99999', 105, 'FF'],
  ['99998', 106, 'CPT'],
] as const;

function content() {
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: 2026,
    settings: null,
    notes: { bid: null, positions: null },
    policy: null,
    planning: null,
    authoring: null,
    positions: [],
    rules: [],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [
      {
        issueId: 'working-assumption',
        title: 'Synthetic Real-only question',
        question: 'What final value applies?',
        area: 'annual-policy',
        status: 'OPEN',
        decision: '',
        sourceRef: 'Synthetic policy source',
        effectiveOn: '2026-01-01',
        blockingClassification: 'BLOCKS_REAL_BID_ACTIVATION',
        affectedScopes: ['contact-policy'],
      },
    ],
    pendingPolicy: {
      policyText: 'Synthetic 2026 policy',
      stageParticipantSources: [
        {
          stageId: 'firefighters',
          sourceRef: 'Synthetic rank-order source',
          participantSource: {
            type: 'FILTER',
            active: true,
            bidParticipation: 'BIDDABLE',
            ranks: ['FF'],
          },
          ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
        },
        {
          stageId: 'days-captains',
          sourceRef: 'Synthetic assignment snapshot and rank-order source',
          participantSource: {
            type: 'FILTER',
            active: true,
            bidParticipation: 'BIDDABLE',
            ranks: ['CPT'],
          },
          ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
        },
        {
          stageId: 'captains',
          sourceRef: 'Synthetic assignment snapshot and rank-order source',
          participantSource: {
            type: 'FILTER',
            active: true,
            bidParticipation: 'BIDDABLE',
            ranks: ['CPT'],
          },
          ordering: [{ key: 'RANK_SENIORITY', direction: 'ASC' }],
        },
      ],
      executionPolicy: {
        v: 1,
        policyRevision: '2026-source-review',
        stages: [
          {
            id: 'firefighters',
            label: 'Firefighters',
            order: 0,
            memberIds: [],
            opportunityPositionIds: ['A101'],
            kind: 'FIREFIGHTER',
          },
          {
            id: 'days-captains',
            label: 'Days Captains',
            order: 1,
            memberIds: [],
            opportunityPositionIds: ['A101'],
            kind: 'D_SHIFT',
          },
          {
            id: 'captains',
            label: 'Captains',
            order: 2,
            memberIds: [],
            opportunityPositionIds: ['A101'],
            kind: 'CAPTAIN',
          },
        ],
        dispositions: BidDispositionSchema.options.map((disposition) => ({
          disposition,
          advances: true,
          returns: false,
          returnStageId: null,
          retainsLaterSelectionRights: false,
          terminal: false,
          requiresReason: true,
          requiresEvidence: false,
          contactPolicyReference: null,
        })),
        actionPermissions: LiveBidActionSchema.options.map((action) => ({
          action,
          actorMemberIds: [],
        })),
        specialtyCatalogReference: null,
        aDayPolicyReference: '2026 Bid Policy final, A-Day rules',
        transitionPolicyReference: null,
        publicationPolicyReference: null,
        annualOperations: {
          v: 1,
          stageOrder: ['firefighters', 'days-captains', 'captains'],
          requiredTopologyPositionIds: ['A101'],
          contact: {
            minimumAttempts: null,
            timingMode: 'OPERATOR_DISCRETION',
            durationSeconds: null,
          },
          aDay: {
            combatGroups: ['G1', 'G2', 'G3', 'G4'],
            min: null,
            max: null,
            captainDcMax: null,
            specialtyMaximums: {
              MARINE_ASSIGNED: 2,
              MARINE_FLOAT: null,
              DE: 2,
              SWAT: 2,
            },
          },
        },
      },
    },
  });
}

const options = members.map(([employeeId, id, rank]) => ({
  value: String(id),
  label: `Synthetic ${employeeId}`,
  employeeId,
  rank,
  bidCategory: rank === 'FF' ? ('FF' as const) : ('OFC' as const),
  employmentStatus: 'active' as const,
  priorPositionId: id === 102 ? 'D-CAPTAIN-1' : id === 106 ? 'A-CAPTAIN-1' : 'A-FF-1',
}));

describe('known 2026 setup', () => {
  it('creates a configurable Mock baseline and grants every action to the four required admins', () => {
    const result = applyKnown2026Setup(content(), options);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(REQUIRED_2026_ADMIN_EMPLOYEE_IDS).toEqual(['20731', '19545', '20732', '18156']);
    expect(result.content.pendingPolicy).toBeUndefined();
    expect(result.content.settings).toMatchObject({
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 300,
      credentialEvaluationOn: '2026-09-30',
      personnelEvaluationOn: '2026-08-28',
    });
    const policy = result.content.policy?.executionPolicy;
    expect(policy?.stages[0]?.memberIds).toEqual([103, 104, 105]);
    expect(
      policy?.actionPermissions.every(
        (grant) => grant.actorMemberIds.join(',') === '101,102,103,104',
      ),
    ).toBe(true);
    expect(policy?.annualOperations).toMatchObject({
      contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION' },
      aDay: { min: 0, max: 6, captainDcMax: 6, specialtyMaximums: { MARINE_FLOAT: 2 } },
    });
    expect(policy?.stages.find((stage) => stage.id === 'days-captains')?.memberIds).toEqual([102]);
    expect(policy?.stages.find((stage) => stage.id === 'captains')?.memberIds).toEqual([106]);
    expect(
      result.content.policy?.stageParticipantSources?.map(
        (source) => source.participantSource.type,
      ),
    ).toEqual(['EXPLICIT_MEMBERS', 'EXPLICIT_MEMBERS', 'EXPLICIT_MEMBERS']);
    expect(result.content.sourceDecisions[0]?.status).toBe('OPEN');
  });

  it('fails visibly instead of granting partial authority when a required admin is missing', () => {
    const result = applyKnown2026Setup(
      content(),
      options.filter((member) => member.employeeId !== '18156'),
    );
    expect(result).toEqual({
      ok: false,
      message: 'Required administrator employee ID 18156 is missing from the member catalog.',
    });
  });
});
