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
  ['18366', 201, 'LT'],
  ['16563', 202, 'CPT'],
  ['20730', 203, 'FF'],
  ['19953', 204, 'LT'],
  ['24506', 205, 'FF'],
  ['20745', 206, 'FF'],
  ['18158', 207, 'DC'],
  ['16584', 208, 'FF'],
  ['14326', 209, 'CPT'],
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
          specialties: [
            {
              id: '2026-fire-investigator',
              label: 'Fire Investigator preference',
              mode: 'INTERRUPTING',
              opportunityPositionIds: ['A101'],
              requiredCredentialNames: [],
              requiredSpecialtyCodes: [],
              points: [],
              tieBreakChain: ['POINTS', 'RSC_SENIORITY', 'RANK_SENIORITY'],
            },
          ],
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
            execution: {
              timing: 'SIMULTANEOUS',
              timingExceptions: [],
              officersPerGroup: null,
              sourceRef: 'Synthetic ordinary A-Day source',
              constraints: [],
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
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(REQUIRED_2026_ADMIN_EMPLOYEE_IDS).toEqual(['20731', '19545', '20732', '18156']);
    expect(result.content.pendingPolicy).toBeUndefined();
    expect(result.content.settings).toMatchObject({
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 300,
      credentialEvaluationOn: '2026-09-24',
      personnelEvaluationOn: '2026-09-24',
    });
    const policy = result.content.policy?.executionPolicy;
    expect(policy?.stages[0]?.memberIds).toEqual([103, 105, 203, 205, 206]);
    expect(
      policy?.actionPermissions.every(
        (grant) => grant.actorMemberIds.join(',') === '101,102,103,104',
      ),
    ).toBe(true);
    expect(policy?.annualOperations).toMatchObject({
      contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION' },
      aDay: {
        min: null,
        max: null,
        captainDcMax: null,
        specialtyMaximums: { MARINE_FLOAT: 2 },
        execution: {
          timing: 'SIMULTANEOUS',
          timingExceptions: [
            {
              id: '2026-specialized-award-deferred-a-day',
              label: 'Specialized award A-Day at ordinary rank turn',
              timing: 'AFTER_POSITION_SELECTION',
              sourceRef: '2026-09-24 administrator decision: specialized award A-Day timing',
              positionIds: ['A101'],
              profileIds: [],
            },
          ],
        },
      },
    });
    expect(policy?.stages.find((stage) => stage.id === 'days-captains')?.memberIds).toEqual([
      102, 106, 202, 207,
    ]);
    expect(policy?.stages.find((stage) => stage.id === 'captains')?.memberIds).toEqual([
      102, 106, 202, 207,
    ]);
    expect(policy?.stages.flatMap((stage) => stage.memberIds)).not.toContain(208);
    expect(policy?.stages.flatMap((stage) => stage.memberIds)).not.toContain(209);
    expect(policy?.annualOperations?.membershipDistributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '2026-swat-medics',
          memberIds: [201, 202, 203, 204, 205, 206],
          minimumPerShift: 2,
          maximumPerShift: 2,
          maximumPerADay: 1,
        }),
      ]),
    );
    expect(
      result.content.policy?.stageParticipantSources?.map(
        (source) => source.participantSource.type,
      ),
    ).toEqual(['EXPLICIT_MEMBERS', 'EXPLICIT_MEMBERS', 'EXPLICIT_MEMBERS']);
    expect(result.content.sourceDecisions[0]?.status).toBe('OPEN');
  });

  it('keeps source-authorized bidders when the broader directory has not classified status yet', () => {
    const unresolved = options.map((member) => ({
      ...member,
      employmentStatus: 'unknown' as const,
    }));
    const result = applyKnown2026Setup(content(), unresolved);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.content.policy?.executionPolicy.stages[0]?.memberIds).toEqual([
      103, 105, 203, 205, 206,
    ]);
    expect(
      result.content.policy?.executionPolicy.stages.flatMap((stage) => stage.memberIds),
    ).toContain(207);
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
