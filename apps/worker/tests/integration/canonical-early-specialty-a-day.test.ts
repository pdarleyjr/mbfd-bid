import { createHash } from 'node:crypto';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

// Synthetic engineering fixture: early specialty winner selects A-Day at the
// ordinary seniority turn through the canonical D1 command boundary.
const SESSION = 'synthetic-early-specialty-session';
const SEAT = 'synthetic-specialty-seat';
const SECOND = 'synthetic-ordinary-seat';
const THIRD = 'synthetic-third-seat';
const RELATED = 'synthetic-related-specialty-seat';
const SENIOR = 10001;
const EARLY = 10002;
const JUNIOR = 10003;
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

type Limit = 'scoped' | 'membership';

function syntheticPolicy(limit: Limit, rank: 'CPT' | 'LT' | 'FF') {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-early-specialty-policy',
    stages: [
      {
        id: 'synthetic-ff',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [SENIOR, EARLY, JUNIOR],
        opportunityPositionIds: [SEAT, SECOND, THIRD, RELATED],
        kind: rank === 'CPT' ? 'CAPTAIN' : rank === 'LT' ? 'LIEUTENANT' : 'FIREFIGHTER',
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
      actorMemberIds: [SENIOR],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['synthetic-ff'],
      requiredTopologyPositionIds: [SEAT, SECOND, THIRD, RELATED],
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: [SEAT, RELATED],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
          scoring: {
            v: 1,
            total: [],
            so: [],
            mo: [],
            orderedPreference: {
              mode: 'ORDERED_QUALIFICATIONS',
              sourceRef: 'Synthetic primary qualification preference',
              criteria: [{ credential: 'IAAI', alternatives: [], requiresAll: [] }],
            },
          },
          rankingChannel: 'total',
        },
      ],
      ...(limit === 'membership'
        ? {
            membershipDistributions: [
              {
                id: 'synthetic-swat',
                label: 'Synthetic SWAT',
                sourceRef: 'Synthetic SWAT roster',
                sourceDecisionId: 'synthetic-swat-decision',
                membershipSource: 'REVIEWED_EXISTING_MEMBERS',
                memberIds: [SENIOR, EARLY],
                shifts: ['A'],
                minimumPerShift: 0,
                maximumPerShift: 2,
                maximumPerADay: 1,
              },
            ],
          }
        : {}),
      contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: null,
        max: null,
        captainDcMax: null,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing: 'SIMULTANEOUS',
          timingExceptions: [
            {
              id: 'synthetic-early-award',
              label: 'Specialized award A-Day at ordinary rank turn',
              timing: 'AFTER_POSITION_SELECTION',
              sourceRef: 'synthetic: specialized award A-Day timing',
              positionIds: [SEAT, RELATED],
              profileIds: [],
            },
          ],
          officersPerGroup: null,
          sourceRef: 'synthetic:aday-policy',
          constraints:
            limit === 'scoped'
              ? [
                  {
                    id: 'synthetic-de-marine-limit',
                    label: 'Synthetic DE/Marine limit',
                    sourceRef: 'synthetic:scoped-limit',
                    maximum: 1,
                    positionIds: [SEAT, SECOND],
                    memberIds: [],
                    ranks: [],
                    shifts: ['A'],
                  },
                ]
              : [],
        },
      },
    },
  });
}

describe.each(['CPT', 'LT', 'FF'] as const)('early specialty canonical %s rank', (rank) => {
  describe.each(['scoped', 'membership'] as const)(
    'canonical early specialty A-Day at ordinary turn (%s A-Day limit)',
    (limit) => {
      let h: TestD1;
      let snapshot: PinnedBidSessionPolicySnapshot;
      let policy: FrozenLiveBidPolicy;
      let state: BidSessionState;
      let nextId: number;
      let commandCounter: number;

      beforeEach(async () => {
        h = await setupTestD1();
        h.sqlite.pragma('foreign_keys = ON');
        nextId = 0;
        commandCounter = 0;
        const settings = {
          v: 3,
          expectedDurationDays: 2,
          turnTimerSeconds: 180,
          credentialEvaluationOn: '2027-01-01',
          personnelEvaluationOn: '2027-01-01',
          livePolicy: syntheticPolicy(limit, rank),
        };
        h.sqlite.exec(`
        INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
          VALUES (${SENIOR},'synthetic-senior','Synthetic','Senior','${rank}','${rank}',1,1,1),
            (${EARLY},'synthetic-early','Synthetic','Early','${rank}','${rank}',2,1,1),
            (${JUNIOR},'synthetic-junior','Synthetic','Junior','${rank}','${rank}',3,1,1);
        INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
        INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic rules');
        INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision)
          VALUES (2027,'configuring','2027.1','2027.1',3);
      `);
        for (const [id, name] of [
          [SEAT, 'Synthetic specialty'],
          [SECOND, 'Synthetic ordinary'],
          [THIRD, 'Synthetic third'],
          [RELATED, 'Synthetic related specialty'],
        ] as const) {
          h.sqlite
            .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
            VALUES (?,'2027.1','A','7','Combat','Synthetic Engine','${rank}',?)`)
            .run(id, name);
          h.sqlite
            .prepare(`INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
            VALUES ('2027.1',?,'2027.1','{"rank":["${rank}"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]')`)
            .run(id);
        }
        h.sqlite
          .prepare('UPDATE bid_years SET config_json=? WHERE year=2027')
          .run(JSON.stringify(settings));
        const captured = await captureBidDefinitionSource(h.env.DB, 2027);
        if (!captured.ok) throw new Error(JSON.stringify(captured));
        captured.content.sourceDecisions.push({
          issueId: 'synthetic-swat-decision',
          title: 'Synthetic SWAT roster',
          question: 'Which members?',
          area: 'annual-policy',
          status: 'RESOLVED',
          decision: 'Synthetic reviewed members.',
          sourceRef: 'Synthetic SWAT roster',
          effectiveOn: '2027-01-01',
        });
        const saved = await saveBidDefinition(h.env.DB, {
          year: 2027,
          key: 'synthetic-early-specialty-adoption',
          actorSubject: 'synthetic-senior',
          actorId: SENIOR,
          expected: { kind: 'legacy', sourceToken: captured.sourceToken },
          reason: 'Synthetic early specialty fixture',
          intent: { operation: 'save', content: captured.content },
        });
        if (!saved.ok) throw new Error(JSON.stringify(saved));
        const version = await loadBidDefinitionVersion(
          h.env.DB,
          2027,
          String(saved.response.versionId),
        );
        if (!version.ok) throw new Error(JSON.stringify(version));
        if (version.content.settings?.v !== 3) throw new Error('Synthetic V3 settings required');
        policy = structuredClone(version.content.settings.livePolicy);
        const participation = new Map(
          version.content.participation.map((entry) => [entry.positionId, entry.bidParticipation]),
        );
        const body = BidSessionPolicySnapshotSchema.parse({
          v: 3,
          ruleBookVersion: version.row.rule_book_version,
          ruleBookRevision: version.row.rule_book_revision,
          positionTemplateVersion: version.row.position_template_version,
          configurationRevision: version.row.version_number,
          settings: version.content.settings,
          credentialEvaluationOn: '2027-01-01',
          capturedAtMs: NOW,
          members: [SENIOR, EARLY, JUNIOR].map((memberId) => ({
            memberId,
            pool: rank === 'FF' ? 'FF' : 'OFC',
            rscSeniority: memberId - 10000,
            rankSeniority: memberId - 10000,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank,
            isProbationary: false,
            credentialNames: memberId === SENIOR ? [] : ['IAAI'],
            specialtyQualifications: [],
          })),
          ruleBookMaterial: {
            v: 1,
            rules: version.content.rules.map((rule) => ({
              positionId: rule.positionId,
              requiredCriteriaJson: rule.requiredCriteriaJson,
              pointsPreferenceJson: rule.pointsPreferenceJson,
              tieBreakChainJson: rule.tieBreakChainJson,
              ruleBookVersion: version.row.rule_book_version,
              templateVersion: version.row.position_template_version,
            })),
            positions: version.content.positions.map((position) => ({
              ...position,
              templateVersion: version.row.position_template_version,
              bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
            })),
          },
        });
        if (body.v !== 3) throw new Error('Synthetic V3 snapshot required');
        snapshot = {
          ...body,
          bidDefinition: {
            v: 1,
            bidSessionId: SESSION,
            bidYear: 2027,
            versionId: version.row.id,
            versionSha256: version.sha256,
            contextSha256: bidDefinitionContextHash(body),
          },
        };
        const json = JSON.stringify(snapshot);
        h.sqlite
          .prepare(`INSERT INTO bid_sessions
          (id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
          VALUES (?,2027,?,'position_bid',1,180,2,?)`)
          .run(SESSION, NOW, JSON.stringify(snapshot.settings));
        h.sqlite
          .prepare(`INSERT INTO bid_session_policy_snapshots
          (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,
           bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
          VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(
            SESSION,
            snapshot.ruleBookVersion,
            snapshot.positionTemplateVersion,
            snapshot.ruleBookRevision,
            json,
            NOW,
            version.row.id,
            version.sha256,
            digest(json),
            snapshot.bidDefinition.contextSha256,
          );
        expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual({
          snapshot,
          error: null,
        });
        state = {
          ...emptyBidSessionState(SESSION),
          currentPhase: 'position_bid',
          currentBidderId: SENIOR,
          turnStartedAtMs: NOW,
          lastSeq: 0,
          bidOrder: [SENIOR, EARLY, JUNIOR].map((memberId) => ({
            ordinal: memberId - 10000,
            memberId,
            pool: rank === 'FF' ? ('FF' as const) : ('OFC' as const),
            stageId: 'synthetic-ff',
          })),
        };
      });

      afterEach(async () => {
        await teardownTestD1(h);
      });

      function common() {
        commandCounter += 1;
        return {
          v: 1 as const,
          commandId: `c1c1c1c1-0b60-4dcc-aa6b-${String(commandCounter).padStart(12, '0')}`,
          bidSessionId: SESSION,
          expectedSeq: state.lastSeq,
          actor: { id: SENIOR, role: 'admin' as const },
          reason: 'Synthetic early specialty A-Day regression',
          evidenceReference: 'synthetic:early-specialty',
        };
      }
      async function apply(command: LiveBidCommand) {
        const result = await commitLiveBidCommand({
          db: h.env.DB,
          state,
          command,
          policy,
          nowMs: () => NOW + 1000 * (commandCounter + 1),
          newId: () => `synthetic-early-specialty-${++nextId}`,
        });
        if (result.canonicalState) state = result.canonicalState;
        return result;
      }
      async function earlyAward() {
        expect(
          (
            await apply({
              ...common(),
              type: 'live.start_specialty_adjudication',
              specialtyId: 'synthetic-specialty',
              positionId: SEAT,
              candidateMemberIds: [EARLY, JUNIOR],
            })
          ).result.kind,
        ).toBe('accepted');
        const accepted = await apply({
          ...common(),
          type: 'live.resolve_specialty_candidate',
          memberId: EARLY,
          outcome: 'ACCEPT',
        });
        expect(accepted.result.kind).toBe('accepted');
        expect(
          (await apply({ ...common(), type: 'live.close_specialty_adjudication' })).result.kind,
        ).toBe('accepted');
      }

      it('offers the next higher-priority member a related seat in one continuous review, then collects both A-Days at ordinary rank turns', async () => {
        expect(
          (
            await apply({
              ...common(),
              type: 'live.start_specialty_adjudication',
              specialtyId: 'synthetic-specialty',
              positionId: SEAT,
              candidateMemberIds: [EARLY, JUNIOR],
            })
          ).result.kind,
        ).toBe('accepted');
        expect(
          (
            await apply({
              ...common(),
              type: 'live.resolve_specialty_candidate',
              memberId: EARLY,
              outcome: 'ACCEPT',
            })
          ).result.kind,
        ).toBe('accepted');
        expect(state.live?.specialty).toMatchObject({ candidateCursor: 1 });
        const relatedAwardCommand: LiveBidCommand = {
          ...common(),
          type: 'live.resolve_specialty_candidate',
          memberId: JUNIOR,
          outcome: 'ACCEPT',
          positionId: RELATED,
        };
        const related = await apply(relatedAwardCommand);
        expect(related.result.kind).toBe('accepted');
        expect(state.live?.specialty).toBeNull();
        expect(state.fills[SEAT]?.aDay).toBeUndefined();
        expect(state.fills[RELATED]?.aDay).toBeUndefined();
        expect(await apply(relatedAwardCommand)).toEqual(related);
        expect(
          (
            await apply({
              ...common(),
              type: 'live.record_selection',
              memberId: SENIOR,
              positionId: SECOND,
              aDay: 'G1',
            })
          ).result.kind,
        ).toBe('accepted');
        expect(state).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: EARLY });
        expect(
          (await apply({ ...common(), type: 'live.record_a_day', memberId: EARLY, aDay: 'G2' }))
            .result.kind,
        ).toBe('accepted');
        expect(state).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: JUNIOR });
        expect(
          (await apply({ ...common(), type: 'live.record_a_day', memberId: JUNIOR, aDay: 'G3' }))
            .result.kind,
        ).toBe('accepted');
        expect(state).toMatchObject({ currentPhase: 'complete', currentBidderId: null });
        expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(state);
      });

      it('records the early winner A-Day at their ordinary turn before the junior member, once', async () => {
        await earlyAward();
        expect(state).toMatchObject({ currentPhase: 'position_bid', currentBidderId: SENIOR });
        expect(state.fills[SEAT]).toMatchObject({ memberId: EARLY });
        expect(state.fills[SEAT]?.aDay).toBeUndefined();

        const senior = await apply({
          ...common(),
          type: 'live.record_selection',
          memberId: SENIOR,
          positionId: SECOND,
          aDay: 'G1',
        });
        expect(senior.result.kind).toBe('accepted');
        expect(state).toMatchObject({
          currentPhase: 'a_day_bid',
          currentBidderId: EARLY,
          queueCursor: 1,
        });

        const restarted = await loadCanonicalBidSessionState(h.env.DB, SESSION);
        expect(restarted).toEqual(state);

        const secondSeat = await apply({
          ...common(),
          type: 'live.record_selection',
          memberId: EARLY,
          positionId: THIRD,
          aDay: 'G2',
        });
        expect(secondSeat.result).toMatchObject({ kind: 'rejected' });

        const blocked = await apply({
          ...common(),
          type: 'live.record_a_day',
          memberId: EARLY,
          aDay: 'G1',
        });
        expect(blocked.result).toMatchObject({
          kind: 'rejected',
          code: limit === 'scoped' ? 'SCOPED_A_DAY_MAXIMUM' : 'MEMBERSHIP_A_DAY_MAXIMUM_REACHED',
        });

        const aDayCommand: LiveBidCommand = {
          ...common(),
          type: 'live.record_a_day',
          memberId: EARLY,
          aDay: 'G2',
        };
        const aDay = await apply(aDayCommand);
        expect(aDay.result).toMatchObject({ kind: 'accepted' });
        expect(state).toMatchObject({
          currentPhase: 'position_bid',
          currentBidderId: JUNIOR,
          queueCursor: 2,
        });
        expect(state.aDay?.picks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ memberId: SENIOR, aDay: 'G1' }),
            expect.objectContaining({ memberId: EARLY, aDay: 'G2' }),
          ]),
        );
        const afterADay = structuredClone(state);
        const replay = await commitLiveBidCommand({
          db: h.env.DB,
          state,
          command: aDayCommand,
          policy,
          nowMs: () => NOW + 999_999,
          newId: () => 'synthetic-replay-unused',
        });
        expect(replay).toEqual(aDay);
        const stale = await apply({ ...aDayCommand, commandId: common().commandId });
        expect(stale.result).toMatchObject({ kind: 'rejected', code: 'STALE_SEQUENCE' });
        expect(state).toEqual(afterADay);

        const junior = await apply({
          ...common(),
          type: 'live.record_selection',
          memberId: JUNIOR,
          positionId: THIRD,
          aDay: 'G3',
        });
        expect(junior.result.kind).toBe('accepted');
        expect(state).toMatchObject({ currentPhase: 'complete', currentBidderId: null });
        expect(Object.values(state.fills).filter((fill) => fill.memberId === EARLY)).toHaveLength(
          1,
        );
        expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(state);
        expect(h.sqlite.prepare('SELECT count(*) AS count FROM bids').get()).toEqual({ count: 0 });
      });

      it('settles unreachable A-Day contact after restart and preserves receipt replay', async () => {
        await earlyAward();
        expect(
          (
            await apply({
              ...common(),
              type: 'live.record_selection',
              memberId: SENIOR,
              positionId: SECOND,
              aDay: 'G1',
            })
          ).result.kind,
        ).toBe('accepted');
        expect(
          (
            await apply({
              ...common(),
              type: 'live.record_contact_attempt',
              memberId: EARLY,
              method: 'PHONE',
            })
          ).result.kind,
        ).toBe('accepted');
        expect(
          (await apply({ ...common(), type: 'live.disposition', disposition: 'UNREACHABLE' }))
            .result.kind,
        ).toBe('accepted');
        expect(state.annual?.unresolvedMemberIds).toEqual([EARLY]);
        expect(
          (
            await apply({
              ...common(),
              type: 'live.record_selection',
              memberId: JUNIOR,
              positionId: THIRD,
              aDay: 'G3',
            })
          ).result.kind,
        ).toBe('accepted');
        const restarted = await loadCanonicalBidSessionState(h.env.DB, SESSION);
        if (!restarted) throw new Error('Persisted state required');
        state = restarted;
        expect(state).toMatchObject({ currentPhase: 'a_day_bid', currentBidderId: EARLY });
        const aDayCommand: LiveBidCommand = {
          ...common(),
          type: 'live.record_a_day',
          memberId: EARLY,
          aDay: 'G2',
        };
        const recorded = await apply(aDayCommand);
        expect(recorded.result.kind).toBe('accepted');
        expect(state).toMatchObject({
          currentPhase: 'complete',
          annual: { unresolvedMemberIds: [] },
        });
        expect(state.annual?.contactAttempts).toEqual([
          expect.objectContaining({ memberId: EARLY, method: 'PHONE' }),
        ]);
        expect(state.live?.dispositions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ memberId: EARLY, disposition: 'UNREACHABLE' }),
          ]),
        );
        const afterADay = structuredClone(state);
        expect(await apply(aDayCommand)).toEqual(recorded);
        expect(state).toEqual(afterADay);
        expect(
          (await apply({ ...aDayCommand, commandId: common().commandId })).result,
        ).toMatchObject({ kind: 'rejected', code: 'STALE_SEQUENCE' });
        expect((await apply({ ...common(), type: 'live.complete_session' })).result.kind).toBe(
          'accepted',
        );
        expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(state);
        expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual({
          snapshot,
          error: null,
        });
        expect(Object.values(state.fills).filter((fill) => fill.memberId === EARLY)).toHaveLength(
          1,
        );
        expect(h.sqlite.prepare('SELECT count(*) AS count FROM bids').get()).toEqual({ count: 0 });
      });

      it('selects the specialty seat and A-Day together when the requester takes it at their own turn', async () => {
        expect(
          (
            await apply({
              ...common(),
              type: 'live.start_specialty_adjudication',
              specialtyId: 'synthetic-specialty',
              positionId: SEAT,
              candidateMemberIds: [EARLY, JUNIOR],
            })
          ).result.kind,
        ).toBe('accepted');
        for (const memberId of [EARLY, JUNIOR])
          expect(
            (
              await apply({
                ...common(),
                type: 'live.resolve_specialty_candidate',
                memberId,
                outcome: 'DECLINE',
              })
            ).result.kind,
          ).toBe('accepted');
        const withoutADay = await apply({
          ...common(),
          type: 'live.record_selection',
          memberId: SENIOR,
          positionId: SEAT,
        });
        expect(withoutADay.result).toMatchObject({
          kind: 'rejected',
          code: 'A_DAY_REQUIRED_WITH_SELECTION',
        });
        const ownTurn = await apply({
          ...common(),
          type: 'live.record_selection',
          memberId: SENIOR,
          positionId: SEAT,
          aDay: 'G4',
        });
        expect(ownTurn.result.kind).toBe('accepted');
        expect(state.fills[SEAT]).toMatchObject({ memberId: SENIOR, aDay: 'G4' });
        expect(state).toMatchObject({ currentPhase: 'position_bid', currentBidderId: EARLY });
      });
    },
  );
});
