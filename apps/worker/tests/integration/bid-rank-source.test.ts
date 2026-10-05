import { createHash } from 'node:crypto';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { type BidSessionState, emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { prepareBidDefinitionRun } from '../../src/lib/bid-definition-run.js';
import {
  captureBidDefinitionControl,
  captureBidDefinitionSource,
} from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import {
  type BidFormArchive,
  BidFormArchiveSchema,
  type BidFormReceipt,
  bidFormArchiveHash,
} from '../../src/lib/bid-form-source.js';
import {
  bidLaunchContextForSnapshot,
  buildBidLaunchReview,
} from '../../src/lib/bid-launch-review.js';
import { loadBidSessionPolicySnapshot } from '../../src/lib/bid-policy.js';
import {
  RANK_SOURCE_OPERATION,
  type RankSourceReceipt,
  applyRankSource,
  applyStoredSessionRankSource,
  buildRankSourceMembers,
  createRankSourceReceipt,
  loadActiveRankCheckpoint,
  loadSessionRankSource,
  rankSourceKey,
} from '../../src/lib/bid-rank-source.js';
import { readBidSessionLaunchReview } from '../../src/lib/bid-session-launch-review.js';
import { signJwt } from '../../src/lib/jwt.js';
import adminBidForms from '../../src/routes/admin/bid-forms.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const YEAR = 2026;
const MEMBER = 10001;
const ACTIVE_BIDDER = 228;
const LEGACY_BIDDER = 1;
const syntheticMembers = [
  MEMBER,
  MEMBER + 1,
  MEMBER + 2,
  MEMBER + 3,
  MEMBER + 4,
  MEMBER + 5,
  ACTIVE_BIDDER,
  LEGACY_BIDDER,
];
const SESSION = 'synthetic-rank-source-real';
const MOCK = 'synthetic-rank-source-old-mock';
const NOW = Date.parse('2026-10-05T10:00:00.000Z');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const categories = [
  ['CAPTAIN_FIVE', 'A212'],
  ['DRIVER_ENGINEER', 'A303'],
  ['FIRE_INVESTIGATOR', 'A305'],
  ['ORDINARY_FIREFIGHTER', 'A105'],
  ['ORDINARY_LIEUTENANT', 'A102'],
  ['PREVENTION_CAPTAIN', 'D101'],
  ['PREVENTION_LIEUTENANT', 'D103'],
  ['AIR_TECH', 'A203'],
  ['STATION_TWO_CAPTAIN', 'A201'],
  ['STATION_TWO_DRIVER_ENGINEER', 'A202'],
  ['STATION_TWO_FIREFIGHTER', 'A204'],
  ['STATION_TWO_LIEUTENANT', 'A205'],
  ['MARINE_ENGINEER', 'A603'],
  ['MARINE_OPERATOR', 'A602'],
  ['MARINE_CAPTAIN', 'A601'],
  ['MARINE_FIREFIGHTER', 'A604'],
] as const;

// Complete synthetic categories exercise the production normalizer without
// importing Department identities, source contacts or private files into Git.
function archive(): BidFormArchive {
  const values = {
    total: 12,
    driverEngineer: 2,
    airTech: 4,
    carSeat: 1,
    preferences: 3,
    requiredTotal: 5,
  };
  return BidFormArchiveSchema.parse({
    v: 1,
    year: YEAR,
    source: { name: 'Synthetic final forms.xlsx', sha256: 'a'.repeat(64) },
    forms: [],
    notSubmitted: [],
    unlinkedNotSubmitted: [],
    rankLists: categories.map(([listId]) => ({
      listId,
      title: `Synthetic ${listId}`,
      source: { name: `${listId}.pdf`, sha256: 'b'.repeat(64), pages: 1, generatedAt: [] },
      columns: Object.keys(values),
      columnLabels: Object.fromEntries(Object.keys(values).map((key) => [key, key])),
      rows: [
        {
          employeeId: 'synthetic-rank-editor',
          sourceMemberName: 'Reviewer,Synthetic',
          sourceRank: 'CPT',
          bidOrder: null,
          values,
          provenance: [{ page: 1, textLine: 4, bbox: [0, 0, 200, 10] }],
        },
      ],
    })),
  });
}

function settings() {
  return {
    v: 3,
    expectedDurationDays: 2,
    turnTimerSeconds: 180,
    credentialEvaluationOn: '2026-10-05',
    personnelEvaluationOn: '2026-10-05',
    livePolicy: FrozenLiveBidPolicySchema.parse({
      v: 1,
      policyRevision: 'synthetic-rank-source-policy',
      stages: [
        {
          id: 'synthetic-captains',
          label: 'Synthetic captains',
          order: 0,
          memberIds: syntheticMembers,
          opportunityPositionIds: categories.map(([, id]) => id),
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
        requiresReason: false,
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
    }),
  };
}

describe('final rank source receipt integrity and protected session integration', () => {
  let h: TestD1;
  let token: string;
  let snapshot: PinnedBidSessionPolicySnapshot;
  let snapshotSha256: string;
  let archiveSha256: string;
  let currentSource: BidFormReceipt;
  const app = new Hono<{ Bindings: WorkerEnv }>().route('/api/admin/bid-forms', adminBidForms);

  function request(path: string, body?: unknown, jwt = token) {
    return app.request(
      `/api/admin/bid-forms${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      h.env,
    );
  }

  const apply = (sessionId = SESSION, overrides: Record<string, unknown> = {}) =>
    request(`/2026/sessions/${sessionId}/score-reference`, {
      archiveSha256,
      expectedSnapshotSha256: snapshotSha256,
      expectedVersionSha256: snapshot.bidDefinition.versionSha256,
      ...overrides,
    });

  function makeReceipt(overrides: Partial<RankSourceReceipt['record']> = {}) {
    return createRankSourceReceipt({
      year: YEAR,
      sessionId: SESSION,
      versionId: snapshot.bidDefinition.versionId,
      versionSha256: snapshot.bidDefinition.versionSha256,
      baseSnapshotSha256: snapshotSha256,
      archiveSha256,
      appliedBy: String(MEMBER),
      appliedAt: NOW,
      members: buildRankSourceMembers(snapshot, archive()),
      ...overrides,
    });
  }

  function storeReceipt(receipt: RankSourceReceipt) {
    h.sqlite
      .prepare(`INSERT INTO admin_configuration_receipts
      (idempotency_key,actor_subject,operation,request_json,response_json,created_at)
      VALUES(?,?,?,?,?,?)`)
      .run(
        rankSourceKey(receipt.record.sessionId, receipt.record.archiveSha256),
        receipt.record.appliedBy,
        RANK_SOURCE_OPERATION,
        '{}',
        JSON.stringify(receipt),
        receipt.record.appliedAt,
      );
  }

  function insertSession(sessionId: string, isMock: boolean, body = snapshot) {
    const own = { ...body, bidDefinition: { ...body.bidDefinition, bidSessionId: sessionId } };
    const json = JSON.stringify(own);
    h.sqlite
      .prepare(`INSERT INTO bid_sessions
      (id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
      VALUES(?,2026,?,'config',?,180,2,?)`)
      .run(sessionId, NOW, isMock ? 1 : 0, JSON.stringify(own.settings));
    h.sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,
       bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(
        sessionId,
        own.ruleBookVersion,
        own.positionTemplateVersion,
        own.ruleBookRevision,
        json,
        own.capturedAtMs,
        own.bidDefinition.versionId,
        own.bidDefinition.versionSha256,
        hash(json),
        own.bidDefinition.contextSha256,
      );
    return hash(json);
  }

  function rankReceiptCount() {
    return h.sqlite
      .prepare('SELECT COUNT(*) AS count FROM admin_configuration_receipts WHERE operation=?')
      .get(RANK_SOURCE_OPERATION) as { count: number };
  }

  function seedActive(
    options: {
      sessionPhase?: string;
      frozenAt?: number;
      sessionBidderId?: number;
      canonicalBidderId?: number;
      canonicalBidderPool?: 'OFC' | 'FF';
    } = {},
  ) {
    const state: BidSessionState = {
      ...emptyBidSessionState(SESSION),
      currentPhase: 'position_bid',
      currentBidderId: options.canonicalBidderId ?? ACTIVE_BIDDER,
      turnStartedAtMs: NOW,
      bidOrder: syntheticMembers.map((memberId, ordinal) => ({
        memberId,
        ordinal,
        pool: memberId === ACTIVE_BIDDER ? (options.canonicalBidderPool ?? 'OFC') : 'OFC',
        stageId: 'synthetic-captains',
      })),
      queueCursor: 6,
      live: {
        currentStageId: 'synthetic-captains',
        completedStageIds: [],
        pausedPhase: null,
        lastSelectionBidId: null,
        dispositions: [],
        specialty: null,
        corrections: [],
        presentation: { mode: 'LIVE', heldAtSeq: null, heldProjection: null },
      },
    };
    h.sqlite
      .prepare(`UPDATE bid_sessions SET current_phase=?,current_bidder_id=?,frozen_at=?
      WHERE id=?`)
      .run(
        options.sessionPhase ?? 'position_bid',
        options.sessionBidderId ?? LEGACY_BIDDER,
        options.frozenAt ?? null,
        SESSION,
      );
    for (const row of state.bidOrder) {
      h.sqlite
        .prepare(
          'INSERT INTO bid_order(bid_session_id,ordinal,member_id,pool,stage_id) VALUES(?,?,?,?,?)',
        )
        .run(SESSION, row.ordinal, row.memberId, row.pool, row.stageId);
    }
    h.sqlite
      .prepare(`INSERT INTO canonical_bid_session_state
      (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at)
      VALUES(?,0,?,NULL,?,?)`)
      .run(SESSION, JSON.stringify(state), NOW, NOW);
    for (let seq = 1; seq <= 7; seq++) {
      const commandId = `synthetic-active-command-${seq}`;
      if (seq <= 5) {
        const positionId = categories[seq - 1]?.[1];
        if (!positionId) throw new Error('Synthetic seat missing');
        state.fills[positionId] = {
          memberId: MEMBER + seq,
          ordinal: seq,
          bidId: `synthetic-award-${seq}`,
          aDay: seq % 2 === 0 ? 'G2' : 'G1',
          ...(seq === 5
            ? { forced: { commandId, actorMemberId: MEMBER, reason: '', atMs: NOW } }
            : {}),
        };
      } else if (seq === 6 && state.live) {
        const before = state.fills.A212;
        if (!before) throw new Error('Synthetic prior award missing');
        const after = { ...before, bidId: 'synthetic-corrected-award', aDay: 'G3' as const };
        const { A212: _prior, ...otherFills } = state.fills;
        state.fills = { ...otherFills, D101: after };
        state.live.corrections = [
          {
            bidId: after.bidId,
            commandId,
            originalBidId: before.bidId,
            originalCommandId: 'synthetic-active-command-1',
            originalADayCommandId: null,
            before: { positionId: 'A212', fill: before, aDay: null },
            after: { positionId: 'D101', fill: after },
            resolvesCorrectionBidId: null,
            actorMemberId: MEMBER,
            reason: '',
            sequence: seq,
            atMs: NOW,
          },
        ];
      }
      state.lastSeq = seq;
      h.sqlite
        .prepare(`UPDATE canonical_bid_session_state
        SET current_seq=?,state_json=?,last_command_id=?,updated_at=? WHERE bid_session_id=?`)
        .run(seq, JSON.stringify(state), commandId, NOW + seq, SESSION);
      h.sqlite
        .prepare(`INSERT INTO bid_command_receipts
        (command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at)
        VALUES(?,?,?, ?,?,?,?,'accepted',?,?)`)
        .run(
          commandId,
          SESSION,
          seq === 6 ? 'live.amend_selection' : 'live.record_selection',
          hash(commandId),
          MEMBER,
          seq - 1,
          seq,
          JSON.stringify({ kind: 'accepted', commandId, seq }),
          NOW + seq,
        );
      const auditId = `synthetic-active-audit-${seq}`;
      h.sqlite
        .prepare(`INSERT INTO audit_log
        (id,bid_session_id,seq,actor_type,actor_id,action,target_kind,target_id,after_state,created_at)
        VALUES(?,?,?,'admin',?,'bid_pick','bid_session',?,?,?)`)
        .run(auditId, SESSION, seq, MEMBER, SESSION, JSON.stringify(state), NOW + seq);
      h.sqlite
        .prepare(`INSERT INTO bid_command_events
        (id,bid_session_id,command_id,audit_log_id,seq,event_type,event_json,actor_id,created_at)
        VALUES(?,?,?,?,?,'synthetic-award',?,?,?)`)
        .run(
          `synthetic-active-event-${seq}`,
          SESSION,
          commandId,
          auditId,
          seq,
          JSON.stringify(state),
          MEMBER,
          NOW + seq,
        );
    }
    const raw = h.sqlite
      .prepare('SELECT state_json FROM canonical_bid_session_state WHERE bid_session_id=?')
      .get(SESSION) as { state_json: string };
    return {
      checkpoint: {
        expectedCanonicalSeq: state.lastSeq,
        expectedCanonicalStateSha256: hash(raw.state_json),
      },
      state,
    };
  }

  function advanceActive(state: BidSessionState) {
    state.lastSeq++;
    h.sqlite
      .prepare(`UPDATE canonical_bid_session_state
      SET current_seq=?,state_json=?,last_command_id='synthetic-concurrent-command',updated_at=?
      WHERE bid_session_id=?`)
      .run(state.lastSeq, JSON.stringify(state), NOW + 50, SESSION);
  }

  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.exec(`INSERT INTO members
      (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
      VALUES(${MEMBER},'synthetic-rank-editor','Synthetic','Reviewer','CPT','OFC',1,0,1,1);
      INSERT INTO position_templates(version,effective_year) VALUES('2026.synthetic-ranks',2026);
      INSERT INTO rule_books(version,effective_year,status,revision) VALUES('2026.synthetic-ranks',2026,'draft',0);`);
    for (const memberId of syntheticMembers.slice(1)) {
      h.sqlite
        .prepare(`INSERT INTO members
        (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
        VALUES(?,?,'Synthetic',?,'CPT','OFC',?,0,1,1)`)
        .run(memberId, `synthetic-rank-${memberId}`, `Member ${memberId}`, memberId);
    }
    h.sqlite
      .prepare(`INSERT INTO bid_years
      (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES(2026,'configuring','2026.synthetic-ranks','2026.synthetic-ranks',1,?)`)
      .run(JSON.stringify(settings()));
    categories.forEach(([, id], index) => {
      h.sqlite
        .prepare(`INSERT INTO positions
        (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES(?,'2026.synthetic-ranks',?,'1','Combat','Synthetic engine','CPT',?)`)
        .run(id, id.startsWith('D') ? 'D' : 'A', `Synthetic ${id}`);
      // Distinct executable profiles ensure category scopes cannot overlap.
      h.sqlite
        .prepare(`INSERT INTO position_rules
        (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES('2026.synthetic-ranks',?,'2026.synthetic-ranks',?,?,?)`)
        .run(
          id,
          JSON.stringify({
            rank: ['CPT'],
            credentials: [`Synthetic required ${index}`],
            custom: [],
          }),
          JSON.stringify({ max: index + 1, items: [] }),
          '["points","rsc_seniority"]',
        );
    });
    const captured = await captureBidDefinitionSource(h.env.DB, YEAR);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const saved = await saveBidDefinition(h.env.DB, {
      year: YEAR,
      key: 'synthetic-rank-adoption',
      actorSubject: String(MEMBER),
      actorId: MEMBER,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic immutable rank fixture',
      intent: { operation: 'save', content: captured.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const version = await loadBidDefinitionVersion(
      h.env.DB,
      YEAR,
      String(saved.response.versionId),
    );
    if (!version.ok) throw new Error(JSON.stringify(version));
    const participation = new Map(
      version.content.participation.map((entry) => [entry.positionId, entry.bidParticipation]),
    );
    const base = BidSessionPolicySnapshotSchema.parse({
      v: 3,
      ruleBookVersion: version.row.rule_book_version,
      ruleBookRevision: version.row.rule_book_revision,
      positionTemplateVersion: version.row.position_template_version,
      configurationRevision: version.row.version_number,
      settings: version.content.settings,
      credentialEvaluationOn: '2026-10-05',
      capturedAtMs: NOW,
      members: syntheticMembers.map((memberId) => ({
        memberId,
        pool: 'OFC',
        rscSeniority: 1,
        rankSeniority: 2,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'CPT',
        isProbationary: false,
        credentialNames: ['Synthetic baseline credential'],
        specialtyQualifications: [],
        scoringEvidence: {
          evaluationOn: '2026-10-05',
          completedCredentialNames: ['Synthetic baseline credential'],
        },
      })),
      operatorIdentityProjection: syntheticMembers.map((memberId) => ({
        memberId,
        employeeId: memberId === MEMBER ? 'synthetic-rank-editor' : `synthetic-rank-${memberId}`,
        firstName: 'Synthetic',
        lastName: memberId === MEMBER ? 'Reviewer' : `Member ${memberId}`,
        rank: 'CPT',
      })),
      ruleBookMaterial: {
        v: 1,
        positions: version.content.positions.map((position) => ({
          ...position,
          templateVersion: version.row.position_template_version,
          bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
        })),
        rules: version.content.rules.map((rule) => ({
          positionId: rule.positionId,
          templateVersion: version.row.position_template_version,
          ruleBookVersion: version.row.rule_book_version,
          requiredCriteriaJson: rule.requiredCriteriaJson,
          pointsPreferenceJson: rule.pointsPreferenceJson,
          tieBreakChainJson: rule.tieBreakChainJson,
        })),
      },
    });
    if (base.v !== 3) throw new Error('Synthetic V3 snapshot required');
    snapshot = {
      ...base,
      bidDefinition: {
        v: 1,
        bidSessionId: SESSION,
        bidYear: YEAR,
        versionId: version.row.id,
        versionSha256: version.sha256,
        contextSha256: bidDefinitionContextHash(base),
      },
    };
    snapshotSha256 = insertSession(SESSION, false);
    insertSession(MOCK, true);
    archiveSha256 = await bidFormArchiveHash(archive());
    currentSource = {
      archive: archive(),
      sha256: archiveSha256,
      publishedBy: String(MEMBER),
      publishedAt: '2026-10-05T10:00:00.000Z',
    };
    h.env.R2_EXPORTS = {
      get: async () => ({
        etag: hash(JSON.stringify(currentSource)),
        json: async () => structuredClone(currentSource),
      }),
    } as unknown as WorkerEnv['R2_EXPORTS'];
    token = await signJwt(
      {
        sub: MEMBER,
        emp: 'synthetic-rank-editor',
        role: 'admin',
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Reviewer',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => teardownTestD1(h));

  it('normalizes all source categories while preserving literal totals and document priority', () => {
    const rows = buildRankSourceMembers(snapshot, archive());
    expect(rows).toHaveLength(1);
    const references = rows[0]?.scoreReferenceEvidence ?? [];
    expect(references).toHaveLength(16);
    const totals = Object.fromEntries(
      references.map((reference) => [reference.listId, reference.points]),
    );
    expect(totals).toMatchObject({
      CAPTAIN_FIVE: 12,
      DRIVER_ENGINEER: 0,
      FIRE_INVESTIGATOR: 3,
      ORDINARY_FIREFIGHTER: 0,
      ORDINARY_LIEUTENANT: 0,
      PREVENTION_CAPTAIN: 0,
      PREVENTION_LIEUTENANT: 12,
      AIR_TECH: 6,
      STATION_TWO_CAPTAIN: 12,
      STATION_TWO_DRIVER_ENGINEER: 10,
      STATION_TWO_FIREFIGHTER: 12,
      STATION_TWO_LIEUTENANT: 12,
      MARINE_ENGINEER: 7,
      MARINE_OPERATOR: 7,
      MARINE_CAPTAIN: 7,
      MARINE_FIREFIGHTER: 7,
    });
    expect(references.find((reference) => reference.listId === 'AIR_TECH')?.soPoints).toBe(5);
    for (const reference of references) {
      expect(reference.literalTotal).toBe(12);
      expect(reference.printedBidOrder).toBeNull();
      expect(reference.sourcePriority).toBe(1);
      expect(reference.sourceLocation).toEqual({ page: 1, textLine: 4 });
      expect(reference.positionIds).toHaveLength(1);
    }
  });

  it.each(['employeeId', 'sourceMemberName', 'sourceRank'] as const)(
    'rejects a source %s mismatch instead of inferring identity',
    (field) => {
      const value = archive();
      const row = value.rankLists?.[0]?.rows[0];
      if (!row) throw new Error('Synthetic row missing');
      row[field] = 'Wrong synthetic identity';
      expect(() => buildRankSourceMembers(snapshot, value)).toThrow(
        'rank_source_identity_mismatch',
      );
    },
  );

  it('rejects incomplete lists, missing executable profiles and negative derived points', () => {
    const missing = archive();
    missing.rankLists?.pop();
    expect(() => buildRankSourceMembers(snapshot, missing)).toThrow(
      'rank_source_complete_final_lists_required',
    );
    const unknown = archive();
    if (!unknown.rankLists?.[0]) throw new Error('Synthetic list missing');
    unknown.rankLists[0].listId = 'UNREVIEWED_PROFILE';
    expect(() => buildRankSourceMembers(snapshot, unknown)).toThrow('rank_source_profile_missing');
    const negative = archive();
    const row = negative.rankLists?.find((list) => list.listId === 'AIR_TECH')?.rows[0];
    if (!row) throw new Error('Synthetic row missing');
    row.values.total = 1;
    expect(() => buildRankSourceMembers(snapshot, negative)).toThrow();
  });

  it('applies only score references without granting credentials or changing rules, rank or seniority', () => {
    const before = JSON.stringify(snapshot);
    const receipt = makeReceipt();
    const result = applyRankSource(snapshot, receipt);
    const { scoreReferenceEvidence, ...member } = result.members[0] ?? {};
    expect(scoreReferenceEvidence).toHaveLength(16);
    expect(member).toEqual(snapshot.members[0]);
    expect(result.ruleBookMaterial).toEqual(snapshot.ruleBookMaterial);
    expect(result.settings).toEqual(snapshot.settings);
    expect(result.operatorIdentityProjection).toEqual(snapshot.operatorIdentityProjection);
    expect((result as PinnedBidSessionPolicySnapshot).bidDefinition).toEqual(
      snapshot.bidDefinition,
    );
    expect(result.scoreReferenceSource?.receiptSha256).toBe(receipt.sha256);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('rejects tampered receipt content, version pins, duplicate identities and unknown position scopes', () => {
    const tampered = makeReceipt();
    const tamperedMember = tampered.record.members[0];
    if (!tamperedMember) throw new Error('Synthetic member missing');
    tamperedMember.employeeId = 'wrong';
    expect(() => applyRankSource(snapshot, tampered)).toThrow(
      'rank_source_receipt_integrity_failed',
    );
    expect(() => applyRankSource(snapshot, makeReceipt({ versionSha256: 'f'.repeat(64) }))).toThrow(
      'rank_source_receipt_integrity_failed',
    );
    const duplicate = makeReceipt();
    expect(() =>
      applyRankSource(
        snapshot,
        makeReceipt({ members: [...duplicate.record.members, ...duplicate.record.members] }),
      ),
    ).toThrow('rank_source_identity_mismatch');
    const unknown = makeReceipt();
    const unknownReference = unknown.record.members[0]?.scoreReferenceEvidence[0];
    if (!unknownReference) throw new Error('Synthetic reference missing');
    unknownReference.positionIds = ['unknown-synthetic-seat'];
    expect(() =>
      applyRankSource(snapshot, makeReceipt({ members: unknown.record.members })),
    ).toThrow('rank_source_scope_mismatch');
  });

  it('preserves old Mock material with no session receipt', async () => {
    const old = await loadBidSessionPolicySnapshot(getDb(h.env.DB), MOCK);
    expect(old.error).toBeNull();
    const before = JSON.stringify(old.snapshot);
    storeReceipt(makeReceipt());
    expect(
      JSON.stringify((await loadBidSessionPolicySnapshot(getDb(h.env.DB), MOCK)).snapshot),
    ).toBe(before);
  });

  it('binds new Mock snapshots to the reviewed version receipt without altering prior Mock snapshots', async () => {
    expect((await apply()).status).toBe(201);
    const receipt = await loadSessionRankSource(getDb(h.env.DB), SESSION);
    const prepared = await prepareBidDefinitionRun(h.env.DB, {
      year: YEAR,
      versionId: snapshot.bidDefinition.versionId,
      versionSha256: snapshot.bidDefinition.versionSha256,
      bidSessionId: 'synthetic-new-mock',
      capturedAtMs: NOW + 2,
      mode: 'mock',
      operatorControlledLaunch: true,
    });
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (!prepared.ok || !receipt) throw new Error('Synthetic preparation missing');
    expect(prepared.snapshot.scoreReferenceSource?.receiptSha256).toBe(receipt.sha256);
    expect(
      prepared.snapshot.members.find((member) => member.memberId === MEMBER)
        ?.scoreReferenceEvidence,
    ).toHaveLength(16);
    insertSession('synthetic-new-mock', true, prepared.snapshot);
    const reloaded = await loadBidSessionPolicySnapshot(getDb(h.env.DB), 'synthetic-new-mock');
    expect(reloaded.error).toBeNull();
    expect(
      reloaded.snapshot?.v === 3 && reloaded.snapshot.scoreReferenceSource?.receiptSha256,
    ).toBe(receipt.sha256);
    const previous = await loadBidSessionPolicySnapshot(getDb(h.env.DB), MOCK);
    expect(previous.snapshot?.v === 3 && previous.snapshot.scoreReferenceSource).toBeUndefined();
  });

  it('changes the guarded creation source token when a reviewed rank receipt is committed', async () => {
    const before = await captureBidDefinitionControl(h.env.DB, YEAR);
    expect((await apply()).status).toBe(201);
    const after = await captureBidDefinitionControl(h.env.DB, YEAR);
    expect(before?.token).toBeTruthy();
    expect(after?.token).toBeTruthy();
    expect(after?.token).not.toBe(before?.token);
  });

  it('requires a new launch review after scoring changes even when the base launch was acknowledged', async () => {
    const context = bidLaunchContextForSnapshot(snapshot, 'live');
    if (!context) throw new Error('Synthetic launch context missing');
    const review = buildBidLaunchReview(context, []);
    h.sqlite
      .prepare(`INSERT INTO audit_log
      (id,bid_session_id,seq,actor_type,actor_id,action,target_kind,target_id,after_state,created_at)
      VALUES('synthetic-launch-ack',?,1,'admin',?,'session_start','bid_session',?,?,?)`)
      .run(
        SESSION,
        MEMBER,
        SESSION,
        JSON.stringify({ operatorLaunchReview: { ...context, review, acknowledged: true } }),
        NOW,
      );
    expect((await readBidSessionLaunchReview(h.env.DB, SESSION, snapshot, false))?.ok).toBe(true);
    expect((await apply()).status).toBe(201);
    const loaded = await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION);
    if (!loaded.snapshot) throw new Error('Synthetic derived snapshot missing');
    const updated = await readBidSessionLaunchReview(h.env.DB, SESSION, loaded.snapshot, false);
    expect(updated?.ok).toBe(true);
    if (!updated?.ok) throw new Error('Synthetic derived launch review missing');
    expect(updated.context.contextSha256).not.toBe(context.contextSha256);
    expect(updated.review.advisories).toContainEqual(
      expect.objectContaining({ id: 'final_rank_priorities' }),
    );
    expect(updated.acknowledged).toBe(false);
  });

  it('verifies inherited references by exact receipt after a newer Real receipt for the same version', async () => {
    const original = makeReceipt();
    storeReceipt(original);
    const inherited = applyRankSource(snapshot, original);
    storeReceipt(
      makeReceipt({
        sessionId: 'synthetic-later-real',
        archiveSha256: 'c'.repeat(64),
        appliedAt: NOW + 1,
      }),
    );
    expect(
      await applyStoredSessionRankSource(
        getDb(h.env.DB),
        'synthetic-inherited-mock',
        inherited,
        'd'.repeat(64),
      ),
    ).toEqual(inherited);
  });

  it('fails closed when inherited source binding, receipt hash or base snapshot binding is missing', async () => {
    const receipt = makeReceipt();
    const inherited = applyRankSource(snapshot, receipt);
    await expect(
      applyStoredSessionRankSource(getDb(h.env.DB), MOCK, inherited, snapshotSha256),
    ).rejects.toThrow('rank_source_receipt_integrity_failed');
    const { scoreReferenceSource: _binding, ...unbound } = inherited;
    await expect(
      applyStoredSessionRankSource(getDb(h.env.DB), MOCK, unbound, snapshotSha256),
    ).rejects.toThrow('rank_source_receipt_integrity_failed');
    storeReceipt(receipt);
    await expect(
      applyStoredSessionRankSource(getDb(h.env.DB), SESSION, snapshot, 'f'.repeat(64)),
    ).rejects.toThrow('rank_source_receipt_integrity_failed');
  });

  it('lists only prepared Real bids with exact pins and reports applied status', async () => {
    const before = hash(Buffer.from(h.sqlite.serialize()).toString('base64'));
    const preview = await request('/2026/score-review');
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      year: 2026,
      archiveSha256,
      available: true,
      sessions: [
        {
          id: SESSION,
          isMock: false,
          phase: 'config',
          alreadyApplied: false,
          expectedSnapshotSha256: snapshotSha256,
          expectedVersionSha256: snapshot.bidDefinition.versionSha256,
        },
      ],
    });
    expect(hash(Buffer.from(h.sqlite.serialize()).toString('base64'))).toBe(before);
    expect((await apply()).status).toBe(201);
    expect(await (await request('/2026/score-review')).json()).toMatchObject({
      sessions: [{ id: SESSION, alreadyApplied: true }],
    });
  });

  it('atomically stores one immutable receipt and audit, supports exact retry and leaves snapshots and selections unchanged', async () => {
    const originalSnapshots = h.sqlite
      .prepare('SELECT * FROM bid_session_policy_snapshots ORDER BY bid_session_id')
      .all();
    const oldMock = await loadBidSessionPolicySnapshot(getDb(h.env.DB), MOCK);
    const first = await apply();
    expect(first.status).toBe(201);
    const result = (await first.json()) as {
      receiptSha256: string;
      memberCount: number;
      referenceCount: number;
      alreadyApplied: boolean;
    };
    expect(result).toMatchObject({ memberCount: 1, referenceCount: 16, alreadyApplied: false });
    expect(result.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    const retry = await apply();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ ...result, alreadyApplied: true });
    expect(rankReceiptCount().count).toBe(1);
    expect(
      h.sqlite
        .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE target_kind='rank_source'")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      h.sqlite.prepare('SELECT * FROM bid_session_policy_snapshots ORDER BY bid_session_id').all(),
    ).toEqual(originalSnapshots);
    const loaded = await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION);
    expect(loaded.error).toBeNull();
    expect(
      loaded.snapshot?.v === 3 && loaded.snapshot.members[0]?.scoreReferenceEvidence,
    ).toHaveLength(16);
    expect(loaded.snapshot?.v === 3 && loaded.snapshot.members[0]?.credentialNames).toEqual([
      'Synthetic baseline credential',
    ]);
    expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), MOCK)).toEqual(oldMock);
    for (const table of [
      'canonical_bid_session_state',
      'bid_order',
      'bids',
      'bid_command_receipts',
    ])
      expect(h.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
  });

  it('rejects direct publication to an old config Mock, even with its exact current pins', async () => {
    const pin = h.sqlite
      .prepare('SELECT snapshot_sha256 FROM bid_session_policy_snapshots WHERE bid_session_id=?')
      .get(MOCK) as { snapshot_sha256: string };
    const before = hash(Buffer.from(h.sqlite.serialize()).toString('base64'));
    expect((await apply(MOCK, { expectedSnapshotSha256: pin.snapshot_sha256 })).status).toBe(409);
    expect(rankReceiptCount().count).toBe(0);
    expect(hash(Buffer.from(h.sqlite.serialize()).toString('base64'))).toBe(before);
  });

  it.each(['archiveSha256', 'expectedSnapshotSha256', 'expectedVersionSha256'])(
    'rejects stale %s without storing a receipt',
    async (field) => {
      expect((await apply(SESSION, { [field]: 'f'.repeat(64) })).status).toBe(409);
      expect(rankReceiptCount().count).toBe(0);
    },
  );

  it('requires authorization and intact published source', async () => {
    expect((await request('/2026/score-review', undefined, 'invalid')).status).toBe(401);
    const member = await signJwt(
      {
        sub: MEMBER,
        emp: 'synthetic-rank-editor',
        role: 'member',
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Reviewer',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    expect((await request('/2026/score-review', undefined, member)).status).toBe(403);
    currentSource.sha256 = 'f'.repeat(64);
    expect((await request('/2026/score-review')).status).toBe(503);
    expect((await apply()).status).toBe(503);
    expect(rankReceiptCount().count).toBe(0);
  });

  it('updates active future scoring at an exact checkpoint without changing five recorded fills, forced markers, corrections or history', async () => {
    const active = seedActive();
    expect(active.state.currentBidderId).toBe(ACTIVE_BIDDER);
    expect(
      h.sqlite.prepare('SELECT current_bidder_id FROM bid_sessions WHERE id=?').get(SESSION),
    ).toEqual({ current_bidder_id: LEGACY_BIDDER });
    expect(await loadActiveRankCheckpoint(h.env.DB, SESSION)).toMatchObject({ ok: true });
    const preservedTables = [
      'bid_sessions',
      'bid_session_policy_snapshots',
      'canonical_bid_session_state',
      'bid_order',
      'bids',
      'a_day_picks',
      'bid_command_receipts',
      'bid_command_events',
    ];
    const before = preservedTables.map(
      (table) => [table, h.sqlite.prepare(`SELECT * FROM ${table}`).all()] as const,
    );
    const auditBefore = h.sqlite.prepare('SELECT * FROM audit_log ORDER BY seq').all();
    const metadata = await request('/2026/score-review');
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      sessions: [
        {
          id: SESSION,
          phase: 'position_bid',
          ...active.checkpoint,
        },
      ],
    });
    const response = await apply(SESSION, active.checkpoint);
    expect(response.status).toBe(201);
    const receipt = (await response.json()) as { activeCheckpoint: unknown; receiptSha256: string };
    expect(receipt.activeCheckpoint).toEqual({
      phase: 'position_bid',
      canonicalSeq: 7,
      canonicalStateSha256: active.checkpoint.expectedCanonicalStateSha256,
    });
    for (const [table, rows] of before)
      expect(h.sqlite.prepare(`SELECT * FROM ${table}`).all(), table).toEqual(rows);
    expect(
      h.sqlite
        .prepare("SELECT * FROM audit_log WHERE target_kind<>'rank_source' ORDER BY seq")
        .all(),
    ).toEqual(auditBefore);
    const loaded = await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION);
    expect(loaded.error).toBeNull();
    expect(
      loaded.snapshot?.v === 3 && loaded.snapshot.members[0]?.scoreReferenceEvidence,
    ).toHaveLength(16);
    expect(loaded.snapshot?.v === 3 && loaded.snapshot.members[0]?.credentialNames).toEqual([
      'Synthetic baseline credential',
    ]);
    const stored = await loadSessionRankSource(getDb(h.env.DB), SESSION);
    expect(stored?.record.activeCheckpoint).toEqual(receipt.activeCheckpoint);
    expect(stored?.sha256).toBe(receipt.receiptSha256);
    expect((await apply(SESSION, active.checkpoint)).status).toBe(200);
    expect(rankReceiptCount().count).toBe(1);
    expect(Object.keys(active.state.fills)).toHaveLength(5);
    expect(active.state.fills.A102?.forced).toBeDefined();
    expect(active.state.fills.D101?.aDay).toBe('G3');
    expect(active.state.live?.corrections).toHaveLength(1);
  });

  it.each(['expectedCanonicalSeq', 'expectedCanonicalStateSha256', 'archiveSha256'])(
    'rejects a stale active %s without changing progress or committing a receipt',
    async (field) => {
      const active = seedActive();
      const before = hash(Buffer.from(h.sqlite.serialize()).toString('base64'));
      const changed = field === 'expectedCanonicalSeq' ? 6 : 'f'.repeat(64);
      expect((await apply(SESSION, { ...active.checkpoint, [field]: changed })).status).toBe(409);
      expect(rankReceiptCount().count).toBe(0);
      expect(hash(Buffer.from(h.sqlite.serialize()).toString('base64'))).toBe(before);
    },
  );

  it('requires both fresh checkpoint fields for an active update', async () => {
    const active = seedActive();
    expect((await apply()).status).toBe(409);
    expect(
      (await apply(SESSION, { expectedCanonicalSeq: active.checkpoint.expectedCanonicalSeq }))
        .status,
    ).toBe(400);
    expect(
      (
        await apply(SESSION, {
          expectedCanonicalStateSha256: active.checkpoint.expectedCanonicalStateSha256,
        })
      ).status,
    ).toBe(400);
    expect(rankReceiptCount().count).toBe(0);
  });

  it('does not list or modify an active pending specialty capsule', async () => {
    const active = seedActive();
    if (!active.state.live) throw new Error('Synthetic live state missing');
    active.state.live.specialty = {
      specialtyId: 'synthetic-specialty',
      positionId: 'A212',
      suspendedBidderId: MEMBER,
      candidateMemberIds: [MEMBER],
      candidateCursor: 0,
    };
    advanceActive(active.state);
    const raw = JSON.stringify(active.state);
    expect(
      (
        await apply(SESSION, {
          expectedCanonicalSeq: active.state.lastSeq,
          expectedCanonicalStateSha256: hash(raw),
        })
      ).status,
    ).toBe(409);
    expect(await (await request('/2026/score-review')).json()).toMatchObject({ sessions: [] });
    expect(rankReceiptCount().count).toBe(0);
  });

  it.each(['frozen', 'complete', 'nonexistent_canonical_bidder', 'inconsistent_canonical_pool'])(
    'rejects an active %s session and preserves its progress',
    async (condition) => {
      const active = seedActive(
        condition === 'frozen'
          ? { frozenAt: NOW }
          : condition === 'complete'
            ? { sessionPhase: 'complete' }
            : condition === 'nonexistent_canonical_bidder'
              ? { canonicalBidderId: 90000 }
              : { canonicalBidderPool: 'FF' },
      );
      const before = hash(Buffer.from(h.sqlite.serialize()).toString('base64'));
      expect((await apply(SESSION, active.checkpoint)).status).toBe(409);
      expect(await (await request('/2026/score-review')).json()).toMatchObject({ sessions: [] });
      expect(hash(Buffer.from(h.sqlite.serialize()).toString('base64'))).toBe(before);
    },
  );

  it('rolls back active receipt and audit if canonical progress changes immediately before the batch', async () => {
    const active = seedActive();
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    const audits = h.sqlite.prepare('SELECT * FROM audit_log ORDER BY seq').all();
    h.env.DB.batch = async (statements) => {
      advanceActive(active.state);
      return originalBatch(statements);
    };
    expect((await apply(SESSION, active.checkpoint)).status).toBe(503);
    expect(rankReceiptCount().count).toBe(0);
    expect(h.sqlite.prepare('SELECT * FROM audit_log ORDER BY seq').all()).toEqual(audits);
    expect(
      h.sqlite
        .prepare('SELECT current_seq FROM canonical_bid_session_state WHERE bid_session_id=?')
        .get(SESSION),
    ).toEqual({ current_seq: 8 });
  });

  it('rolls back active receipt and audit if the captured legacy projection drifts before the batch', async () => {
    const active = seedActive();
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    const audits = h.sqlite.prepare('SELECT * FROM audit_log ORDER BY seq').all();
    h.env.DB.batch = async (statements) => {
      h.sqlite
        .prepare('UPDATE bid_sessions SET current_bidder_id=? WHERE id=?')
        .run(ACTIVE_BIDDER, SESSION);
      return originalBatch(statements);
    };
    expect((await apply(SESSION, active.checkpoint)).status).toBe(503);
    expect(rankReceiptCount().count).toBe(0);
    expect(h.sqlite.prepare('SELECT * FROM audit_log ORDER BY seq').all()).toEqual(audits);
    expect(
      h.sqlite
        .prepare('SELECT state_json FROM canonical_bid_session_state WHERE bid_session_id=?')
        .get(SESSION),
    ).toEqual({ state_json: JSON.stringify(active.state) });
  });

  it('rejects started sessions without canonical state or a checkpoint', async () => {
    h.sqlite
      .prepare("UPDATE bid_sessions SET current_phase='position_bid' WHERE id=?")
      .run(SESSION);
    expect((await apply()).status).toBe(409);
    expect(rankReceiptCount().count).toBe(0);
    expect(await (await request('/2026/score-review')).json()).toMatchObject({ sessions: [] });
  });

  it('rolls back both receipt and audit when the durable pre-start guard changes before the D1 batch', async () => {
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    h.env.DB.batch = async (statements) => {
      h.sqlite
        .prepare("UPDATE bid_sessions SET current_phase='position_bid' WHERE id=?")
        .run(SESSION);
      return originalBatch(statements);
    };
    expect((await apply()).status).toBe(503);
    expect(rankReceiptCount().count).toBe(0);
    expect(
      h.sqlite
        .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE target_kind='rank_source'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it('rolls back a receipt insert when the audit statement fails', async () => {
    h.failNextBatchAt(1);
    expect((await apply()).status).toBe(503);
    expect(rankReceiptCount().count).toBe(0);
    expect(await loadSessionRankSource(getDb(h.env.DB), SESSION)).toBeNull();
  });
});
