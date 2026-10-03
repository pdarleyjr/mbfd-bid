import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import {
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  type LiveBidCommand,
} from '@mbfd/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../src/commands/canonical-command-service.js';
import { type BidSessionState, emptyBidSessionState } from '../src/durable/bid-session-state.js';
import { initializeAnnualOperations } from '../src/lib/annual-bid-operations.js';
import { evaluateFrozenADays } from '../src/lib/frozen-a-day.js';

const migrations = resolve(fileURLToPath(new URL('.', import.meta.url)), '../migrations');
const sessionId = 'synthetic-admin-override';
const basePolicy: FrozenLiveBidPolicy = {
  v: 1,
  policyRevision: 'synthetic-override',
  stages: [
    {
      id: 'days',
      label: 'Days Captains',
      kind: 'D_SHIFT',
      order: 0,
      memberIds: [42, 43],
      opportunityPositionIds: ['D101', 'D102'],
    },
    {
      id: 'captains',
      label: 'Captains',
      kind: 'CAPTAIN',
      order: 1,
      memberIds: [42, 43],
      opportunityPositionIds: ['A101', 'A103'],
    },
    {
      id: 'firefighters',
      label: 'Firefighters',
      kind: 'FIREFIGHTER',
      order: 2,
      memberIds: [44],
      opportunityPositionIds: ['A102'],
    },
  ],
  dispositions: ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'].map((disposition) => ({
    disposition: disposition as FrozenLiveBidPolicy['dispositions'][number]['disposition'],
    advances: disposition !== 'HOLD',
    returns: false,
    returnStageId: null,
    retainsLaterSelectionRights: false,
    terminal: disposition === 'DECLINED',
    requiresReason: true,
    requiresEvidence: disposition === 'UNREACHABLE',
    contactPolicyReference: null,
  })),
  actionPermissions: [
    'record_selection',
    'amend_selection',
    'skip_defer',
    'force',
    'mark_unreachable',
    'resolve_tie',
    'alter_order',
    'pause_resume',
    'create_live_session',
    'approve_transition',
    'approve_final_results',
    'publish',
  ].map((action) => ({
    action: action as FrozenLiveBidPolicy['actionPermissions'][number]['action'],
    actorMemberIds: [99],
  })),
  specialtyCatalogReference: null,
  aDayPolicyReference: null,
  transitionPolicyReference: null,
  publicationPolicyReference: null,
};

function transactionalD1(sqlite: Database.Database): D1Database {
  const prepare = (query: string) => {
    let args: unknown[] = [];
    const execute = () => {
      const info = sqlite.prepare(query).run(...args);
      return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
    };
    const statement = {
      bind(...bound: unknown[]) {
        args = bound;
        return statement;
      },
      async run() {
        return execute();
      },
      async all() {
        return { success: true, results: sqlite.prepare(query).all(...args), meta: {} };
      },
      async first() {
        return sqlite.prepare(query).get(...args) ?? null;
      },
      async raw() {
        return sqlite
          .prepare(query)
          .raw()
          .all(...args);
      },
      __execute: execute,
    };
    return statement;
  };
  return {
    prepare,
    async batch(items: D1PreparedStatement[]) {
      return sqlite.transaction((statements: unknown[]) =>
        statements.map((statement) => (statement as { __execute(): unknown }).__execute()),
      )(items) as never;
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

function initialState(): BidSessionState {
  return {
    ...emptyBidSessionState(sessionId),
    currentPhase: 'position_bid',
    currentBidderId: 42,
    bidOrder: [
      { ordinal: 1, memberId: 42, pool: 'OFC', stageId: 'days' },
      { ordinal: 2, memberId: 43, pool: 'OFC', stageId: 'days' },
      { ordinal: 3, memberId: 42, pool: 'OFC', stageId: 'captains' },
      { ordinal: 4, memberId: 43, pool: 'OFC', stageId: 'captains' },
      { ordinal: 5, memberId: 44, pool: 'FF', stageId: 'firefighters' },
    ],
    live: {
      currentStageId: 'days',
      completedStageIds: [],
      pausedPhase: null,
      lastSelectionBidId: null,
      dispositions: [],
    },
    annual: initializeAnnualOperations({ preferenceSheets: [] }),
  };
}

describe('canonical administrator override', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let commandNumber: number;
  let eventNumber: number;
  let policy: FrozenLiveBidPolicy;

  function seed(
    withADay = false,
    capacity = 10,
    officersPerGroup: number | null = null,
    combatGroups: ('G1' | 'G2' | 'G3' | 'G4')[] = ['G1', 'G2', 'G3', 'G4'],
  ) {
    policy = structuredClone(basePolicy);
    if (withADay)
      policy.annualOperations = {
        v: 1,
        stageOrder: ['days', 'captains', 'firefighters'],
        requiredTopologyPositionIds: ['D101', 'D102', 'A101', 'A102', 'A103'],
        specialties: [],
        contact: { minimumAttempts: 0, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
        aDay: {
          combatGroups,
          min: 0,
          max: capacity,
          captainDcMax: null,
          execution: {
            timing: 'SIMULTANEOUS',
            officersPerGroup,
            constraints: [],
            sourceRef: 'Synthetic timing',
            timingExceptions: [
              {
                id: 'later',
                label: 'Ordinary A-Day turn',
                timing: 'AFTER_POSITION_SELECTION',
                positionIds: ['A101', 'A103'],
                profileIds: [],
                sourceRef: 'Synthetic timing',
              },
            ],
          },
        },
      };
    const snapshot = BidSessionPolicySnapshotSchema.parse({
      v: 3,
      ruleBookVersion: 'synthetic-override',
      ruleBookRevision: 1,
      positionTemplateVersion: 'synthetic-override',
      configurationRevision: 1,
      capturedAtMs: 1_700_000_000_000,
      credentialEvaluationOn: '2030-01-01',
      settings: {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2030-01-01',
        personnelEvaluationOn: '2030-01-01',
        livePolicy: policy,
      },
      members: [42, 43, 44].map((memberId) => ({
        memberId,
        pool: memberId === 44 ? 'FF' : 'OFC',
        rank: memberId === 44 ? 'FF' : 'CPT',
        rscSeniority: memberId,
        rankSeniority: memberId,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        isProbationary: false,
        credentialNames: memberId === 44 ? [] : ['Synthetic specialty'],
      })),
      ruleBookMaterial: {
        v: 1,
        positions: ['D101', 'D102', 'A101', 'A102', 'A103'].map((id) => ({
          id,
          templateVersion: 'synthetic-override',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: id.startsWith('D') ? 'D' : 'A',
          station: 'Synthetic station',
          unit: 'Synthetic unit',
          rankRequired: id === 'A102' ? 'FF' : 'CPT',
          positionName: `Synthetic ${id}`,
        })),
        rules: ['D101', 'D102', 'A101', 'A102', 'A103'].map((positionId) => ({
          positionId,
          templateVersion: 'synthetic-override',
          ruleBookVersion: 'synthetic-override',
          requiredCriteriaJson: JSON.stringify({
            rank: [positionId === 'A102' ? 'FF' : 'CPT'],
            credentials: positionId === 'A103' ? ['Synthetic specialty'] : [],
            custom: ['non_probationary'],
          }),
          pointsPreferenceJson: JSON.stringify({ max: 0, items: [] }),
          tieBreakChainJson: JSON.stringify(['rsc_seniority']),
        })),
      },
    });
    sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
      VALUES (?,?,?,?,?,?)`)
      .run(
        sessionId,
        'synthetic-override',
        'synthetic-override',
        1,
        JSON.stringify(snapshot),
        1_700_000_000_000,
      );
  }

  function command(
    type: LiveBidCommand['type'],
    fields: Record<string, unknown>,
    seq = 0,
  ): LiveBidCommand {
    commandNumber += 1;
    return {
      v: 1,
      type,
      commandId: `00000000-0000-4000-8000-${String(commandNumber).padStart(12, '0')}`,
      bidSessionId: sessionId,
      expectedSeq: seq,
      actor: { id: 99, role: 'admin' },
      reason: 'Reviewed operator deviation',
      evidenceReference: null,
      ...fields,
    } as LiveBidCommand;
  }
  async function execute(state: BidSessionState, input: LiveBidCommand, previewOnly = false) {
    return commitLiveBidCommand({
      db,
      state,
      policy,
      command: input,
      previewOnly,
      nowMs: () => 1_700_000_000_000 + eventNumber,
      newId: () => `override-event-${++eventNumber}`,
    });
  }
  async function confirmed(state: BidSessionState, input: LiveBidCommand) {
    const preview = await execute(state, input, true);
    expect(preview.result.kind).toBe('accepted');
    if (preview.result.kind !== 'accepted') throw new Error(preview.result.code);
    const override = (
      preview.result.envelope.payload as { adminOverride: { warningCodes: string[] } }
    ).adminOverride;
    const final = {
      ...input,
      adminOverride: { acknowledged: true as const, warningCodes: override.warningCodes },
    } as LiveBidCommand;
    const committed = await execute(state, final);
    expect(committed.result.kind).toBe('accepted');
    if (!committed.canonicalState) throw new Error(JSON.stringify(committed.result));
    return { ...committed, command: final, state: committed.canonicalState };
  }
  const override = { acknowledged: true, warningCodes: [] };

  beforeEach(() => {
    commandNumber = 0;
    eventNumber = 0;
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith('.sql'))
      .sort())
      sqlite.exec(readFileSync(resolve(migrations, file), 'utf8'));
    sqlite.prepare('INSERT INTO bid_years (year,status) VALUES (?,?)').run(2030, 'configuring');
    sqlite
      .prepare(`INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,turn_timer_seconds,
      expected_duration_days,day_count,is_mock) VALUES (?,2030,1,'position_bid',180,2,0,1)`)
      .run(sessionId);
    sqlite.exec(`INSERT INTO position_templates (version,effective_year,notes) VALUES ('synthetic-override',2030,'Synthetic');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('synthetic-override',2030,'draft',1,'Synthetic');`);
    db = transactionalD1(sqlite);
  });
  afterEach(() => sqlite.close());

  it('records a chief-directed placement distinctly and preserves its marker on reload', async () => {
    seed();
    const input = command('live.record_selection', {
      memberId: 44,
      positionId: 'A102',
      forced: true,
      adminOverride: override,
    });
    const accepted = await confirmed(initialState(), input);
    expect(accepted.state.fills.A102?.forced).toMatchObject({
      commandId: accepted.command.commandId,
      actorMemberId: 99,
      reason: 'Reviewed operator deviation',
    });
    expect((await loadCanonicalBidSessionState(db, sessionId))?.fills.A102?.forced).toEqual(
      accepted.state.fills.A102?.forced,
    );
    const replay = await execute(initialState(), accepted.command);
    expect(replay.result).toEqual(accepted.result);
  });

  it('rejects claiming a forced placement without the explicit operator override', async () => {
    seed();
    expect(
      (
        await execute(
          initialState(),
          command('live.record_selection', { memberId: 42, positionId: 'D101', forced: true }),
        )
      ).result,
    ).toMatchObject({ kind: 'rejected', code: 'EXPLICIT_ADMIN_OVERRIDE_REQUIRED' });
  });

  it('handles a Captain acting in a session-only administrative Chief role without promotion or invented seats', async () => {
    seed();
    const state = initialState();
    const assign = command('live.set_exceptional_assignment', {
      memberId: 42,
      operation: 'ASSIGN',
      roleLabel: 'Division Chief of Prevention',
    });
    const preview = await execute(state, assign, true);
    expect(preview.result.kind).toBe('accepted');
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 0,
    });
    const accepted = await execute(state, assign);
    expect(accepted.result.kind).toBe('accepted');
    expect(accepted.canonicalState).toMatchObject({
      currentBidderId: 43,
      fills: {},
      live: {
        exceptionalAssignments: [
          expect.objectContaining({
            memberId: 42,
            roleLabel: 'Division Chief of Prevention',
            positionId: null,
            releasedAtMs: null,
          }),
        ],
      },
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bids').get()).toEqual({ count: 0 });
    const frozen = JSON.parse(
      (
        sqlite.prepare('SELECT snapshot_json FROM bid_session_policy_snapshots').get() as {
          snapshot_json: string;
        }
      ).snapshot_json,
    );
    expect(frozen.members.find((entry: { memberId: number }) => entry.memberId === 42).rank).toBe(
      'CPT',
    );
    expect(frozen.ruleBookMaterial.positions).toHaveLength(5);
    const reloaded = await loadCanonicalBidSessionState(db, sessionId);
    if (!reloaded) throw new Error('Canonical acting assignment required');
    expect(reloaded?.live?.exceptionalAssignments).toEqual(
      accepted.canonicalState?.live?.exceptionalAssignments,
    );
    expect((await execute(state, assign)).result).toEqual(accepted.result);
    const released = await execute(
      reloaded,
      command(
        'live.set_exceptional_assignment',
        { memberId: 42, operation: 'RELEASE', roleLabel: 'Division Chief of Prevention' },
        1,
      ),
    );
    expect(released.result.kind).toBe('accepted');
    expect(released.canonicalState?.live?.exceptionalAssignments?.[0]).toMatchObject({
      releasedAtMs: expect.any(Number),
      releaseCommandId: expect.any(String),
    });
    expect(released.canonicalState?.currentBidderId).toBe(43);
    expect(released.canonicalState?.bidOrder).toEqual(state.bidOrder);
    expect(released.canonicalState?.annual?.returningMemberId).toBeNull();
  });

  it('returns an acting Captain after their ordinary turn without restoring an exhausted Days entry or rewinding the queue', async () => {
    seed();
    const input = initialState();
    input.currentBidderId = 43;
    input.queueCursor = 3;
    if (!input.live) throw new Error('Live progress required');
    input.live.currentStageId = 'captains';
    input.live.exceptionalAssignments = [
      {
        assignmentId: 'acting-42',
        commandId: 'assignment-42',
        memberId: 42,
        roleLabel: 'Division Chief of Prevention',
        positionId: null,
        actorMemberId: 99,
        reason: 'Chief direction',
        assignedAtMs: 1,
        releasedAtMs: null,
        releaseCommandId: null,
      },
    ];
    const released = await execute(
      input,
      command('live.set_exceptional_assignment', {
        memberId: 42,
        operation: 'RELEASE',
        roleLabel: 'Division Chief of Prevention',
      }),
    );
    expect(released.result.kind).toBe('accepted');
    expect(released.canonicalState).toMatchObject({
      currentBidderId: 43,
      queueCursor: 3,
      annual: { returningMemberId: 42 },
    });
    expect(released.canonicalState?.bidOrder).toEqual(input.bidOrder);
    if (!released.canonicalState) throw new Error('Released state required');
    const selected = await execute(
      released.canonicalState,
      command('live.record_selection', { memberId: 42, positionId: 'A101' }, 1),
    );
    expect(selected.result.kind).toBe('accepted');
    expect(selected.canonicalState).toMatchObject({
      currentBidderId: 43,
      queueCursor: 3,
      annual: { returningMemberId: null },
    });
    expect(selected.canonicalState?.fills.A101?.memberId).toBe(42);
  });

  it('keeps non-biddable administrative roles separate and requires the frozen force grant', async () => {
    seed();
    expect(
      (
        await execute(
          initialState(),
          command('live.set_exceptional_assignment', {
            memberId: 42,
            operation: 'ASSIGN',
            roleLabel: 'Chief duty',
            positionId: 'A101',
          }),
        )
      ).result,
    ).toMatchObject({
      kind: 'rejected',
      code: 'EXCEPTIONAL_ASSIGNMENT_NON_BIDDABLE_ROLE_REQUIRED',
    });
    const input = command('live.set_exceptional_assignment', {
      memberId: 42,
      operation: 'ASSIGN',
      roleLabel: 'Chief duty',
    });
    input.actor.id = 43;
    expect((await execute(initialState(), input)).result).toMatchObject({
      kind: 'rejected',
      code: 'LIVE_ACTION_FORBIDDEN',
    });
  });

  it('allows a future firefighter pick during Days only after audited review, preserves other turns, and replays once', async () => {
    seed();
    const state = initialState();
    expect(
      (await execute(state, command('live.record_selection', { memberId: 44, positionId: 'A102' })))
        .result,
    ).toMatchObject({ kind: 'rejected', code: 'NOT_CURRENT_BIDDER' });
    const input = command('live.record_selection', {
      memberId: 44,
      positionId: 'A102',
      adminOverride: override,
    });
    const before = sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get();
    const preview = await execute(state, input, true);
    expect(preview.result).toMatchObject({
      kind: 'accepted',
      envelope: {
        payload: {
          adminOverride: { warningCodes: ['ORDER_DEVIATION', 'STAGE_DEVIATION'] },
        },
      },
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual(
      before,
    );
    expect(
      sqlite.prepare('SELECT count(*) AS count FROM canonical_bid_session_state').get(),
    ).toEqual({ count: 0 });
    const accepted = await confirmed(state, input);
    expect(accepted.state.currentBidderId).toBe(42);
    expect(accepted.state.fills.A102?.memberId).toBe(44);
    expect(accepted.state.bidOrder).toEqual(state.bidOrder);
    const replay = await execute(state, accepted.command);
    expect(replay.result).toEqual(accepted.result);
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM audit_log').get()).toEqual({ count: 1 });
    expect((await loadCanonicalBidSessionState(db, sessionId))?.fills.A102?.memberId).toBe(44);
    const event = sqlite.prepare('SELECT event_json FROM bid_command_events').get() as {
      event_json: string;
    };
    expect(JSON.parse(event.event_json).adminOverride.reason).toBe('Reviewed operator deviation');
  });

  it('requires exact acknowledged qualification advisories before an otherwise ineligible award', async () => {
    seed();
    const state = initialState();
    const input = command('live.record_selection', {
      memberId: 44,
      positionId: 'A103',
      adminOverride: override,
    });
    const preview = await execute(state, input, true);
    expect(preview.result).toMatchObject({
      kind: 'accepted',
      envelope: {
        payload: {
          adminOverride: {
            warningCodes: ['ORDER_DEVIATION', 'QUALIFICATION_DEVIATION', 'STAGE_DEVIATION'],
          },
        },
      },
    });
    expect((await execute(state, input)).result).toMatchObject({
      kind: 'rejected',
      code: 'ADMIN_OVERRIDE_WARNING_ACKNOWLEDGEMENT_REQUIRED',
    });
    const accepted = await confirmed(
      state,
      command('live.record_selection', {
        memberId: 44,
        positionId: 'A103',
        adminOverride: override,
      }),
    );
    expect(accepted.state.fills.A103?.memberId).toBe(44);
    const snapshot = sqlite
      .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots')
      .get() as { snapshot_json: string };
    expect(
      JSON.parse(snapshot.snapshot_json).members.find(
        (member: { memberId: number }) => member.memberId === 44,
      ).credentialNames,
    ).toEqual([]);
  });

  it('defers the Days phase without awarding its seats or dropping any member entry', async () => {
    seed();
    const state = initialState();
    const accepted = await confirmed(
      state,
      command('live.disposition', {
        disposition: 'DEFER',
        memberId: 42,
        deferStageId: 'days',
        adminOverride: override,
      }),
    );
    expect(accepted.state.fills).toEqual({});
    expect(accepted.state.bidOrder.map((entry) => entry.stageId)).toEqual([
      'captains',
      'captains',
      'firefighters',
      'days',
      'days',
    ]);
    expect([...accepted.state.bidOrder].sort((a, b) => a.ordinal - b.ordinal)).toEqual(
      state.bidOrder,
    );
    expect(accepted.state.annual?.unresolvedMemberIds).toEqual([42, 43]);
    const normal = await execute(
      accepted.state,
      command('live.record_selection', { memberId: 42, positionId: 'A101' }, 1),
    );
    expect(normal.result.kind).toBe('accepted');
    expect(normal.canonicalState?.fills.A101?.memberId).toBe(42);
    expect(normal.canonicalState?.annual?.unresolvedMemberIds).toEqual([43]);
  });

  it('member skips retain later rights, repeated deferrals do not multiply entries, and the member is awarded once', async () => {
    seed();
    const first = await confirmed(
      initialState(),
      command('live.disposition', { disposition: 'SKIP', memberId: 42, adminOverride: override }),
    );
    expect(first.state.currentBidderId).toBe(43);
    const second = await confirmed(
      first.state,
      command(
        'live.disposition',
        { disposition: 'DEFER', memberId: 42, adminOverride: override },
        1,
      ),
    );
    expect(second.state.bidOrder.filter((entry) => entry.memberId === 42)).toHaveLength(2);
    const selected = await confirmed(
      second.state,
      command(
        'live.record_selection',
        { memberId: 42, positionId: 'A101', adminOverride: override },
        2,
      ),
    );
    expect(selected.state.annual?.unresolvedMemberIds).toEqual([]);
    const duplicate = await execute(
      selected.state,
      command(
        'live.record_selection',
        { memberId: 42, positionId: 'A103', adminOverride: override },
        3,
      ),
      true,
    );
    expect(duplicate.result).toMatchObject({ kind: 'rejected', code: 'MEMBER_ALREADY_SELECTED' });
  });

  it('never overrides stale sequence, occupied awards, frozen membership, or missing force authority', async () => {
    seed();
    const accepted = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 44,
        positionId: 'A102',
        adminOverride: override,
      }),
    );
    const stale = command('live.record_selection', {
      memberId: 42,
      positionId: 'A101',
      adminOverride: override,
    });
    expect((await execute(accepted.state, stale, true)).result).toMatchObject({
      code: 'STALE_SEQUENCE',
    });
    expect(
      (
        await execute(
          accepted.state,
          command(
            'live.record_selection',
            { memberId: 42, positionId: 'A102', adminOverride: override },
            1,
          ),
          true,
        )
      ).result,
    ).toMatchObject({ code: 'POSITION_FILLED' });
    expect(
      (
        await execute(
          accepted.state,
          command(
            'live.record_selection',
            { memberId: 999, positionId: 'A101', adminOverride: override },
            1,
          ),
          true,
        )
      ).result,
    ).toMatchObject({ code: 'MEMBER_NOT_IN_BID_POOL' });
    const forbidden = {
      ...command(
        'live.record_selection',
        { memberId: 42, positionId: 'A101', adminOverride: override },
        1,
      ),
      actor: { id: 98, role: 'admin' as const },
    };
    expect((await execute(accepted.state, forbidden, true)).result).toMatchObject({
      code: 'LIVE_ACTION_FORBIDDEN',
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 1,
    });
  });

  it('a correction that supplies the active deferred A-Day advances and settles that member without losing later turns', async () => {
    seed(true);
    const deferred = await confirmed(
      initialState(),
      command('live.disposition', { disposition: 'DEFER', memberId: 42, adminOverride: override }),
    );
    const early = await confirmed(
      deferred.state,
      command(
        'live.record_selection',
        { memberId: 42, positionId: 'A101', adminOverride: override },
        1,
      ),
    );
    const captain = await execute(
      early.state,
      command('live.record_selection', { memberId: 43, positionId: 'D101', aDay: 'MON' }, 2),
    );
    if (!captain.canonicalState) throw new Error(JSON.stringify(captain.result));
    const firefighter = await execute(
      captain.canonicalState,
      command('live.record_selection', { memberId: 44, positionId: 'A102', aDay: 'G2' }, 3),
    );
    if (!firefighter.canonicalState) throw new Error(JSON.stringify(firefighter.result));
    expect(firefighter.canonicalState).toMatchObject({
      currentPhase: 'a_day_bid',
      currentBidderId: 42,
    });
    const later = await confirmed(
      firefighter.canonicalState,
      command(
        'live.disposition',
        { disposition: 'DEFER', memberId: 42, adminOverride: override },
        4,
      ),
    );
    expect(later.state.annual?.unresolvedMemberIds).toEqual([42]);
    const award = early.state.fills.A101;
    if (!award) throw new Error('early award missing');
    const corrected = await confirmed(
      later.state,
      command(
        'live.correct_bid',
        {
          memberId: 42,
          originalCommandId: early.command.commandId,
          originalBidId: award.bidId,
          originalPositionId: 'A101',
          originalADayCommandId: null,
          operation: 'REPLACE',
          replacement: { positionId: 'A103', aDay: 'G1' },
          adminOverride: override,
        },
        5,
      ),
    );
    expect(corrected.state.currentPhase).toBe('complete');
    expect(corrected.state.currentBidderId).toBeNull();
    expect(corrected.state.annual?.unresolvedMemberIds).toEqual([]);
    expect(corrected.state.aDay?.picks.filter((pick) => pick.memberId === 42)).toHaveLength(1);
    expect(corrected.state.fills.A101).toBeUndefined();
    expect(corrected.state.fills.A103?.aDay).toBe('G1');
    expect(corrected.state.fills.D101).toEqual(captain.canonicalState.fills.D101);
    expect(corrected.state.fills.A102).toEqual(firefighter.canonicalState.fills.A102);
  });

  it('binds an acknowledged capacity departure to its exact pick and rebuilds lower-key excess after JSON reload', async () => {
    seed(true, 1);
    const first = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 44,
        positionId: 'A102',
        aDay: 'G1',
        adminOverride: override,
      }),
    );
    const excess = await confirmed(
      first.state,
      command(
        'live.record_selection',
        {
          memberId: 42,
          positionId: 'A101',
          aDay: 'G1',
          adminOverride: override,
        },
        1,
      ),
    );
    expect(excess.state.fills.A101?.aDayOverride).toMatchObject({
      positionId: 'A101',
      aDay: 'G1',
      commandId: excess.command.commandId,
      warningCodes: ['A_DAY_POLICY_DEVIATION:GROUP_FULL'],
    });
    const loaded = await loadCanonicalBidSessionState(db, sessionId);
    if (!loaded) throw new Error('capacity reload missing');
    expect(Object.keys(loaded.fills)).toEqual(['A101', 'A102']);
    const ordinary = await execute(
      loaded,
      command(
        'live.record_selection',
        {
          memberId: 43,
          positionId: 'D101',
          aDay: 'MON',
        },
        2,
      ),
    );
    expect(ordinary.result.kind).toBe('accepted');
    if (!ordinary.canonicalState) throw new Error(JSON.stringify(ordinary.result));
    const source = ordinary.canonicalState.fills.A101;
    if (!source) throw new Error('capacity source missing');
    const replacement = {
      memberId: 42,
      originalCommandId: excess.command.commandId,
      originalBidId: source.bidId,
      originalPositionId: 'A101',
      originalADayCommandId: null,
      operation: 'REPLACE',
      replacement: { positionId: 'A103', aDay: 'G1' },
    };
    const strict = await execute(
      ordinary.canonicalState,
      command('live.correct_bid', replacement, 3),
      true,
    );
    expect(strict.result).toMatchObject({ kind: 'rejected', code: 'GROUP_FULL' });
    const reviewed = await confirmed(
      ordinary.canonicalState,
      command(
        'live.correct_bid',
        {
          ...replacement,
          adminOverride: override,
        },
        3,
      ),
    );
    expect(reviewed.state.fills.A103?.aDayOverride).toMatchObject({
      positionId: 'A103',
      aDay: 'G1',
      commandId: reviewed.command.commandId,
    });
    expect(
      (
        await execute(
          reviewed.state,
          command(
            'live.amend_selection',
            {
              memberId: 42,
              fromPositionId: 'A103',
              toPositionId: 'A101',
              aDay: 'G1',
            },
            4,
          ),
        )
      ).result,
    ).toMatchObject({ kind: 'rejected', code: 'GROUP_FULL' });
  });

  it('a fresh ordinary member cannot ignore prior approved officer excess when checking group capacity', async () => {
    seed(true, 2, 1, ['G1']);
    const officer = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 42,
        positionId: 'A101',
        aDay: 'G1',
        adminOverride: override,
      }),
    );
    const extraOfficer = await confirmed(
      officer.state,
      command(
        'live.record_selection',
        {
          memberId: 43,
          positionId: 'A103',
          aDay: 'G1',
          adminOverride: override,
        },
        1,
      ),
    );
    expect(extraOfficer.state.fills.A103?.aDayOverride?.warningCodes).toContain(
      'A_DAY_POLICY_DEVIATION:OFFICER_INVARIANT_VIOLATED',
    );
    const fresh = await execute(
      extraOfficer.state,
      command(
        'live.record_selection',
        {
          memberId: 44,
          positionId: 'A102',
          aDay: 'G1',
        },
        2,
      ),
    );
    expect(fresh.result).toMatchObject({ kind: 'rejected', code: 'GROUP_FULL' });
    expect((await loadCanonicalBidSessionState(db, sessionId))?.fills.A102).toBeUndefined();
    const invalid = await execute(
      extraOfficer.state,
      command(
        'live.record_selection',
        {
          memberId: 44,
          positionId: 'A102',
          aDay: 'MON',
          adminOverride: override,
        },
        2,
      ),
      true,
    );
    expect(invalid.result).toMatchObject({ kind: 'rejected', code: 'INVALID_A_DAY_FOR_SHIFT' });
  });

  it('finalizes officer excess only when the exact offending picks retain acknowledged officer provenance', async () => {
    seed(true, 10, 0);
    const first = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 42,
        positionId: 'A101',
        aDay: 'G1',
        adminOverride: override,
      }),
    );
    const second = await confirmed(
      first.state,
      command(
        'live.record_selection',
        {
          memberId: 43,
          positionId: 'A103',
          aDay: 'G1',
          adminOverride: override,
        },
        1,
      ),
    );
    const third = await confirmed(
      second.state,
      command(
        'live.record_selection',
        {
          memberId: 44,
          positionId: 'A102',
          aDay: 'G2',
          adminOverride: override,
        },
        2,
      ),
    );
    expect(third.state.currentPhase).toBe('complete');
    const finalized = await execute(third.state, command('live.complete_session', {}, 3));
    expect(finalized.result.kind).toBe('accepted');
    expect(finalized.canonicalState?.annual?.completion).not.toBeNull();
    const row = sqlite.prepare('SELECT snapshot_json FROM bid_session_policy_snapshots').get() as {
      snapshot_json: string;
    };
    const snapshot = BidSessionPolicySnapshotSchema.parse(JSON.parse(row.snapshot_json));
    if (snapshot.v !== 3) throw new Error('synthetic frozen snapshot missing');
    const unapproved = {
      ...third.state,
      fills: Object.fromEntries(
        Object.entries(third.state.fills).map(([id, fill]) => {
          const { aDayOverride: _approval, ...ordinary } = fill;
          return [id, ordinary];
        }),
      ),
    };
    expect(
      evaluateFrozenADays(snapshot, unapproved, {
        nowMs: 1_700_000_000_000,
        actorId: 99,
        forced: false,
        finalize: true,
      }),
    ).toMatchObject({ ok: false, code: 'OFFICER_INVARIANT_VIOLATED' });
  });
});
