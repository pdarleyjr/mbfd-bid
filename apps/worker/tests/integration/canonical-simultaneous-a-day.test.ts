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
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const KEY = 'b8619c19-0b60-4dcc-aa6b-eec70a733e65';
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Synthetic, schema-valid execution inputs only. The real store seals the
// definition; manually inserting a valid snapshot here does not publish a Bid
// or establish that this private draft is authorized to start Live execution.
function syntheticPolicy(
  maximum: number,
  timing: 'SIMULTANEOUS' | 'AFTER_POSITION_SELECTION' = 'SIMULTANEOUS',
) {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-command-integrity-policy',
    stages: [
      {
        id: 'synthetic-ff',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [MEMBER],
        opportunityPositionIds: [SEAT, PRIOR_SEAT],
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
      requiredTopologyPositionIds: [SEAT, PRIOR_SEAT],
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
      contact: { minimumAttempts: 1, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 1,
        max: 2,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing,
          officersPerGroup: null,
          sourceRef: 'synthetic:aday-command-policy',
          constraints: [
            {
              id: 'synthetic-member-limit',
              label: 'Synthetic member limit',
              sourceRef: 'synthetic:member-limit',
              maximum,
              positionIds: [],
              memberIds: [MEMBER],
              ranks: [],
              shifts: ['A'],
            },
          ],
        },
      },
    },
  });
}

describe.each([
  { commandType: 'live.record_selection', maximum: 0, timing: 'SIMULTANEOUS' as const },
  { commandType: 'live.record_selection', maximum: 1, timing: 'SIMULTANEOUS' as const },
  { commandType: 'live.force_selection', maximum: 0, timing: 'SIMULTANEOUS' as const },
  { commandType: 'live.force_selection', maximum: 1, timing: 'SIMULTANEOUS' as const },
  {
    commandType: 'live.record_selection',
    maximum: 1,
    timing: 'AFTER_POSITION_SELECTION' as const,
  },
] as const)(
  'canonical A-Day $timing $commandType maximum=$maximum',
  ({ commandType, maximum, timing }) => {
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
        livePolicy: syntheticPolicy(maximum, timing),
      };
      h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-command-editor','Synthetic','Editor','FF','FF',1,1,1);
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
        ],
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
        bidOrder: [{ ordinal: 1, memberId: MEMBER, pool: 'FF', stageId: 'synthetic-ff' }],
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

    function expectNoAwardEvidence() {
      for (const table of [
        'canonical_bid_session_state',
        'bid_command_events',
        'bid_audit_outbox',
        'bids',
      ]) {
        expect(
          h.sqlite
            .prepare(`SELECT count(*) AS count FROM ${table} WHERE bid_session_id=?`)
            .get(SESSION),
        ).toEqual({ count: 0 });
      }
      expect(
        h.sqlite
          .prepare(
            "SELECT count(*) AS count FROM bid_command_receipts WHERE bid_session_id=? AND outcome='accepted'",
          )
          .get(SESSION),
      ).toEqual({ count: 0 });
    }

    it('rejects omitted simultaneous A-Day before canonical award persistence', async () => {
      if (timing === 'AFTER_POSITION_SELECTION') return;
      const result = await commit();
      expect(result.result).toMatchObject({
        kind: 'rejected',
        code: 'A_DAY_REQUIRED_WITH_SELECTION',
      });
      expectNoAwardEvidence();
    });

    it('validates the frozen constraint before committing record or force selection', async () => {
      if (timing === 'AFTER_POSITION_SELECTION') {
        const premature = await commit({
          v: 1,
          type: 'live.record_selection',
          commandId: KEY,
          bidSessionId: SESSION,
          expectedSeq: 7,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Synthetic deferred A-Day position selection proof',
          evidenceReference: 'synthetic:timeline',
          memberId: MEMBER,
          positionId: SEAT,
          aDay: 'G1',
        });
        expect(premature.result).toMatchObject({
          kind: 'rejected',
          code: 'A_DAY_DEFERRED_SELECTION_REQUIRED',
        });
        expectNoAwardEvidence();

        const selected = await commit({
          v: 1,
          type: 'live.record_selection',
          commandId: 'ab61c19-0b60-4dcc-aa6b-eec70a733e65',
          bidSessionId: SESSION,
          expectedSeq: 7,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Synthetic deferred A-Day position selection proof',
          evidenceReference: 'synthetic:timeline',
          memberId: MEMBER,
          positionId: SEAT,
        });
        expect(selected.result).toMatchObject({ kind: 'accepted', seq: 8 });
        expect(selected.canonicalState).toMatchObject({
          currentPhase: 'a_day_bid',
          currentBidderId: MEMBER,
          fills: { [SEAT]: { memberId: MEMBER } },
        });
        state = selected.canonicalState ?? state;
        const aDay = await commit({
          v: 1,
          type: 'live.record_a_day',
          commandId: 'ba61c19-0b60-4dcc-aa6b-eec70a733e65',
          bidSessionId: SESSION,
          expectedSeq: 8,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Synthetic controlled A-Day selection proof',
          evidenceReference: 'synthetic:timeline',
          memberId: MEMBER,
          aDay: 'G1',
        });
        expect(aDay.result).toMatchObject({ kind: 'accepted', seq: 9 });
        expect(aDay.canonicalState).toMatchObject({
          currentPhase: 'complete',
          currentBidderId: null,
          aDay: { picks: [expect.objectContaining({ memberId: MEMBER, aDay: 'G1' })] },
        });
        const replay = await commit({
          v: 1,
          type: 'live.record_a_day',
          commandId: 'ba61c19-0b60-4dcc-aa6b-eec70a733e65',
          bidSessionId: SESSION,
          expectedSeq: 8,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Synthetic controlled A-Day selection proof',
          evidenceReference: 'synthetic:timeline',
          memberId: MEMBER,
          aDay: 'G1',
        });
        expect(replay).toEqual(aDay);
        const stale = await commit({
          v: 1,
          type: 'live.record_a_day',
          commandId: 'ca61c19-0b60-4dcc-aa6b-eec70a733e65',
          bidSessionId: SESSION,
          expectedSeq: 8,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Synthetic stale controlled A-Day rejection proof',
          evidenceReference: 'synthetic:timeline',
          memberId: MEMBER,
          aDay: 'G2',
        });
        expect(stale.result).toMatchObject({
          kind: 'rejected',
          code: 'STALE_SEQUENCE',
          currentSeq: 9,
        });
        expect(
          h.sqlite
            .prepare('SELECT COUNT(*) AS n FROM bid_command_events WHERE bid_session_id=?')
            .get(SESSION),
        ).toEqual({ n: 2 });
        return;
      }
      const result = await commit({
        v: 1,
        type: commandType,
        commandId: KEY,
        bidSessionId: SESSION,
        expectedSeq: 7,
        actor: { id: MEMBER, role: 'admin' },
        reason: 'Synthetic simultaneous A-Day command proof',
        evidenceReference: 'synthetic:aday',
        memberId: MEMBER,
        positionId: SEAT,
        aDay: 'G1',
      });
      if (maximum === 0) {
        expect(result.result).toMatchObject({ kind: 'rejected', code: 'SCOPED_A_DAY_MAXIMUM' });
        expectNoAwardEvidence();
      } else {
        expect(result.result).toMatchObject({ kind: 'accepted' });
        expect(result.canonicalState?.fills[SEAT]).toMatchObject({ memberId: MEMBER, aDay: 'G1' });
        expect(result.canonicalState?.aDay?.picks).toEqual([
          expect.objectContaining({
            memberId: MEMBER,
            aDay: 'G1',
            shift: 'A',
            forced: commandType === 'live.force_selection',
          }),
        ]);
        expect(
          h.sqlite.prepare('SELECT COUNT(*) AS n FROM bids WHERE bid_session_id=?').get(SESSION),
        ).toEqual({ n: 0 });
        expect(
          h.sqlite
            .prepare('SELECT COUNT(*) AS n FROM bid_command_events WHERE bid_session_id=?')
            .get(SESSION),
        ).toEqual({ n: 1 });
        const persisted = h.sqlite
          .prepare('SELECT state_json FROM canonical_bid_session_state WHERE bid_session_id=?')
          .get(SESSION) as { state_json: string };
        expect(JSON.parse(persisted.state_json).fills[SEAT]).toMatchObject({
          memberId: MEMBER,
          aDay: 'G1',
        });
        const amended = await commit({
          v: 1,
          type: 'live.amend_selection',
          commandId: 'f11f7593-0690-40bb-b6ab-b7a39df2b3d4',
          bidSessionId: SESSION,
          expectedSeq: 8,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Synthetic regrouping proof',
          evidenceReference: 'synthetic:amend',
          memberId: MEMBER,
          fromPositionId: SEAT,
          toPositionId: PRIOR_SEAT,
          aDay: 'G2',
        });
        expect(amended.result).toMatchObject({ kind: 'accepted' });
        expect(amended.canonicalState?.fills[SEAT]).toBeUndefined();
        expect(amended.canonicalState?.fills[PRIOR_SEAT]).toMatchObject({
          memberId: MEMBER,
          aDay: 'G2',
        });
        expect(amended.canonicalState?.aDay?.picks).toEqual([
          expect.objectContaining({ memberId: MEMBER, aDay: 'G2' }),
        ]);
        const finalized = await commit({
          v: 1,
          type: 'live.complete_session',
          commandId: 'a889a1a0-34a1-4c3b-b9d5-d8e0a878a167',
          bidSessionId: SESSION,
          expectedSeq: 9,
          actor: { id: MEMBER, role: 'admin' },
          reason: 'Synthetic incomplete final population',
          evidenceReference: 'synthetic:completion',
        });
        expect(finalized.result).toMatchObject({ kind: 'rejected', code: 'A_DAY_MINIMUM_NOT_MET' });
      }
    });
  },
);
