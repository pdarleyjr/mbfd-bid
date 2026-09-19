import { createHash } from 'node:crypto';

import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitLiveBidCommand } from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SESSION = 'synthetic-command-integrity-session';
const SEAT = 'synthetic-command-integrity-seat';
const PRIOR_SEAT = 'synthetic-prior-seat';
const MEMBER = 10001;
const SECOND = 10002;
const SPARE = 'synthetic-spare-seat';
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const KEY = 'b8619c19-0b60-4dcc-aa6b-eec70a733e65';
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Synthetic, schema-valid execution inputs only. The real store seals the
// definition; manually inserting a valid snapshot here does not publish a Bid
// or establish that this private draft is authorized to start Live execution.
function syntheticPolicy() {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-command-integrity-policy',
    stages: [
      {
        id: 'synthetic-ff',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [MEMBER, SECOND],
        opportunityPositionIds: [SEAT, PRIOR_SEAT, SPARE],
        kind: 'FIREFIGHTER',
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
      actorMemberIds: [MEMBER],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['synthetic-ff'],
      requiredTopologyPositionIds: [SEAT, PRIOR_SEAT, SPARE],
      specialties: [
        {
          id: 'synthetic-specialty',
          label: 'Synthetic specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: [SEAT],
          requiredCredentialNames: [],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['RSC_SENIORITY'],
        },
      ],
      membershipDistributions: [
        {
          id: 'synthetic-team',
          label: 'Synthetic fixed membership',
          sourceRef: 'synthetic:team',
          sourceDecisionId: 'synthetic-team-source',
          membershipSource: 'REVIEWED_EXISTING_MEMBERS',
          memberIds: [MEMBER, SECOND],
          shifts: ['A'],
          minimumPerShift: 2,
          maximumPerShift: 2,
          maximumPerADay: 1,
        },
      ],
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 2,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing: 'SIMULTANEOUS',
          officersPerGroup: null,
          sourceRef: 'synthetic:aday-command-policy',
          constraints: [
            {
              id: 'synthetic-member-limit',
              label: 'Synthetic member limit',
              sourceRef: 'synthetic:member-limit',
              maximum: 10,
              positionIds: [],
              memberIds: [MEMBER, SECOND],
              ranks: [],
              shifts: ['A'],
            },
          ],
        },
      },
    },
  });
}

describe.each(['live.record_selection', 'live.force_selection'] as const)(
  'canonical fixed membership %s',
  (commandType) => {
    let h: TestD1;
    let snapshot: PinnedBidSessionPolicySnapshot;
    let policy: FrozenLiveBidPolicy;
    let state: BidSessionState;
    let nextId: number;

    beforeEach(async () => {
      h = await setupTestD1();
      h.sqlite.pragma('foreign_keys = ON');
      nextId = 0;
      const settings = {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-01',
        personnelEvaluationOn: '2027-01-01',
        livePolicy: syntheticPolicy(),
      };
      h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-command-editor','Synthetic','Editor','FF','FF',1,1,1),(10002,'synthetic-second','Synthetic','Second','FF','FF',2,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic rules');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision)
        VALUES (2027,'configuring','2027.1','2027.1',3);
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":["non_probationary"]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${PRIOR_SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic prior seat');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${PRIOR_SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
    `);
      h.sqlite
        .prepare('UPDATE bid_years SET config_json=? WHERE year=2027')
        .run(JSON.stringify(settings));
      h.sqlite
        .prepare(
          "INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name) SELECT ?,'2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic spare'",
        )
        .run(SPARE);
      h.sqlite
        .prepare(
          'INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) SELECT rule_book_version,?,template_version,required_criteria,points_preference,tie_break_chain FROM position_rules WHERE position_id=?',
        )
        .run(SPARE, SEAT);
      const captured = await captureBidDefinitionSource(h.env.DB, 2027);
      if (!captured.ok) throw new Error(JSON.stringify(captured));
      const saved = await saveBidDefinition(h.env.DB, {
        year: 2027,
        key: 'synthetic-command-adoption',
        actorSubject: 'synthetic-command-editor',
        actorId: MEMBER,
        expected: { kind: 'legacy', sourceToken: captured.sourceToken },
        reason: 'Synthetic command integrity fixture',
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
        members: [
          {
            memberId: MEMBER,
            pool: 'FF',
            rscSeniority: 1,
            specialtyQualifications: [],
            rankSeniority: 1,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: 'FF',
            isProbationary: false,
            credentialNames: ['Synthetic qualification'],
          },
        ].flatMap((member) => [
          member,
          { ...member, memberId: SECOND, rscSeniority: 2, rankSeniority: 2 },
        ]),
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
      VALUES (?,2027,?,'position_bid',?,180,2,?)`)
        .run(SESSION, NOW, 0, JSON.stringify(snapshot.settings));
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
      expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
      state = {
        ...emptyBidSessionState(SESSION),
        currentPhase: 'position_bid',
        currentBidderId: MEMBER,
        turnStartedAtMs: NOW,
        lastSeq: 7,
        bidOrder: [
          { ordinal: 1, memberId: MEMBER, pool: 'FF', stageId: 'synthetic-ff' },
          { ordinal: 2, memberId: SECOND, pool: 'FF', stageId: 'synthetic-ff' },
        ],
      };
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await teardownTestD1(h);
    });

    function commit(suppliedCommand?: LiveBidCommand) {
      const command: LiveBidCommand = suppliedCommand ?? {
        v: 1,
        type: commandType,
        commandId: KEY,
        bidSessionId: SESSION,
        expectedSeq: 7,
        actor: { id: MEMBER, role: 'admin' },
        reason: 'Synthetic frozen eligibility regression only',
        evidenceReference: 'synthetic-nonprobationary-rule',
        memberId: MEMBER,
        positionId: SEAT,
      };
      return commitLiveBidCommand({
        db: h.env.DB,
        state,
        command,
        policy,
        nowMs: () => NOW + 1000,
        newId: () => `synthetic-eligibility-evidence-${++nextId}`,
      });
    }

    function selection(
      memberId: number,
      positionId: string,
      aDay: 'G1' | 'G2' | 'G3',
      expectedSeq: number,
      commandId: string,
    ): LiveBidCommand {
      return {
        v: 1,
        type: commandType,
        commandId,
        bidSessionId: SESSION,
        expectedSeq,
        actor: { id: MEMBER, role: 'admin' },
        reason: 'Synthetic fixed membership constraint',
        evidenceReference: 'synthetic:reviewed-membership',
        memberId,
        positionId,
        aDay,
      };
    }
    function persistedAwards() {
      return {
        state: h.sqlite
          .prepare('SELECT * FROM canonical_bid_session_state WHERE bid_session_id=?')
          .all(SESSION),
        events: h.sqlite
          .prepare('SELECT * FROM bid_command_events WHERE bid_session_id=? ORDER BY seq')
          .all(SESSION),
        outbox: h.sqlite
          .prepare('SELECT * FROM bid_audit_outbox WHERE bid_session_id=? ORDER BY id')
          .all(SESSION),
        receipts: h.sqlite
          .prepare(
            "SELECT * FROM bid_command_receipts WHERE bid_session_id=? AND outcome='accepted' ORDER BY result_seq",
          )
          .all(SESSION),
        legacy: h.sqlite.prepare('SELECT * FROM bids WHERE bid_session_id=?').all(SESSION),
      };
    }

    it('rejects duplicate group membership for record or force and allows a distinct group without extra awards', async () => {
      const first = await commit(selection(MEMBER, SEAT, 'G1', 7, KEY));
      expect(first.result, JSON.stringify(first.result)).toMatchObject({ kind: 'accepted' });
      const before = persistedAwards();
      const rejected = await commit(
        selection(SECOND, PRIOR_SEAT, 'G1', 8, '538e3f50-58e1-412d-864a-658bc8e1da5a'),
      );
      expect(rejected.result).toMatchObject({
        kind: 'rejected',
        code: 'MEMBERSHIP_A_DAY_MAXIMUM_REACHED',
      });
      expect(persistedAwards()).toEqual(before);
      const accepted = await commit(
        selection(SECOND, PRIOR_SEAT, 'G2', 8, '28c467a1-a3d8-4a8d-a7e4-54766f0b78b2'),
      );
      expect(accepted.result).toMatchObject({ kind: 'accepted' });
      expect(
        Object.values(accepted.canonicalState?.fills ?? {})
          .map((f) => f.memberId)
          .sort(),
      ).toEqual([MEMBER, SECOND]);
      expect(accepted.canonicalState?.aDay?.picks).toHaveLength(2);
      expect(persistedAwards().legacy).toEqual([]);
      const amendment: LiveBidCommand = {
        v: 1,
        type: 'live.amend_selection',
        commandId: 'a9daf9be-bf3b-45dc-85cc-e834cff0b06c',
        bidSessionId: SESSION,
        expectedSeq: 9,
        actor: { id: MEMBER, role: 'admin' },
        reason: 'Synthetic amendment must preserve membership caps',
        evidenceReference: 'synthetic:reviewed-membership',
        memberId: SECOND,
        fromPositionId: PRIOR_SEAT,
        toPositionId: SPARE,
        aDay: 'G1',
      };
      const beforeAmend = persistedAwards();
      expect((await commit(amendment)).result).toMatchObject({
        kind: 'rejected',
        code: 'MEMBERSHIP_A_DAY_MAXIMUM_REACHED',
      });
      expect(persistedAwards()).toEqual(beforeAmend);
      const moved = await commit({
        ...amendment,
        commandId: '4f72bd40-5e62-4fd1-8d4a-9b28e6818b75',
        aDay: 'G3',
      });
      expect(moved.result).toMatchObject({ kind: 'accepted' });
      expect(moved.canonicalState?.fills[PRIOR_SEAT]).toBeUndefined();
      expect(moved.canonicalState?.fills[SPARE]).toMatchObject({ memberId: SECOND, aDay: 'G3' });
      expect(Object.values(moved.canonicalState?.fills ?? {})).toHaveLength(2);
      expect(moved.canonicalState?.aDay?.picks).toHaveLength(2);
    });

    it('allows incomplete allocation while bidding and blocks final completion without the remaining member award', async () => {
      expect((await commit(selection(MEMBER, SEAT, 'G1', 7, KEY))).result).toMatchObject({
        kind: 'accepted',
      });
      expect(
        (
          await commit({
            v: 1,
            type: 'live.disposition',
            commandId: '35de99ac-aa3c-4b5c-8f22-021b29aacb1b',
            bidSessionId: SESSION,
            expectedSeq: 8,
            actor: { id: MEMBER, role: 'admin' },
            reason: 'Synthetic next member pass',
            evidenceReference: null,
            disposition: 'PASS',
          })
        ).result,
      ).toMatchObject({ kind: 'accepted' });
      const before = persistedAwards();
      expect(
        (
          await commit({
            v: 1,
            type: 'live.complete_session',
            commandId: 'd76e2f8a-f5e2-4d4e-8f19-b8b4a8b083be',
            bidSessionId: SESSION,
            expectedSeq: 9,
            actor: { id: MEMBER, role: 'admin' },
            reason: 'Synthetic incomplete fixed membership',
            evidenceReference: null,
          })
        ).result,
      ).toMatchObject({ kind: 'rejected', code: 'MEMBERSHIP_ASSIGNMENTS_INCOMPLETE' });
      expect(persistedAwards()).toEqual(before);
    });
  },
);
