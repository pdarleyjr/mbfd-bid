import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
  type MockFreezeCommand,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitLiveBidCommand,
  commitMockFreezeCommand,
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

const SESSION = 'synthetic-command-integrity-session';
const SEAT = 'synthetic-command-integrity-seat';
const MEMBER = 10001;
const NOW = Date.parse('2027-01-01T10:00:00.000Z');
const KEY = 'b8619c19-0b60-4dcc-aa6b-eec70a733e65';
const NEXT_KEY = '532bfc63-230a-40d9-be2e-c07a1725718e';
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const CASES = [
  'initial accepted command',
  'initial stale command',
  'accepted receipt replay',
  'rejected receipt replay',
  'new command after accepted command',
] as const;
type Scenario = (typeof CASES)[number];

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
        memberIds: [MEMBER],
        opportunityPositionIds: [SEAT],
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
  });
}

describe.each(['mock', 'live'] as const)('managed %s canonical command integrity', (mode) => {
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
        VALUES (10001,'synthetic-command-editor','Synthetic','Editor','FF','FF',1,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic rules');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision)
        VALUES (2027,'configuring','2027.1','2027.1',3);
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
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
      .run(SESSION, NOW, mode === 'mock' ? 1 : 0, JSON.stringify(snapshot.settings));
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

  function commit(expectedSeq = 7, commandId = KEY, suppliedPolicy = policy) {
    const common = {
      v: 1 as const,
      commandId,
      bidSessionId: SESSION,
      expectedSeq,
      actor: { id: MEMBER, role: 'admin' as const },
      reason: 'Synthetic operator pause',
    };
    const input = {
      db: h.env.DB,
      state,
      nowMs: () => NOW + 1000,
      newId: () => `synthetic-command-evidence-${++nextId}`,
    };
    if (mode === 'mock') {
      const command: MockFreezeCommand = { ...common, type: 'mock.freeze' };
      return commitMockFreezeCommand({ ...input, command });
    }
    const command: LiveBidCommand = { ...common, type: 'live.pause', evidenceReference: null };
    return commitLiveBidCommand({ ...input, command, policy: suppliedPolicy });
  }

  function evidenceCounts() {
    return Object.fromEntries(
      [
        'canonical_bid_session_state',
        'bid_command_receipts',
        'audit_log',
        'bid_command_events',
        'bid_audit_outbox',
        'bids',
        'a_day_picks',
      ].map((table) => [
        table,
        h.sqlite
          .prepare(`SELECT count(*) AS count FROM ${table} WHERE bid_session_id=?`)
          .get(SESSION),
      ]),
    );
  }

  async function arrange(scenario: Scenario) {
    if (
      scenario === 'accepted receipt replay' ||
      scenario === 'new command after accepted command'
    ) {
      expect((await commit()).result).toMatchObject({ kind: 'accepted', seq: 8 });
    }
    if (scenario === 'rejected receipt replay') {
      expect((await commit(6)).result).toMatchObject({ kind: 'rejected', code: 'STALE_SEQUENCE' });
    }
    return {
      expectedSeq:
        scenario === 'initial stale command' || scenario === 'rejected receipt replay'
          ? 6
          : scenario === 'new command after accepted command'
            ? 8
            : 7,
      commandId: scenario === 'new command after accepted command' ? NEXT_KEY : KEY,
    };
  }

  function corrupt(kind: 'version material' | 'run context') {
    const changed = structuredClone(snapshot);
    if (kind === 'version material') {
      changed.ruleBookMaterial.positions = changed.ruleBookMaterial.positions.map((position) => ({
        ...position,
        positionName: 'Synthetic altered position',
      }));
      expect(bidDefinitionContextHash(changed)).toBe(snapshot.bidDefinition.contextSha256);
    } else {
      changed.members = changed.members.map((member) => ({
        ...member,
        credentialNames: ['Synthetic substituted qualification'],
      }));
      expect(bidDefinitionContextHash(changed)).not.toBe(snapshot.bidDefinition.contextSha256);
    }
    const { bidDefinition: _pin, ...legacyBody } = changed;
    expect(BidSessionPolicySnapshotSchema.safeParse(legacyBody).success).toBe(true);
    // Simulate corruption by bypassing only the pre-existing snapshot UPDATE
    // seal. Keep every insert/pin identity guard, FK, version seal and delete
    // guard. Rehashing bytes must not authorize different content or context.
    h.sqlite.exec('DROP TRIGGER bid_session_policy_snapshots_immutable');
    const json = JSON.stringify(changed);
    h.sqlite
      .prepare(`UPDATE bid_session_policy_snapshots SET snapshot_json=?,snapshot_sha256=?
      WHERE bid_session_id=?`)
      .run(json, digest(json), SESSION);
  }

  it('commits and exactly replays a valid pinned command with one complete evidence bundle', async () => {
    const first = await commit();
    expect(first.result).toMatchObject({ kind: 'accepted', seq: 8 });
    expect(evidenceCounts()).toEqual({
      canonical_bid_session_state: { count: 1 },
      bid_command_receipts: { count: 1 },
      audit_log: { count: 1 },
      bid_command_events: { count: 1 },
      bid_audit_outbox: { count: 1 },
      bids: { count: 0 },
      a_day_picks: { count: 0 },
    });
    const bytes = h.sqlite.serialize();
    expect(await commit()).toEqual(first);
    expect(await loadCanonicalBidSessionState(h.env.DB, SESSION)).toEqual(first.canonicalState);
    deepStrictEqual(h.sqlite.serialize(), bytes);
  });

  describe.each(['version material', 'run context'] as const)('rehashed altered %s', (kind) => {
    it.each(CASES)('rejects %s and recovery without any write', async (scenario) => {
      const request = await arrange(scenario);
      corrupt(kind);
      const bytes = h.sqlite.serialize();
      const counts = evidenceCounts();
      const batch = vi.spyOn(h.env.DB, 'batch');
      await expect(commit(request.expectedSeq, request.commandId)).rejects.toThrow(
        'session_policy_snapshot_integrity_invalid',
      );
      deepStrictEqual(h.sqlite.serialize(), bytes);
      await expect(loadCanonicalBidSessionState(h.env.DB, SESSION)).rejects.toThrow(
        'session_policy_snapshot_integrity_invalid',
      );
      expect(batch).not.toHaveBeenCalled();
      expect(evidenceCounts()).toEqual(counts);
      deepStrictEqual(h.sqlite.serialize(), bytes);
      expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    });
  });

  if (mode === 'live') {
    it.each([
      'initial accepted command',
      'accepted receipt replay',
      'rejected receipt replay',
    ] as const)(
      'rejects supplied policy mismatch before %s with the valid frozen pin retained',
      async (scenario) => {
        const request = await arrange(scenario);
        const wrong = FrozenLiveBidPolicySchema.parse({
          ...policy,
          actionPermissions: policy.actionPermissions.map((grant) => ({
            ...grant,
            actorMemberIds: [...grant.actorMemberIds, 10002],
          })),
        });
        const bytes = h.sqlite.serialize();
        const counts = evidenceCounts();
        const batch = vi.spyOn(h.env.DB, 'batch');
        await expect(commit(request.expectedSeq, request.commandId, wrong)).rejects.toThrow(
          'session_policy_snapshot_integrity_invalid',
        );
        expect(batch).not.toHaveBeenCalled();
        expect(evidenceCounts()).toEqual(counts);
        expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual({
          snapshot,
          error: null,
        });
        deepStrictEqual(h.sqlite.serialize(), bytes);
      },
    );
  }
});
