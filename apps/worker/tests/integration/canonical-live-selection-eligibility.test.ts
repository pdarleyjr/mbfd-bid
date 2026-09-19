import { createHash } from 'node:crypto';
import { evaluateEligibility } from '@mbfd/eligibility';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { app } from '../../src/index.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import {
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadBidSessionPolicySnapshot,
  resolveFrozenSessionBidTarget,
} from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const SESSION = 'synthetic-command-integrity-session';
const SEAT = 'synthetic-command-integrity-seat';
const PRIOR_SEAT = 'synthetic-prior-seat';
const POOL_FIRST = 'synthetic-z-pool-first';
const MEMBER = 10001;
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
        memberIds: [MEMBER],
        opportunityPositionIds: [SEAT, PRIOR_SEAT, POOL_FIRST],
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
      requiredTopologyPositionIds: [SEAT, PRIOR_SEAT, POOL_FIRST],
      opportunityPools: [
        {
          id: 'synthetic-pool',
          label: 'Synthetic station pool',
          kind: 'STATION_POOL',
          sourceRef: 'Synthetic explicit pool decision',
          sourceDecisionId: 'synthetic-pool-decision',
          positionIds: [POOL_FIRST, PRIOR_SEAT],
        },
      ],
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
      },
    },
  });
}

describe.each([
  ['live.record_selection', false],
  ['live.force_selection', false],
  ['live.record_selection', true],
  ['live.force_selection', true],
] as const)('managed %s frozen eligibility boundary (Mock: %s)', (commandType, isMock) => {
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
        VALUES ('2027.1','${SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":["non_probationary"]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('${PRIOR_SEAT}','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic prior seat');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','${PRIOR_SEAT}','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
    `);
    h.sqlite
      .prepare(`INSERT INTO positions
        (id,template_version,shift,station,division,unit,rank_required,position_name)
        SELECT ? ,template_version,shift,station,division,'Synthetic Ladder',rank_required,'Synthetic capacity slot'
        FROM positions WHERE id=?`)
      .run(POOL_FIRST, PRIOR_SEAT);
    h.sqlite
      .prepare(`INSERT INTO position_rules
        (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        SELECT rule_book_version,?,template_version,required_criteria,points_preference,tie_break_chain
        FROM position_rules WHERE position_id=?`)
      .run(POOL_FIRST, PRIOR_SEAT);
    h.sqlite
      .prepare('UPDATE bid_years SET config_json=? WHERE year=2027')
      .run(JSON.stringify(settings));
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    captured.content.sourceDecisions.push({
      issueId: 'synthetic-pool-decision',
      title: 'Synthetic capacity',
      question: 'Which capacity slots?',
      area: 'annual-policy',
      status: 'RESOLVED',
      decision: 'Synthetic slots are interchangeable.',
      sourceRef: 'Synthetic explicit pool decision',
      effectiveOn: '2027-01-01',
    });
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
          isProbationary: true,
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
      .run(SESSION, NOW, isMock ? 1 : 0, JSON.stringify(snapshot.settings));
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

  async function adminRequest(path: string, body: unknown) {
    const token = await signJwt(
      {
        sub: MEMBER,
        emp: 'synthetic-command-editor',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Editor',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'synthetic-mock-pool',
        },
        body: JSON.stringify(body),
      }),
      h.env,
    );
  }

  it.runIf(isMock)(
    'starts a managed Mock from session controls and awards its pool through canonical execution',
    async () => {
      h.sqlite.prepare("UPDATE bid_sessions SET current_phase='config' WHERE id=?").run(SESSION);
      const started = await adminRequest(`bid-session/${SESSION}/start`, {});
      const startBody = await started.json();
      expect(startBody).toMatchObject({ current_phase: 'position_bid', bid_order_count: 1 });
      expect(started.status).toBe(200);
      const seeded = await loadCanonicalBidSessionState(h.env.DB, SESSION);
      expect(seeded).toMatchObject({
        currentPhase: 'position_bid',
        currentBidderId: MEMBER,
        lastSeq: 0,
      });
      if (!seeded) throw new Error('Canonical Mock start failed');
      state = seeded;
      const result = await commit({ ...poolCommand(POOL_FIRST), expectedSeq: 0 });
      expect(result.result).toMatchObject({ kind: 'accepted' });
      expect(result.canonicalState?.fills[POOL_FIRST]?.memberId).toBe(MEMBER);
      expect(
        h.sqlite.prepare('SELECT count(*) AS count FROM bids WHERE bid_session_id=?').get(SESSION),
      ).toEqual({ count: 0 });
      expect(
        h.sqlite
          .prepare('SELECT count(*) AS count FROM bid_command_events WHERE bid_session_id=?')
          .get(SESSION),
      ).toEqual({ count: 1 });
    },
  );

  it.runIf(isMock).each(['auto-bid', 'manual-pick'])(
    'blocks legacy %s before any planning or award writes for an explicit pool Mock',
    async (path) => {
      h.sqlite.prepare("UPDATE bid_sessions SET current_phase='config' WHERE id=?").run(SESSION);
      const response = await adminRequest(
        `rehearsal/${SESSION}/${path}`,
        path === 'auto-bid'
          ? { count: 1, strategy: 'first_eligible', expected_mock_control_revision: 0 }
          : { member_id: MEMBER, position_id: 'A999', expected_mock_control_revision: 0 },
      );
      expect(await response.json()).toMatchObject({ error: 'managed_canonical_required' });
      expect(response.status).toBe(409);
      expectNoAwardEvidence();
      expect(
        h.sqlite
          .prepare('SELECT count(*) AS count FROM bid_order WHERE bid_session_id=?')
          .get(SESSION),
      ).toEqual({ count: 0 });
      expect(
        h.sqlite
          .prepare(
            'SELECT count(*) AS count FROM mock_rehearsal_command_receipts WHERE bid_session_id=?',
          )
          .get(SESSION),
      ).toEqual({ count: 0 });
    },
  );

  function poolCommand(
    positionId: string,
    poolId: string | undefined = 'synthetic-pool',
  ): Extract<LiveBidCommand, { type: 'live.record_selection' | 'live.force_selection' }> {
    return {
      v: 1,
      type: commandType,
      commandId: KEY,
      bidSessionId: SESSION,
      expectedSeq: 7,
      actor: { id: MEMBER, role: 'admin' },
      reason: 'Synthetic pool reservation test',
      evidenceReference: null,
      memberId: MEMBER,
      positionId,
      ...(poolId === undefined ? {} : { pool: { poolId } }),
    };
  }

  it('reserves the first configured slot and retains pool source provenance in its event', async () => {
    const result = await commit(poolCommand(POOL_FIRST));
    expect(result.result).toMatchObject({ kind: 'accepted' });
    expect(result.canonicalState?.fills[POOL_FIRST]?.memberId).toBe(MEMBER);
    const event = h.sqlite
      .prepare('SELECT event_json FROM bid_command_events WHERE bid_session_id=?')
      .get(SESSION) as { event_json: string };
    expect(JSON.parse(event.event_json)).toMatchObject({
      pool: {
        poolId: 'synthetic-pool',
        sourceDecisionId: 'synthetic-pool-decision',
        positionId: POOL_FIRST,
      },
    });
  });

  it('rejects an out-of-order concrete slot proposal even though its candidate is eligible', async () => {
    const result = await commit(poolCommand(PRIOR_SEAT));
    expect(result.result).toMatchObject({
      kind: 'rejected',
      code: 'OPPORTUNITY_POOL_RESERVATION_STALE',
    });
    expectNoAwardEvidence();
  });

  it('advances the immutable slot reservation after another member fills the first slot', async () => {
    state.fills[POOL_FIRST] = { memberId: 10002, ordinal: 2, bidId: 'synthetic-other-award' };
    const result = await commit(poolCommand(PRIOR_SEAT));
    expect(result.result).toMatchObject({ kind: 'accepted' });
    expect(result.canonicalState?.fills[PRIOR_SEAT]?.memberId).toBe(MEMBER);
  });

  it('rejects direct pooled-slot awards without an explicit pool selection', async () => {
    const { pool: _pool, ...command } = poolCommand(POOL_FIRST);
    const result = await commit(command);
    expect(result.result).toMatchObject({
      kind: 'rejected',
      code: 'OPPORTUNITY_POOL_SELECTION_REQUIRED',
    });
    expectNoAwardEvidence();
  });

  it('rejects a pool envelope claiming an unrelated concrete opportunity', async () => {
    const result = await commit(poolCommand(SEAT));
    expect(result.result).toMatchObject({
      kind: 'rejected',
      code: 'OPPORTUNITY_POOL_SLOT_MISMATCH',
    });
    expectNoAwardEvidence();
  });

  it('rejects a stage member whose frozen non-probationary requirement is not satisfied', async () => {
    const target = await resolveFrozenSessionBidTarget(getDb(h.env.DB), {
      bidSessionId: SESSION,
      memberId: MEMBER,
      positionId: SEAT,
    });
    expect(target.ok).toBe(true);
    if (!target.ok) throw new Error(target.code);
    const member = frozenEligibilityMemberForSession(target.snapshot, MEMBER);
    if (member === null) throw new Error('Synthetic frozen member missing');
    expect(evaluateEligibility(eligibilityMemberFromFrozen(member), target.rule).eligible).toBe(
      false,
    );

    // The canonical command must apply the same frozen evaluator as the
    // ordinary selection path. Stage membership alone is not eligibility.
    const result = await commit();
    expect.soft(result.result).toMatchObject({ kind: 'rejected', code: 'MEMBER_NOT_ELIGIBLE' });
    expect.soft(result.canonicalState).toBeNull();
    expectNoAwardEvidence();
    expect(await commit()).toEqual(result);
    expect(
      h.sqlite
        .prepare('SELECT count(*) AS count FROM bid_command_receipts WHERE bid_session_id=?')
        .get(SESSION),
    ).toEqual({ count: 1 });
  });

  it('fails closed when the frozen snapshot and therefore its position rule are unavailable', async () => {
    // Only this synthetic in-memory database bypasses the production seal
    // to exercise command handling when frozen storage is unavailable.
    h.sqlite.exec('DROP TRIGGER bid_session_policy_snapshots_pinned_no_delete');
    h.sqlite
      .prepare('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id=?')
      .run(SESSION);
    const target = await resolveFrozenSessionBidTarget(getDb(h.env.DB), {
      bidSessionId: SESSION,
      memberId: MEMBER,
      positionId: SEAT,
    });
    expect(target.ok).toBe(false);
    const result = await commit();
    expect
      .soft(result.result)
      .toMatchObject({ kind: 'rejected', code: 'SESSION_POLICY_SNAPSHOT_MISSING' });
    expect.soft(result.canonicalState).toBeNull();
    expectNoAwardEvidence();
  });

  it('rejects missing rule material in a damaged pinned snapshot before award evidence', async () => {
    const damaged = structuredClone(snapshot);
    damaged.ruleBookMaterial.rules = [];
    // The fixture represents storage corruption, not an authorized edit.
    h.sqlite.exec('DROP TRIGGER bid_session_policy_snapshots_immutable');
    const json = JSON.stringify(damaged);
    h.sqlite
      .prepare(
        'UPDATE bid_session_policy_snapshots SET snapshot_json=?,snapshot_sha256=? WHERE bid_session_id=?',
      )
      .run(json, digest(json), SESSION);
    await expect(commit()).rejects.toThrow('session_policy_snapshot_integrity_invalid');
    expectNoAwardEvidence();
  });

  it('already rejects an unavailable filled opportunity before writing award evidence', async () => {
    state.fills[SEAT] = { memberId: 10002, ordinal: 2, bidId: 'synthetic-existing-award' };
    const result = await commit();
    expect(result.result).toMatchObject({ kind: 'rejected', code: 'POSITION_FILLED' });
    expect(result.canonicalState).toBeNull();
    expectNoAwardEvidence();
  });

  it.each(['live.amend_selection', 'live.resolve_specialty_candidate'] as const)(
    '%s cannot replace an existing award with an ineligible specialty target',
    async (type) => {
      const prior = { memberId: MEMBER, ordinal: 1, bidId: 'synthetic-existing-award' };
      state.fills[PRIOR_SEAT] = prior;
      state.live = {
        currentStageId: 'synthetic-ff',
        completedStageIds: [],
        pausedPhase: null,
        lastSelectionBidId: prior.bidId,
        dispositions: [],
        specialty:
          type === 'live.resolve_specialty_candidate'
            ? {
                specialtyId: 'synthetic-specialty',
                positionId: SEAT,
                suspendedBidderId: MEMBER,
                candidateMemberIds: [MEMBER],
                candidateCursor: 0,
              }
            : null,
      };
      const common = {
        v: 1 as const,
        commandId: KEY,
        bidSessionId: SESSION,
        expectedSeq: 7,
        actor: { id: MEMBER, role: 'admin' as const },
        reason: 'Synthetic ineligible award replacement regression',
        evidenceReference: null,
        memberId: MEMBER,
      };
      const command: LiveBidCommand =
        type === 'live.amend_selection'
          ? { ...common, type, fromPositionId: PRIOR_SEAT, toPositionId: SEAT }
          : { ...common, type, outcome: 'ACCEPT' };
      const result = await commit(command);
      expect(result.result).toMatchObject({ kind: 'rejected', code: 'MEMBER_NOT_ELIGIBLE' });
      expect(result.canonicalState).toBeNull();
      expect(state.fills).toEqual({ [PRIOR_SEAT]: prior });
      expectNoAwardEvidence();
    },
  );
});
