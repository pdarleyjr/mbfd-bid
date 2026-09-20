import { randomUUID } from 'node:crypto';
import { LiveBidCommandSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import { app } from '../../src/index.js';
import { loadFrozenSessionBidPolicy } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { loadOfficialAnnualCompletion } from '../../src/lib/official-annual-completion.js';
import {
  mockActor,
  mockMember,
  mockSeats,
  seedCanonicalMockInputs,
} from './helpers/synthetic-canonical-mock.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('canonical managed Mock from Save through verified completion', () => {
  let h: TestD1;
  let token: string;
  let sessionId: string;
  const commands: string[] = [];
  async function request(path: string, body?: unknown) {
    return app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
      }),
      h.env,
    );
  }
  async function state() {
    const value = await loadCanonicalBidSessionState(h.env.DB, sessionId);
    if (!value) throw new Error('Started canonical Mock required');
    return value;
  }
  async function command(type: string, fields: Record<string, unknown> = {}, accepted = true) {
    const current = await state();
    const response = await request(`bid-session/${sessionId}/commands/live`, {
      v: 1,
      type,
      commandId: randomUUID(),
      expectedSeq: current.lastSeq,
      reason: 'Synthetic final-policy operator rehearsal',
      evidenceReference: 'synthetic:operator-reviewed',
      ...fields,
    });
    const result = (await response.json()) as { kind: string; code?: string };
    expect(result.kind, JSON.stringify(result)).toBe(accepted ? 'accepted' : 'rejected');
    commands.push(type);
    return result;
  }
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-02T15:00:00Z'));
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    commands.length = 0;
    const input = await seedCanonicalMockInputs(h);
    token = await signJwt(
      {
        sub: mockActor,
        emp: 'SYNTHETIC-MOCK-1',
        role: 'admin',
        rank: 'DC',
        first_name: 'Synthetic',
        last_name: 'Operator',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    // Loopback transport only: the real HTTP adapter owns actor/candidate
    // normalization, and every command executes the production canonical D1
    // service. This does not substitute for separate Durable Object runtime tests.
    const leaseTransport = h.env.BID_SESSION.get(h.env.BID_SESSION.idFromName('synthetic-lease'));
    h.env.BID_SESSION = {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = new Request(input, init);
          if (new URL(req.url).pathname.startsWith('/admin/normal-mutation-lease/'))
            return leaseTransport.fetch(req.url);
          if (new URL(req.url).pathname !== '/admin/commands/live')
            return Response.json({ error: 'unexpected_test_transport' }, { status: 400 });
          const body = LiveBidCommandSchema.parse(await req.json());
          const frozen = await loadFrozenSessionBidPolicy(getDb(h.env.DB), body.bidSessionId);
          const current = await state();
          if (!frozen.ok || frozen.snapshot.settings.v !== 3)
            throw new Error('Frozen Mock policy required');
          const committed = await commitLiveBidCommand({
            db: h.env.DB,
            command: body,
            state: current,
            policy: frozen.snapshot.settings.livePolicy,
          });
          return Response.json(committed.result, {
            status: committed.result.kind === 'accepted' ? 200 : 409,
          });
        },
      }),
    } as unknown as typeof h.env.BID_SESSION;
    const saved = await request('bid/2027/versions', {
      ...input,
      reason: 'Save synthetic complete annual policy',
    });
    expect(saved.status, await saved.clone().text()).toBe(201);
    const version = (await saved.json()) as { versionId: string; contentSha256: string };
    const selection = { versionId: version.versionId, versionSha256: version.contentSha256 };
    const preview = await request('bid/2027/preview', { kind: 'mock', ...selection });
    expect(preview.status, await preview.clone().text()).toBe(200);
    const prepared = (await preview.json()) as {
      contextSha256: string;
      runtimeSourceToken: string;
    };
    expect(prepared, JSON.stringify(prepared)).toHaveProperty('contextSha256');
    const created = await request('bid/2027/mock-sessions', {
      ...selection,
      expectedContextSha256: prepared.contextSha256,
      expectedSourceToken: prepared.runtimeSourceToken,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    sessionId = ((await created.json()) as { id: string }).id;
    expect(await loadCanonicalBidSessionState(h.env.DB, sessionId)).toBeNull();
    const started = await request(`bid-session/${sessionId}/start`, {});
    expect(started.status, await started.clone().text()).toBe(200);
    expect((await state()).lastSeq).toBe(0);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await teardownTestD1(h);
  });

  it('executes stages, eligibility, specialty scoring/coverage, pools, fallback, A-Day, defer/return, terms and amendment without seeded outcomes', async () => {
    const priorAssignments = h.sqlite.prepare('SELECT * FROM member_assignments ORDER BY id').all();
    const termDeparture = {
      assignmentId: 'synthetic-source-term-assignment',
      memberConfirmed: true,
      evidenceReference: 'synthetic:recorded-member-choice',
    };
    expect(
      (await request(`result-distribution/${sessionId}/rehearsal-transition-preview`)).status,
    ).toBe(409);
    for (const [ordinal, positionId, aDay, stage] of [
      [1, mockSeats.dc, 'G1', 'DC'],
      [2, mockSeats.cpt, 'G2', 'CPT'],
      [3, mockSeats.lt, 'G1', 'LT'],
    ] as const) {
      const current = await state();
      expect(current.bidOrder[current.queueCursor]?.stageId).toBe(stage);
      await command('live.record_selection', { memberId: mockMember(ordinal), positionId, aDay });
    }
    expect((await state()).currentBidderId).toBe(mockMember(4));
    expect(
      (
        await command(
          'live.record_selection',
          {
            memberId: mockMember(4),
            positionId: mockSeats.pool[0],
            pool: { poolId: 'station-pool' },
            aDay: 'G3',
          },
          false,
        )
      ).code,
    ).toBe('TERM_DEPARTURE_ELECTION_REQUIRED');
    const ineligible = await command(
      'live.record_selection',
      { memberId: mockMember(4), positionId: mockSeats.specialty, aDay: 'G1', termDeparture },
      false,
    );
    expect(ineligible.code).toBe('MEMBER_NOT_ELIGIBLE');
    await command('live.record_selection', {
      memberId: mockMember(4),
      positionId: mockSeats.pool[0],
      pool: { poolId: 'station-pool' },
      aDay: 'G3',
      termDeparture,
    });
    await command('live.amend_selection', {
      memberId: mockMember(4),
      fromPositionId: mockSeats.pool[0],
      toPositionId: mockSeats.term,
      aDay: 'G3',
      termDeparture,
    });
    expect((await state()).fills[mockSeats.pool[0]]).toBeUndefined();
    const coverageResponse = await request(`bid-session/${sessionId}/specialty-live`);
    expect(coverageResponse.status, await coverageResponse.clone().text()).toBe(200);
    const coverage = (await coverageResponse.json()) as Record<string, unknown>;
    expect(coverage.opportunity_pools).toMatchObject([{ resolvedPositionId: mockSeats.pool[0] }]);
    expect(coverage.specialty_coverage, JSON.stringify(coverage.specialty_coverage)).toMatchObject({
      availability: 'AVAILABLE',
      status: 'FEASIBLE',
      total_specialty_seat_count: 1,
    });
    await command('live.start_specialty_adjudication', {
      specialtyId: 'advanced',
      positionId: mockSeats.specialty,
    });
    const specialty = (await (await request(`bid-session/${sessionId}/specialty-live`)).json()) as {
      active: { candidates: { member_id: number; points: number }[] };
    };
    expect(specialty.active.candidates).toMatchObject([{ member_id: mockMember(6), points: 8 }]);
    expect((await state()).live?.specialty?.candidateMemberIds).toEqual([mockMember(6)]);
    await command('live.resolve_specialty_candidate', {
      memberId: mockMember(6),
      outcome: 'ACCEPT',
      aDay: 'G1',
    });
    expect((await state()).currentBidderId).toBe(mockMember(5));
    await command('live.record_selection', {
      memberId: mockMember(5),
      positionId: mockSeats.pool[0],
      pool: { poolId: 'station-pool' },
      aDay: 'G4',
    });
    expect((await state()).currentBidderId).toBe(mockMember(7));
    expect(
      (await command('live.declare_unreachable', { memberId: mockMember(7) }, false)).code,
    ).toBe('CONTACT_ATTEMPTS_INCOMPLETE');
    for (const method of ['PHONE', 'TEXT', 'PHONE'])
      await command('live.record_contact_attempt', { memberId: mockMember(7), method });
    await command('live.declare_unreachable', { memberId: mockMember(7) });
    await command('live.disposition', { disposition: 'DEFER' });
    expect((await state()).currentBidderId).toBe(mockMember(8));
    await command('live.return_at_current_sequence', { memberId: mockMember(7) });
    await command('live.record_selection', {
      memberId: mockMember(7),
      positionId: mockSeats.pool[1],
      pool: { poolId: 'station-pool' },
      aDay: 'G3',
    });
    await command('live.record_fallback_response', {
      memberId: mockMember(8),
      positionId: mockSeats.pool[2],
      fallback: { policyId: 'pool-fallback', tierId: 'volunteer' },
      outcome: 'DECLINE',
    });
    await command('live.force_selection', {
      memberId: mockMember(8),
      positionId: mockSeats.pool[2],
      pool: { poolId: 'station-pool' },
      fallback: { policyId: 'pool-fallback', tierId: 'force' },
      aDay: 'G4',
    });
    expect((await state()).currentPhase).toBe('complete');
    await command('live.complete_session');
    const completed = await state();
    expect(Object.keys(completed.fills)).toHaveLength(8);
    expect(completed.fills[mockSeats.closed]).toBeUndefined();
    expect(completed.aDay?.picks).toHaveLength(8);
    expect(completed.annual?.unresolvedMemberIds).toEqual([]);
    const before = h.sqlite.serialize();
    const results = (await (await request(`bid-session/${sessionId}/results`)).json()) as {
      awards: unknown[];
      provenance: { valid: boolean };
    };
    expect(results.awards).toHaveLength(8);
    expect(results.provenance.valid).toBe(true);
    const rehearsal = await request(
      `result-distribution/${sessionId}/rehearsal-transition-preview`,
    );
    expect(rehearsal.status, await rehearsal.clone().text()).toBe(200);
    expect(await rehearsal.json()).toMatchObject({
      mode: 'MOCK',
      canApply: false,
      status: 'REHEARSAL_PROJECTION_ONLY',
      finalization: { complete: true, blockers: [] },
      applicationBlockers: ['mock_session_not_transitionable'],
    });
    expect(await loadOfficialAnnualCompletion(h.env.DB, sessionId)).toEqual({
      ok: false,
      error: 'mock_session_not_transitionable',
    });
    const after = h.sqlite.serialize();
    expect(
      after.length === before.length && after.every((byte, index) => byte === before[index]),
    ).toBe(true);
    expect(h.sqlite.prepare('SELECT count(*) AS n FROM bids').get()).toEqual({ n: 0 });
    expect(h.sqlite.prepare('SELECT * FROM member_assignments ORDER BY id').all()).toEqual(
      priorAssignments,
    );
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(commands).toContain('live.complete_session');
  }, 30000);
});
