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
import { app } from '../../src/index.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SESSION = 'synthetic-command-integrity-session';
const SEAT = 'synthetic-command-integrity-seat';
const PRIOR_SEAT = 'synthetic-prior-seat';
const MEMBER = 10001;
const SECOND = 10002;
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const KEY = 'b8619c19-0b60-4dcc-aa6b-eec70a733e65';
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Synthetic, schema-valid execution inputs only. The real store seals the
// definition; manually inserting a valid snapshot here does not publish a Bid
// or establish that this private draft is authorized to start Live execution.
function syntheticPolicy(mode: 'VOLUNTARY' | 'FORCED' | 'EMPTY' | 'LEGACY') {
  return FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-command-integrity-policy',
    stages: [
      {
        id: 'synthetic-ff',
        label: 'Synthetic firefighter stage',
        order: 0,
        memberIds: [MEMBER, SECOND],
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
      ...(mode === 'LEGACY'
        ? {}
        : {
            fallbackPolicies:
              mode === 'EMPTY'
                ? []
                : [
                    {
                      id: 'synthetic-fallback',
                      label: 'Synthetic minimum qualified fallback',
                      sourceRef: 'synthetic:approved-fallback-source',
                      sourceDecisionId: 'synthetic-fallback-source',
                      positionIds: [SEAT],
                      tiers: [
                        ...(mode === 'VOLUNTARY'
                          ? [
                              {
                                id: 'voluntary',
                                label: 'Voluntary minimum qualified',
                                mode: 'VOLUNTARY',
                                eligibility: { kind: 'MINIMUM_QUALIFIED' },
                                currentlyAssignedOnly: false,
                                comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
                              },
                            ]
                          : []),
                        {
                          id: 'forced',
                          label: 'Forced minimum qualified',
                          mode: 'FORCED',
                          eligibility: { kind: 'MINIMUM_QUALIFIED' },
                          currentlyAssignedOnly: false,
                          comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
                        },
                      ],
                    },
                  ],
          }),
      contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 1,
        max: 2,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
      },
    },
  });
}

describe.each(['VOLUNTARY', 'FORCED', 'EMPTY', 'LEGACY'] as const)(
  'canonical fallback mode=%s',
  (mode) => {
    const commandType = 'live.force_selection' as const;
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
        livePolicy: syntheticPolicy(mode),
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
      const captured = await captureBidDefinitionSource(h.env.DB, 2027);
      if (!captured.ok) throw new Error(JSON.stringify(captured));
      captured.content.policy = {
        policyText: 'Synthetic reviewed fallback evidence',
        executionPolicy: settings.livePolicy,
      };
      captured.content.sourceDecisions = [
        {
          issueId: 'synthetic-fallback-source',
          title: 'Synthetic fallback',
          question: 'Which minimum-qualified tier applies?',
          area: 'annual-policy',
          status: 'RESOLVED',
          decision: 'Use the explicit frozen tiers and synthetic ordering.',
          sourceRef: 'synthetic:approved-fallback-source',
          effectiveOn: '2027-01-01',
        },
      ];
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
        annualPolicyEvidence: {
          documentId: version.row.policy_document_id,
          documentRevision: 1,
          ruleBookVersion: version.row.rule_book_version,
          executablePolicyRevision: policy.policyRevision,
          policyText: version.content.policy?.policyText,
        },
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

    function fallbackCommand(
      type: 'live.record_selection' | 'live.force_selection' | 'live.record_fallback_response',
      extra: Record<string, unknown> = {},
    ): LiveBidCommand {
      return {
        v: 1,
        type,
        commandId: KEY,
        bidSessionId: SESSION,
        expectedSeq: 7,
        actor: { id: MEMBER, role: 'admin' },
        reason: 'Synthetic fallback command',
        evidenceReference: 'synthetic:contact-receipt',
        memberId: SECOND,
        positionId: SEAT,
        fallback: {
          policyId: 'synthetic-fallback',
          tierId: mode === 'VOLUNTARY' ? 'voluntary' : 'forced',
        },
        ...(type === 'live.record_fallback_response' ? { outcome: 'DECLINE' } : {}),
        ...extra,
      } as LiveBidCommand;
    }
    it.skipIf(mode !== 'VOLUNTARY').each(['fallback', 'ordinary'] as const)(
      'persists %s UNREACHABLE only on the target member latest contact in this session',
      async (path) => {
        const target = path === 'fallback' ? SECOND : MEMBER;
        const otherSession = 'synthetic-other-contact-session';
        h.sqlite
          .prepare(`INSERT INTO bid_sessions
          (id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
          VALUES (?,2027,?,'position_bid',0,180,2,?)`)
          .run(otherSession, NOW, JSON.stringify(snapshot.settings));
        const insert = h.sqlite.prepare(`INSERT INTO bid_contact_attempts
          (id,bid_session_id,member_id,attempt_number,method,operator_member_id,attempted_at,disposition,created_at)
          VALUES (?,?,?,?, 'PHONE',?,?, 'RECORDED',?)`);
        for (const member of [MEMBER, SECOND]) {
          for (const attempt of [1, 2]) {
            insert.run(
              `synthetic-contact-${member}-${attempt}`,
              SESSION,
              member,
              attempt,
              MEMBER,
              NOW - 1000 + attempt,
              NOW,
            );
          }
        }
        insert.run('synthetic-other-session-contact', otherSession, target, 2, MEMBER, NOW, NOW);
        const input: LiveBidCommand =
          path === 'fallback'
            ? fallbackCommand('live.record_fallback_response', { outcome: 'UNREACHABLE' })
            : {
                v: 1,
                type: 'live.disposition',
                commandId: KEY,
                bidSessionId: SESSION,
                expectedSeq: 7,
                actor: { id: MEMBER, role: 'admin' },
                reason: 'Synthetic unreachable response',
                evidenceReference: 'synthetic:contact-receipt',
                disposition: 'UNREACHABLE',
              };
        const first = await commit(input);
        expect(first.result).toMatchObject({ kind: 'accepted', seq: 8 });
        if (path === 'ordinary') expect(first.canonicalState?.currentBidderId).toBe(SECOND);
        const rows = h.sqlite
          .prepare(`SELECT bid_session_id,member_id,attempt_number,disposition
          FROM bid_contact_attempts ORDER BY id`)
          .all() as Array<{
          bid_session_id: string;
          member_id: number;
          attempt_number: number;
          disposition: string;
        }>;
        expect(rows).toHaveLength(5);
        for (const row of rows) {
          expect(row.disposition).toBe(
            row.bid_session_id === SESSION && row.member_id === target && row.attempt_number === 2
              ? 'UNREACHABLE'
              : 'RECORDED',
          );
        }
        expect(await commit(input)).toEqual(first);
        expect(
          h.sqlite
            .prepare('SELECT COUNT(*) AS n FROM bid_command_events WHERE bid_session_id=?')
            .get(SESSION),
        ).toEqual({ n: 1 });
      },
    );

    it('blocks generic force for configured fallback policy, preserving absent legacy behavior', async () => {
      const result = await commit();
      if (mode === 'LEGACY') expect(result.result).toMatchObject({ kind: 'accepted' });
      else {
        expect(result.result).toMatchObject({ kind: 'rejected', code: 'FALLBACK_REVIEW_REQUIRED' });
        expectNoAwardEvidence();
      }
    });
    it('rejects absent policy, incorrect tier, candidate, and action mode before award persistence', async () => {
      if (mode === 'EMPTY' || mode === 'LEGACY') {
        expect((await commit(fallbackCommand('live.force_selection'))).result).toMatchObject({
          kind: 'rejected',
          code: 'FALLBACK_POLICY_MISSING',
        });
      } else {
        const acceptedType = mode === 'FORCED' ? 'live.force_selection' : 'live.record_selection';
        expect(
          (
            await commit(
              fallbackCommand(acceptedType, {
                fallback: { policyId: 'synthetic-fallback', tierId: 'wrong' },
              }),
            )
          ).result,
        ).toMatchObject({ kind: 'rejected', code: 'FALLBACK_TIER_NOT_ACTIVE' });
        expect(
          (
            await commit(
              fallbackCommand(acceptedType, {
                commandId: '075d01ef-3b0b-4999-9fdf-80eef1042e89',
                memberId: MEMBER,
              }),
            )
          ).result,
        ).toMatchObject({ kind: 'rejected', code: 'FALLBACK_CANDIDATE_OUT_OF_ORDER' });
        const wrongType =
          mode === 'FORCED' ? 'live.record_fallback_response' : 'live.force_selection';
        expect(
          (
            await commit(
              fallbackCommand(wrongType, { commandId: '0f75c1b9-fa72-4f5c-9ca2-27b88f82f0ea' }),
            )
          ).result,
        ).toMatchObject({ kind: 'rejected', code: 'FALLBACK_ACTION_NOT_ALLOWED' });
      }
      expectNoAwardEvidence();
    });
    it.skipIf(mode === 'EMPTY' || mode === 'LEGACY')(
      'retains source provenance in canonical events when the exact first candidate accepts',
      async () => {
        const result = await commit(
          fallbackCommand(mode === 'FORCED' ? 'live.force_selection' : 'live.record_selection'),
        );
        expect(result.result).toMatchObject({ kind: 'accepted' });
        expect(result.canonicalState?.fills[SEAT]).toMatchObject({ memberId: SECOND });
        const row = h.sqlite
          .prepare('SELECT event_json FROM bid_command_events WHERE bid_session_id=?')
          .get(SESSION) as { event_json: string };
        expect(JSON.parse(row.event_json).fallback).toMatchObject({
          policyId: 'synthetic-fallback',
          tierId: mode === 'FORCED' ? 'forced' : 'voluntary',
          sourceRef: 'synthetic:approved-fallback-source',
          sourceDecisionId: 'synthetic-fallback-source',
          eligibleMemberIds: [SECOND, MEMBER],
          comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
        });
        expect(
          h.sqlite
            .prepare('SELECT COUNT(*) AS n FROM bid_audit_outbox WHERE bid_session_id=?')
            .get(SESSION),
        ).toEqual({ n: 1 });
        const archive = h.sqlite
          .prepare('SELECT payload_json FROM bid_audit_outbox WHERE bid_session_id=?')
          .get(SESSION) as { payload_json: string };
        expect(JSON.parse(archive.payload_json).event.payload.fallback).toEqual(
          JSON.parse(row.event_json).fallback,
        );
        const token = await signJwt(
          {
            sub: MEMBER,
            emp: 'synthetic-reader',
            role: 'admin',
            rank: 'FF',
            first_name: 'Synthetic',
            last_name: 'Reader',
            fresh_auth_at: Math.floor(Date.now() / 1000),
          },
          h.env.JWT_SIGNING_KEY,
        );
        const noHydration = vi.fn(() => {
          throw new Error('Results must not hydrate session state');
        });
        h.env.BID_SESSION = { get: noHydration, idFromName: noHydration } as never;
        const beforeRead = h.sqlite.serialize();
        const results = await app.fetch(
          new Request(`http://x/api/admin/bid-session/${SESSION}/results`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          h.env,
        );
        expect(results.status).toBe(200);
        expect(await results.json()).toMatchObject({
          awardSource: 'CANONICAL',
          provenance: { valid: true, error: null, pin: snapshot.bidDefinition },
          awards: [{ memberId: SECOND, positionId: SEAT }],
          completion: { verified: false, blockers: ['annual_completion_receipt_required'] },
        });
        expect(
          h.sqlite.serialize().length === beforeRead.length &&
            h.sqlite.serialize().every((byte, index) => byte === beforeRead[index]),
        ).toBe(true);
        expect(noHydration).not.toHaveBeenCalled();
      },
    );
    it.skipIf(mode !== 'VOLUNTARY')(
      'records each voluntary response once and advances to forced only after exhaustion',
      async () => {
        const response = fallbackCommand('live.record_fallback_response');
        const first = await commit(response);
        expect(first.result).toMatchObject({ kind: 'accepted', seq: 8 });
        expect(await commit(response)).toEqual(first);
        expect(first.canonicalState?.live?.fallbackResponses).toHaveLength(1);
        expect(
          h.sqlite
            .prepare('SELECT COUNT(*) AS n FROM bid_command_events WHERE bid_session_id=?')
            .get(SESSION),
        ).toEqual({ n: 1 });
        const premature = await commit(
          fallbackCommand('live.force_selection', {
            commandId: '6c65c2c9-11a5-4196-b5ef-640ab6744de7',
            expectedSeq: 8,
            fallback: { policyId: 'synthetic-fallback', tierId: 'forced' },
          }),
        );
        expect(premature.result).toMatchObject({
          kind: 'rejected',
          code: 'FALLBACK_TIER_NOT_ACTIVE',
        });
        const second = await commit(
          fallbackCommand('live.record_fallback_response', {
            commandId: '22323478-191f-4fa2-9e0e-facb94cb4a43',
            expectedSeq: 8,
            memberId: MEMBER,
            outcome: 'UNREACHABLE',
          }),
        );
        expect(second.result).toMatchObject({ kind: 'accepted', seq: 9 });
        const selected = await commit(
          fallbackCommand('live.force_selection', {
            commandId: '52616e36-3587-4cb0-b697-d4324a3f78bd',
            expectedSeq: 9,
            fallback: { policyId: 'synthetic-fallback', tierId: 'forced' },
          }),
        );
        expect(selected.result).toMatchObject({ kind: 'accepted', seq: 10 });
        expect(selected.canonicalState?.fills[SEAT]).toMatchObject({ memberId: SECOND });
        expect(selected.canonicalState?.live?.fallbackResponses).toHaveLength(2);
      },
    );
  },
);
