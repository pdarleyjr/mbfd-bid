import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import {
  BidSessionPolicySnapshotSchema,
  type FrozenLiveBidPolicy,
  type LiveBidCommand,
  LiveBidCommandSchema,
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

function transactionalD1(sqlite: Database.Database, onRead?: (query: string) => void): D1Database {
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
        onRead?.(query);
        return { success: true, results: sqlite.prepare(query).all(...args), meta: {} };
      },
      async first() {
        onRead?.(query);
        return sqlite.prepare(query).get(...args) ?? null;
      },
      async raw() {
        onRead?.(query);
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

describe.each([
  { mode: 'Mock', isMock: 1 },
  { mode: 'Real', isMock: 0 },
])('canonical administrator override ($mode)', ({ isMock }) => {
  let sqlite: Database.Database;
  let db: D1Database;
  let commandNumber: number;
  let eventNumber: number;
  let policy: FrozenLiveBidPolicy;
  let readQueries: string[];

  function seed(
    withADay = false,
    capacity = 10,
    officersPerGroup: number | null = null,
    combatGroups: ('G1' | 'G2' | 'G3' | 'G4')[] = ['G1', 'G2', 'G3', 'G4'],
    additionalParticipants: readonly number[] = [],
    firefighterSeatRank: 'FF' | 'LT' = 'FF',
  ) {
    policy = structuredClone(basePolicy);
    if (additionalParticipants.length > 0)
      policy.stages = policy.stages.map((stage) =>
        stage.kind === 'D_SHIFT' || stage.kind === 'CAPTAIN'
          ? { ...stage, memberIds: [...additionalParticipants] }
          : stage,
      );
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
      members: [42, 43, 44, ...additionalParticipants].map((memberId) => ({
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
          rankRequired: id === 'A102' ? firefighterSeatRank : 'CPT',
          positionName: `Synthetic ${id}`,
        })),
        rules: ['D101', 'D102', 'A101', 'A102', 'A103'].map((positionId) => ({
          positionId,
          templateVersion: 'synthetic-override',
          ruleBookVersion: 'synthetic-override',
          requiredCriteriaJson: JSON.stringify({
            rank: [positionId === 'A102' ? firefighterSeatRank : 'CPT'],
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
    expect(preview.result.kind, JSON.stringify(preview.result)).toBe('accepted');
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
      expected_duration_days,day_count,is_mock) VALUES (?,2030,1,'position_bid',180,2,0,?)`)
      .run(sessionId, isMock);
    sqlite.exec(`INSERT INTO position_templates (version,effective_year,notes) VALUES ('synthetic-override',2030,'Synthetic');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('synthetic-override',2030,'draft',1,'Synthetic');`);
    readQueries = [];
    db = transactionalD1(sqlite, (query) => readQueries.push(query));
  });
  afterEach(() => sqlite.close());

  it.each(['position_bid', 'a_day_bid'] as const)(
    'persists an overnight %s pause and resumes in a fresh coordinator with the same awards and clock',
    async (phase) => {
      seed(true);
      const start = 1_700_000_000_000;
      let current = { ...initialState(), turnStartedAtMs: start };
      if (phase === 'a_day_bid') {
        for (const [memberId, positionId, aDay] of [
          [42, 'A101', undefined],
          [43, 'A103', undefined],
          [44, 'A102', 'G1'],
        ] as const) {
          const accepted = await confirmed(
            current,
            command(
              'live.record_selection',
              {
                memberId,
                positionId,
                ...(aDay ? { aDay } : {}),
                forced: true,
                reason: '',
                adminOverride: override,
              },
              current.lastSeq,
            ),
          );
          current = accepted.state;
        }
      } else {
        current = (
          await confirmed(
            current,
            command('live.record_selection', {
              memberId: 43,
              positionId: 'A103',
              forced: true,
              reason: '',
              adminOverride: override,
            }),
          )
        ).state;
      }
      expect(current.currentPhase).toBe(phase);
      expect(current.fills.A103?.aDay).toBeUndefined();
      expect(current.fills.A103?.forced).toBeDefined();
      const before = structuredClone(current);
      const pauseAt = start + 60_000;
      const pauseInput = command('live.pause', { reason: '' }, current.lastSeq);
      const paused = await commitLiveBidCommand({
        db,
        policy,
        state: current,
        command: pauseInput,
        nowMs: () => pauseAt,
        newId: () => `overnight-${++eventNumber}`,
      });
      expect(paused.result.kind).toBe('accepted');
      expect(paused.canonicalState?.turnPausedAtMs).toBe(pauseAt);
      // Reconstruct from canonical D1 with a fresh adapter and empty in-memory
      // state. No browser or coordinator object from yesterday is retained.
      const reopenedDb = transactionalD1(sqlite);
      const reopened = await loadCanonicalBidSessionState(reopenedDb, sessionId);
      if (!reopened) throw new Error('Persisted pause required');
      expect(reopened).toEqual(paused.canonicalState);
      expect(reopened.fills).toEqual(before.fills);
      expect(reopened.aDay).toEqual(before.aDay);
      expect(reopened.bidOrder).toEqual(before.bidOrder);
      expect(reopened.queueCursor).toBe(before.queueCursor);
      expect(reopened.annual).toEqual(before.annual);
      expect(reopened.live).toEqual({ ...before.live, pausedPhase: phase });
      const resumeAt = start + 16 * 60 * 60 * 1000;
      const resumeInput = command('live.resume', { reason: '' }, reopened.lastSeq);
      const resumed = await commitLiveBidCommand({
        db: reopenedDb,
        policy,
        state: emptyBidSessionState(sessionId),
        command: resumeInput,
        nowMs: () => resumeAt,
        newId: () => `overnight-${++eventNumber}`,
      });
      if (!resumed.canonicalState) throw new Error(JSON.stringify(resumed.result));
      const expectedElapsed = pauseAt - before.turnStartedAtMs;
      expect(resumed.canonicalState).toEqual({
        ...before,
        lastSeq: before.lastSeq + 2,
        turnPausedAtMs: null,
        turnStartedAtMs: resumeAt - expectedElapsed,
      });
      expect(resumed.canonicalState.turnStartedAtMs + 180_000 - resumeAt).toBe(
        180_000 - expectedElapsed,
      );
      const auditBeforeReplay = sqlite.prepare('SELECT * FROM audit_log').all();
      const replayed = await commitLiveBidCommand({
        db: transactionalD1(sqlite),
        policy,
        state: emptyBidSessionState(sessionId),
        command: resumeInput,
        nowMs: () => resumeAt + 24 * 60 * 60 * 1000,
      });
      expect(replayed.result).toEqual(resumed.result);
      expect(replayed.canonicalState).toEqual(resumed.canonicalState);
      expect(sqlite.prepare('SELECT * FROM audit_log').all()).toEqual(auditBeforeReplay);
      const nextInput =
        phase === 'a_day_bid'
          ? command(
              'live.record_a_day',
              { memberId: resumed.canonicalState.currentBidderId, aDay: 'G1', reason: '' },
              resumed.canonicalState.lastSeq,
            )
          : command(
              'live.disposition',
              { disposition: 'PASS', reason: '' },
              resumed.canonicalState.lastSeq,
            );
      const next = await commitLiveBidCommand({
        db: reopenedDb,
        policy,
        state: emptyBidSessionState(sessionId),
        command: nextInput,
        nowMs: () => resumeAt + 1000,
        newId: () => `overnight-${++eventNumber}`,
      });
      expect(next.result.kind, JSON.stringify(next.result)).toBe('accepted');
      expect(next.canonicalState?.fills.A103).toEqual(before.fills.A103);
    },
  );

  it('serializes concurrent pause and resume attempts and replays accepted commands without moving the clock', async () => {
    seed();
    const start = 1_700_000_000_000;
    const current = { ...initialState(), turnStartedAtMs: start };
    const pauseInputs = [
      command('live.pause', { reason: '' }),
      command('live.pause', { reason: '' }),
    ];
    const paused = await Promise.all(
      pauseInputs.map((input) =>
        commitLiveBidCommand({
          db: transactionalD1(sqlite),
          policy,
          state: current,
          command: input,
          nowMs: () => start + 50_000,
          newId: () => `race-${++eventNumber}`,
        }),
      ),
    );
    expect(paused.filter((result) => result.result.kind === 'accepted')).toHaveLength(1);
    expect(paused.find((result) => result.result.kind === 'rejected')?.result).toMatchObject({
      code: 'STALE_SEQUENCE',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 });
    const pauseReceipt = paused.find((result) => result.result.kind === 'accepted');
    if (!pauseReceipt?.canonicalState) throw new Error('Accepted pause required');
    const resumeInputs = [
      command('live.resume', { reason: '' }, 1),
      command('live.resume', { reason: '' }, 1),
    ];
    const resumedAt = start + 15 * 60 * 60 * 1000;
    const resumed = await Promise.all(
      resumeInputs.map((input) =>
        commitLiveBidCommand({
          db: transactionalD1(sqlite),
          policy,
          state: emptyBidSessionState(sessionId),
          command: input,
          nowMs: () => resumedAt,
          newId: () => `race-${++eventNumber}`,
        }),
      ),
    );
    expect(resumed.filter((result) => result.result.kind === 'accepted')).toHaveLength(1);
    expect(resumed.find((result) => result.result.kind === 'rejected')?.result).toMatchObject({
      code: 'STALE_SEQUENCE',
    });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 2 });
    const restored = await loadCanonicalBidSessionState(transactionalD1(sqlite), sessionId);
    expect(restored).toMatchObject({
      currentPhase: 'position_bid',
      currentBidderId: 42,
      lastSeq: 2,
      turnPausedAtMs: null,
      turnStartedAtMs: resumedAt - 50_000,
    });
    const acceptedPause = pauseInputs.find(
      (input) => input.commandId === pauseReceipt.result.commandId,
    );
    if (!acceptedPause) throw new Error('Accepted command required');
    const replayedPause = await commitLiveBidCommand({
      db: transactionalD1(sqlite),
      policy,
      state: emptyBidSessionState(sessionId),
      command: acceptedPause,
      nowMs: () => resumedAt + 60_000,
    });
    expect(replayedPause.result).toEqual(pauseReceipt.result);
    expect(replayedPause.canonicalState).toEqual(restored);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 2 });
  });

  it('replays concurrent identical pause requests as one durable command', async () => {
    seed();
    const current = { ...initialState(), turnStartedAtMs: 1_700_000_000_000 };
    const input = command('live.pause', { reason: '' });
    const results = await Promise.all(
      [0, 1].map(() =>
        commitLiveBidCommand({
          db: transactionalD1(sqlite),
          policy,
          state: current,
          command: input,
          nowMs: () => 1_700_000_050_000,
          newId: () => `identical-race-${++eventNumber}`,
        }),
      ),
    );
    const [first, second] = results;
    if (!first || !second) throw new Error('Both retry responses required');
    expect(first.result).toEqual(second.result);
    expect(results.every((result) => result.result.kind === 'accepted')).toBe(true);
    expect(first.canonicalState).toEqual(second.canonicalState);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM bid_command_receipts').get()).toEqual({
      n: 1,
    });
  });

  it('does not hide an unrelated pause transaction failure as a stale retry', async () => {
    seed();
    const failingDb = transactionalD1(sqlite);
    failingDb.batch = async () => {
      throw new Error('Synthetic unavailable storage');
    };
    await expect(
      commitLiveBidCommand({
        db: failingDb,
        policy,
        state: initialState(),
        command: command('live.pause', { reason: '' }),
      }),
    ).rejects.toThrow('Synthetic unavailable storage');
    expect(await loadCanonicalBidSessionState(db, sessionId)).toBeNull();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });

  it('replays a historical raw-whitespace command through the new schema without changing its digest or audit', async () => {
    seed();
    const before = initialState();
    // This is the exact parsed envelope accepted by the previous schema,
    // which preserved whitespace for ordinary canonical commands.
    const historical = command('live.record_selection', {
      memberId: 42,
      positionId: 'D101',
      reason: '  Historical operator note  ',
    });
    const accepted = await execute(before, historical);
    expect(accepted.result.kind).toBe('accepted');
    const receipt = sqlite.prepare('SELECT request_sha256 FROM bid_command_receipts').get();
    const audit = sqlite.prepare('SELECT * FROM audit_log').all();
    const parsed = LiveBidCommandSchema.parse(historical);
    expect(parsed).toEqual(historical);
    const replayed = await execute(before, parsed);
    expect(replayed.result).toEqual(accepted.result);
    expect(sqlite.prepare('SELECT request_sha256 FROM bid_command_receipts').get()).toEqual(
      receipt,
    );
    expect(sqlite.prepare('SELECT * FROM audit_log').all()).toEqual(audit);
    expect(audit).toMatchObject([{ reason: '  Historical operator note  ' }]);
    // Note changes still constitute a different command and cannot reuse its id.
    expect((await execute(before, { ...parsed, reason: 'Different note' })).result).toMatchObject({
      kind: 'rejected',
      code: 'COMMAND_ID_REUSED',
    });
  });

  it('accepts a forced out-of-order award and correction with no note while preserving review, audit, replay and the waiting turn', async () => {
    seed(true);
    const before = initialState();
    const input = command('live.record_selection', {
      memberId: 44,
      positionId: 'A102',
      aDay: 'G1',
      forced: true,
      reason: '',
      adminOverride: override,
    });
    const awarded = await confirmed(before, input);
    expect(awarded.state.currentBidderId).toBe(42);
    expect(awarded.state.fills.A102?.forced).toMatchObject({
      actorMemberId: 99,
      reason: '',
      commandId: awarded.command.commandId,
    });
    const fill = awarded.state.fills.A102;
    if (!fill) throw new Error('Synthetic source award required');
    const correction = await confirmed(
      awarded.state,
      command(
        'live.correct_bid',
        {
          memberId: 44,
          originalCommandId: awarded.command.commandId,
          originalBidId: fill.bidId,
          originalPositionId: 'A102',
          originalADayCommandId: null,
          operation: 'REPLACE',
          replacement: { positionId: 'A102', aDay: null },
          reason: '',
          adminOverride: override,
        },
        1,
      ),
    );
    expect(correction.state.currentBidderId).toBe(42);
    expect(correction.state.fills.A102?.aDayDeferral?.positionId).toBe('A102');
    expect(correction.state.live?.corrections?.at(-1)).toMatchObject({
      reason: '',
      actorMemberId: 99,
      before: { positionId: 'A102', fill: { aDay: 'G1' } },
    });
    expect((await execute(awarded.state, correction.command)).result).toEqual(correction.result);
    const audit = sqlite
      .prepare('SELECT actor_id,reason,before_state,after_state FROM audit_log ORDER BY rowid')
      .all() as Array<{
      actor_id: number;
      reason: string;
      before_state: string;
      after_state: string;
    }>;
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.actor_id === 99 && row.reason === '')).toBe(true);
    expect(audit.every((row) => row.before_state && row.after_state)).toBe(true);
    expect((await loadCanonicalBidSessionState(db, sessionId))?.fills.A102).toEqual(
      correction.state.fills.A102,
    );
    expect((await execute(before, command('live.pause', { reason: '' }))).result).toMatchObject({
      kind: 'rejected',
      code: 'STALE_SEQUENCE',
    });
  });

  it('allows a note-free skip, temporary duty, release and pause without discarding the audit trail', async () => {
    seed();
    const skipped = await execute(
      initialState(),
      command('live.disposition', { disposition: 'SKIP', reason: '' }),
    );
    expect(skipped.result.kind).toBe('accepted');
    if (!skipped.canonicalState) throw new Error('Synthetic skipped state required');
    const assigned = await execute(
      skipped.canonicalState,
      command(
        'live.set_exceptional_assignment',
        {
          memberId: 42,
          operation: 'ASSIGN',
          roleLabel: 'Temporary Chief duty',
          reason: '',
        },
        1,
      ),
    );
    expect(assigned.result.kind).toBe('accepted');
    if (!assigned.canonicalState) throw new Error('Synthetic duty state required');
    expect(assigned.canonicalState.live?.exceptionalAssignments?.at(-1)).toMatchObject({
      reason: '',
      actorMemberId: 99,
    });
    const released = await execute(
      assigned.canonicalState,
      command(
        'live.set_exceptional_assignment',
        {
          memberId: 42,
          operation: 'RELEASE',
          roleLabel: 'Temporary Chief duty',
          reason: '',
        },
        2,
      ),
    );
    expect(released.result.kind).toBe('accepted');
    if (!released.canonicalState) throw new Error('Synthetic release state required');
    const paused = await execute(released.canonicalState, command('live.pause', { reason: '' }, 3));
    expect(paused.result.kind).toBe('accepted');
    expect(paused.canonicalState?.currentPhase).toBe('paused');
    expect(
      sqlite
        .prepare("SELECT count(*) AS count FROM audit_log WHERE reason='' AND actor_id=99")
        .get(),
    ).toEqual({ count: 4 });
  });

  it.each(['FF', 'LT'] as const)(
    'awards an FF a %s seat with an empty note and retains the deferred A-Day prompt across commands and reload',
    async (seatRank) => {
      seed(true, 10, null, ['G1', 'G2', 'G3', 'G4'], [], seatRank);
      const early = await confirmed(
        initialState(),
        command('live.record_selection', {
          memberId: 44,
          positionId: 'A102',
          reason: '',
          adminOverride: override,
        }),
      );
      expect(early.state.fills.A102?.aDay).toBeUndefined();
      if (seatRank === 'LT') {
        if (early.command.type !== 'live.record_selection')
          throw new Error('Expected selection command');
        expect(early.command.adminOverride?.warningCodes).toContain('QUALIFICATION_DEVIATION');
        const saved = sqlite
          .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?')
          .get(sessionId) as { snapshot_json: string };
        expect(
          JSON.parse(saved.snapshot_json).members.find(
            (row: { memberId: number }) => row.memberId === 44,
          ).rank,
        ).toBe('FF');
      }
      expect(early.state.fills.A102?.aDayDeferral).toMatchObject({
        positionId: 'A102',
        commandId: early.command.commandId,
        reason: '',
      });
      const ordinary = await execute(
        early.state,
        command('live.record_selection', { memberId: 42, positionId: 'D101', aDay: 'MON' }, 1),
      );
      expect(ordinary.result.kind).toBe('accepted');
      const reloaded = await loadCanonicalBidSessionState(db, sessionId);
      if (!reloaded) throw new Error('deferred canonical state required');
      expect(reloaded.fills.A102?.aDayDeferral).toEqual(early.state.fills.A102?.aDayDeferral);
      const finalCaptain = await execute(
        reloaded,
        command('live.record_selection', { memberId: 43, positionId: 'D102', aDay: 'TUE' }, 2),
      );
      expect(finalCaptain.canonicalState).toMatchObject({
        currentPhase: 'a_day_bid',
        currentBidderId: 44,
      });
      if (!finalCaptain.canonicalState) throw new Error('deferred prompt required');
      const picked = await execute(
        finalCaptain.canonicalState,
        command('live.record_a_day', { memberId: 44, aDay: 'G2' }, 3),
      );
      expect(picked.result.kind).toBe('accepted');
      expect(picked.canonicalState?.aDay?.picks.find((pick) => pick.memberId === 44)?.aDay).toBe(
        'G2',
      );
    },
  );

  it('changes an early or existing A-Day under review without changing the award or taking another member turn', async () => {
    seed(true, 1);
    const early = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 43,
        positionId: 'A101',
        adminOverride: override,
      }),
    );
    const allocated = await confirmed(
      early.state,
      command('live.record_a_day', { memberId: 43, aDay: 'G1', adminOverride: override }, 1),
    );
    expect(allocated.state.currentBidderId).toBe(42);
    expect(allocated.state.fills.A101?.bidId).toBe(early.state.fills.A101?.bidId);
    const changed = await confirmed(
      allocated.state,
      command('live.record_a_day', { memberId: 43, aDay: 'G2', adminOverride: override }, 2),
    );
    expect(changed.state.currentBidderId).toBe(42);
    expect(changed.state.aDay?.picks.filter((pick) => pick.memberId === 43)).toHaveLength(1);
    expect(changed.state.aDay?.picks.find((pick) => pick.memberId === 43)?.aDay).toBe('G2');
    expect((await loadCanonicalBidSessionState(db, sessionId))?.fills.A101?.aDay).toBe('G2');
    expect((await execute(allocated.state, changed.command)).result).toEqual(changed.result);
    const events = sqlite
      .prepare('SELECT event_json FROM bid_command_events ORDER BY seq')
      .all() as { event_json: string }[];
    expect(JSON.parse(events[2]?.event_json ?? '{}')).toMatchObject({
      before: { aDay: 'G1' },
      after: { aDay: 'G2' },
      adminOverride: { warningCodes: ['A_DAY_CHANGE'] },
    });
  });

  it('permits a disabled combat group only with explicit warning and retains its exact replay provenance', async () => {
    seed(true, 10, null, ['G1']);
    const chosen = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 44,
        positionId: 'A102',
        aDay: 'G2',
        reason: '',
        adminOverride: override,
      }),
    );
    expect(chosen.state.fills.A102?.aDayOverride?.warningCodes).toContain(
      'A_DAY_POLICY_DEVIATION:GROUP_NOT_ENABLED',
    );
    const reloaded = await loadCanonicalBidSessionState(db, sessionId);
    if (!reloaded) throw new Error('group override state required');
    const ordinary = await execute(
      reloaded,
      command('live.record_selection', { memberId: 42, positionId: 'D101', aDay: 'MON' }, 1),
    );
    expect(ordinary.result.kind).toBe('accepted');
    const frozen = JSON.parse(
      (
        sqlite.prepare('SELECT snapshot_json FROM bid_session_policy_snapshots').get() as {
          snapshot_json: string;
        }
      ).snapshot_json,
    );
    expect(frozen.settings.livePolicy.annualOperations.aDay.combatGroups).toEqual(['G1']);
  });

  it('removes an existing A-Day by lineage correction and preserves its deferred task', async () => {
    seed(true);
    const awarded = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 44,
        positionId: 'A102',
        aDay: 'G1',
        adminOverride: override,
      }),
    );
    const fill = awarded.state.fills.A102;
    if (!fill) throw new Error('correction fill required');
    const correction = await confirmed(
      awarded.state,
      command(
        'live.correct_bid',
        {
          memberId: 44,
          originalCommandId: awarded.command.commandId,
          originalBidId: fill.bidId,
          originalPositionId: 'A102',
          originalADayCommandId: null,
          operation: 'REPLACE',
          replacement: { positionId: 'A102', aDay: null },
          adminOverride: override,
        },
        1,
      ),
    );
    expect(correction.state.fills.A102?.aDay).toBeUndefined();
    expect(correction.state.fills.A102?.aDayDeferral?.positionId).toBe('A102');
    expect(correction.state.aDay?.picks.some((pick) => pick.memberId === 44)).toBe(false);
    expect(correction.state.live?.corrections?.at(-1)?.before.fill.aDay).toBe('G1');
    const continued = await execute(
      correction.state,
      command('live.record_selection', { memberId: 42, positionId: 'D101', aDay: 'MON' }, 2),
    );
    expect(continued.result.kind).toBe('accepted');
  });

  it('changes rank-stage order under explicit review while preserving every pending entry and normal guard', async () => {
    seed();
    const order = [44, 42, 43, 42, 43];
    expect(
      (
        await execute(
          initialState(),
          command('live.alter_order', { orderedRemainingMemberIds: order }),
        )
      ).result,
    ).toMatchObject({ code: 'ALTER_ORDER_STAGE_SEQUENCE_INVALID' });
    const reordered = await confirmed(
      initialState(),
      command('live.alter_order', { orderedRemainingMemberIds: order, adminOverride: override }),
    );
    expect(reordered.state.currentBidderId).toBe(44);
    expect(reordered.state.live?.currentStageId).toBe('firefighters');
    expect([...reordered.state.bidOrder].sort((a, b) => a.ordinal - b.ordinal)).toEqual(
      initialState().bidOrder,
    );
    expect(
      (
        await execute(
          reordered.state,
          command(
            'live.alter_order',
            { orderedRemainingMemberIds: [44, 42], adminOverride: override },
            1,
          ),
          true,
        )
      ).result,
    ).toMatchObject({ code: 'ALTER_ORDER_MEMBER_SET_MISMATCH' });
  });

  it('moves an exact ordinary turn before the same Captain Days turn with complete audit identity and replay', async () => {
    seed();
    const before = { ...initialState(), queueCursor: 1, currentBidderId: 43 };
    const remaining = before.bidOrder.slice(before.queueCursor);
    const selectedTurn = remaining[2];
    const committedTurn = before.bidOrder[0];
    if (!selectedTurn || !committedTurn) throw new Error('Exact synthetic turns are required');
    const exactRemaining = [selectedTurn, ...remaining.filter((_, index) => index !== 2)];
    const exactOrder = [committedTurn, ...exactRemaining];
    const turns = exactRemaining.map((entry) => ({
      memberId: entry.memberId,
      stageId: entry.stageId ?? null,
    }));
    const fields = {
      orderedRemainingMemberIds: turns.map((turn) => turn.memberId),
      orderedRemainingTurns: turns,
    };
    expect((await execute(before, command('live.alter_order', fields))).result).toMatchObject({
      code: 'ALTER_ORDER_STAGE_SEQUENCE_INVALID',
    });
    const result = await confirmed(
      before,
      command('live.alter_order', { ...fields, adminOverride: override }),
    );
    expect(result.state).toMatchObject({
      currentBidderId: 43,
      queueCursor: 1,
      live: { currentStageId: 'captains' },
    });
    expect(result.state.bidOrder).toEqual(exactOrder);
    if (result.result.kind !== 'accepted') throw new Error('Expected reviewed adjustment');
    expect(result.result.envelope.payload).toMatchObject({
      beforeMemberIds: remaining.map((entry) => entry.memberId),
      afterMemberIds: fields.orderedRemainingMemberIds,
      beforeTurns: remaining.map((entry) => ({
        memberId: entry.memberId,
        stageId: entry.stageId ?? null,
      })),
      afterTurns: turns,
    });
    const replay = await execute(result.state, result.command);
    expect(replay.result).toEqual(result.result);
    expect((await loadCanonicalBidSessionState(db, sessionId))?.bidOrder).toEqual(exactOrder);
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
  });

  it('reviews and commits 240 exact turns with one frozen-policy read per command and no per-turn SQL', async () => {
    const participantIds = Array.from({ length: 120 }, (_, index) => index + 100);
    seed(true, 10, null, ['G1', 'G2', 'G3', 'G4'], participantIds);
    const before = initialState();
    const firstMemberId = participantIds[0];
    if (firstMemberId === undefined) throw new Error('Order participants required');
    before.currentBidderId = firstMemberId;
    before.bidOrder = ['days', 'captains'].flatMap((stageId, stageIndex) =>
      participantIds.map((memberId, index) => ({
        ordinal: stageIndex * participantIds.length + index + 1,
        memberId,
        pool: 'OFC' as const,
        stageId,
      })),
    );
    const selectedTurn = before.bidOrder[239];
    if (selectedTurn === undefined) throw new Error('240 exact turns required');
    const exactOrder = [selectedTurn, ...before.bidOrder.slice(0, 239)];
    const turns = exactOrder.map((entry) => ({
      memberId: entry.memberId,
      stageId: entry.stageId ?? null,
    }));
    const fields = {
      orderedRemainingMemberIds: turns.map((entry) => entry.memberId),
      orderedRemainingTurns: turns,
      adminOverride: override,
    };
    const input = command('live.alter_order', fields);
    if (input.type !== 'live.alter_order') throw new Error('Exact order command required');
    readQueries = [];
    const preview = await execute(before, input, true);
    expect(preview.result.kind).toBe('accepted');
    expect(preview.canonicalState?.bidOrder).toEqual(exactOrder);
    const policyReads = () =>
      readQueries.filter((query) => /from "bid_session_policy_snapshots"/i.test(query)).length;
    expect(policyReads()).toBe(1);
    expect(readQueries).toHaveLength(5);
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 0,
    });
    if (preview.result.kind !== 'accepted') throw new Error('Exact order preview required');
    const warningCodes = (
      preview.result.envelope.payload as { adminOverride: { warningCodes: string[] } }
    ).adminOverride.warningCodes;
    readQueries = [];
    const committed = await execute(before, {
      ...input,
      adminOverride: { acknowledged: true, warningCodes },
    });
    expect(committed.result.kind).toBe('accepted');
    expect(policyReads()).toBe(1);
    expect(readQueries).toHaveLength(5);
    expect(committed.canonicalState?.bidOrder).toEqual(exactOrder);
    expect(committed.canonicalState?.currentBidderId).toBe(selectedTurn.memberId);
    expect(committed.canonicalState?.live?.currentStageId).toBe('captains');
    expect((await loadCanonicalBidSessionState(db, sessionId))?.bidOrder).toEqual(exactOrder);
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_events').get()).toEqual({
      count: 1,
    });
    if (committed.result.kind !== 'accepted') throw new Error('Exact order commit required');
    expect(committed.result.envelope.payload).toMatchObject({
      beforeTurns: before.bidOrder.map((entry) => ({
        memberId: entry.memberId,
        stageId: entry.stageId,
      })),
      afterTurns: turns,
      adminOverride: { warningCodes: ['ORDER_DEVIATION', 'STAGE_DEVIATION'] },
    });
  });

  it('rejects fabricated or repeated exact turns and mismatched member IDs while retaining the legacy FIFO contract', async () => {
    seed();
    const before = initialState();
    const exactTurns = before.bidOrder.map((entry) => ({
      memberId: entry.memberId,
      stageId: entry.stageId ?? null,
    }));
    const members = exactTurns.map((entry) => entry.memberId);
    for (const stageId of ['days', 'fabricated-stage']) {
      const invalidTurns = exactTurns.map((entry, index) =>
        index === 3 ? { ...entry, stageId } : entry,
      );
      const result = await execute(
        before,
        command('live.alter_order', {
          orderedRemainingMemberIds: members,
          orderedRemainingTurns: invalidTurns,
          adminOverride: override,
        }),
        true,
      );
      expect(result.result).toMatchObject({ code: 'ALTER_ORDER_TURN_SET_MISMATCH' });
    }
    const mismatch = await execute(
      before,
      command('live.alter_order', {
        orderedRemainingMemberIds: [43, 42, 42, 43, 44],
        orderedRemainingTurns: exactTurns,
        adminOverride: override,
      }),
      true,
    );
    expect(mismatch.result).toMatchObject({ code: 'ALTER_ORDER_TURN_IDS_MISMATCH' });
    expect(sqlite.prepare('SELECT count(*) AS count FROM bid_command_receipts').get()).toEqual({
      count: 0,
    });
    const legacy = await confirmed(
      before,
      command('live.alter_order', {
        orderedRemainingMemberIds: [43, 42, 42, 43, 44],
        adminOverride: override,
      }),
    );
    expect(legacy.state.bidOrder.map((entry) => entry.ordinal)).toEqual([2, 1, 3, 4, 5]);
    expect(legacy.state.bidOrder[0]).toMatchObject({ memberId: 43, stageId: 'days' });
  });

  it('assigns and releases any directed role after a seat award with a retained-seat warning and unchanged selection rights', async () => {
    seed(true);
    const awarded = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 43,
        positionId: 'A101',
        aDay: 'G1',
        adminOverride: override,
      }),
    );
    const assigned = await confirmed(
      awarded.state,
      command(
        'live.set_exceptional_assignment',
        {
          memberId: 43,
          operation: 'ASSIGN',
          roleLabel: 'Acting Training Coordinator',
          adminOverride: override,
        },
        1,
      ),
    );
    expect(assigned.state.fills).toEqual(awarded.state.fills);
    expect(assigned.state.live?.exceptionalAssignments?.at(-1)?.roleLabel).toBe(
      'Acting Training Coordinator',
    );
    const released = await confirmed(
      assigned.state,
      command(
        'live.set_exceptional_assignment',
        {
          memberId: 43,
          operation: 'RELEASE',
          roleLabel: 'Acting Training Coordinator',
          adminOverride: override,
        },
        2,
      ),
    );
    expect(released.state.fills).toEqual(awarded.state.fills);
    expect(released.state.annual?.returningMemberId).toBeNull();
    expect(released.state.currentBidderId).toBe(42);
    expect(released.state.live?.exceptionalAssignments?.at(-1)?.releasedAtMs).toEqual(
      expect.any(Number),
    );
  });

  it('keeps a paused session paused when directing its current member to an acting duty', async () => {
    seed();
    const state = initialState();
    state.currentPhase = 'paused';
    if (!state.live) throw new Error('paused progress required');
    state.live.pausedPhase = 'position_bid';
    const assigned = await confirmed(
      state,
      command('live.set_exceptional_assignment', {
        memberId: 42,
        operation: 'ASSIGN',
        roleLabel: 'Acting Chief duty',
        adminOverride: override,
      }),
    );
    expect(assigned.state).toMatchObject({
      currentPhase: 'paused',
      currentBidderId: 43,
      live: { pausedPhase: 'position_bid' },
    });
    const resumed = await execute(assigned.state, command('live.resume', {}, 1));
    expect(resumed.canonicalState).toMatchObject({
      currentPhase: 'position_bid',
      currentBidderId: 43,
    });
  });

  it('prompts an early combat Captain A-Day at the Captain entry rather than repeated Days eligibility', async () => {
    seed(true);
    const early = await confirmed(
      initialState(),
      command('live.record_selection', {
        memberId: 43,
        positionId: 'A101',
        adminOverride: override,
      }),
    );
    const days = await execute(
      early.state,
      command('live.record_selection', { memberId: 42, positionId: 'D101', aDay: 'MON' }, 1),
    );
    expect(days.canonicalState).toMatchObject({
      currentPhase: 'a_day_bid',
      currentBidderId: 43,
      queueCursor: 3,
    });
    const original = initialState().bidOrder;
    expect(days.canonicalState?.bidOrder).toEqual(original);
    expect(days.canonicalState?.bidOrder[3]?.stageId).toBe('captains');
  });

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
