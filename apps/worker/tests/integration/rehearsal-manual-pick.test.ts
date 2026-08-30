import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalize } from '../../src/audit/canonical-json.js';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'f'.repeat(64);
async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'B',
      last_name: 'A',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

function manualCommandFingerprint(
  sessionId: string,
  body: { member_id: number; position_id: string; force?: boolean; reason?: string },
  expectedMockControlRevision = 0,
): string {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        canonicalize({
          fingerprint_version: 1,
          operation: 'manual_pick',
          session_id: sessionId,
          actor_subject: '0',
          expected_mock_control_revision: expectedMockControlRevision,
          payload: {
            member_id: body.member_id,
            position_id: body.position_id,
            force: body.force === true,
            reason: body.reason ?? null,
          },
        }),
      ),
    ),
  );
}

async function insertPendingManualReceipt(
  h: TestD1,
  input: {
    sessionId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    operation?: 'auto_bid' | 'manual_pick';
    expectedMockControlRevision?: number;
  },
): Promise<void> {
  await h.db.run(
    `INSERT INTO mock_rehearsal_command_receipts (
       bid_session_id, idempotency_key, operation, actor_subject, request_fingerprint,
       expected_mock_control_revision, state, created_at
     ) VALUES (?, ?, ?, '0', ?, ?, 'pending', ?);`,
    [
      input.sessionId,
      input.idempotencyKey,
      input.operation ?? 'manual_pick',
      input.requestFingerprint,
      input.expectedMockControlRevision ?? 0,
      Date.now(),
    ],
  );
}

async function insertLegacyMockBidAudit(
  h: TestD1,
  input: {
    sessionId: string;
    bidId: string;
    auditId: string;
    action?: 'admin_bid_for_member' | 'forced_pick';
  },
): Promise<void> {
  await h.db.run(
    `INSERT INTO audit_log (
       id, bid_session_id, seq, actor_type, actor_id, action, target_kind,
       target_id, before_state, after_state, reason, ai_advisory_id, client_meta, created_at
     ) VALUES (?, ?, 1, 'admin', NULL, ?, 'bid', ?, NULL, NULL,
       'legacy interruption boundary', NULL, NULL, ?);`,
    [
      input.auditId,
      input.sessionId,
      input.action ?? 'admin_bid_for_member',
      input.bidId,
      Math.floor(Date.now() / 1000),
    ],
  );
}

async function insertV3PolicySnapshot(
  h: TestD1,
  sessionId: string,
  capturedAt: number,
  options?: { requiredRank?: 'FF' | 'LT'; includeInvalidRule?: boolean },
) {
  const requiredRank = options?.requiredRank ?? 'FF';
  const ruleBookMaterial = {
    v: 1 as const,
    rules: [
      {
        ruleBookVersion: '2026.2',
        positionId: 'A101',
        templateVersion: '2026.1',
        requiredCriteriaJson: JSON.stringify({ rank: [requiredRank], credentials: [], custom: [] }),
        pointsPreferenceJson: '{"max":0,"items":[]}',
        tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
      },
      ...(options?.includeInvalidRule
        ? [
            {
              ruleBookVersion: '2026.2',
              positionId: 'B101',
              templateVersion: '2026.1',
              requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":["pre_bid_pool"]}',
              pointsPreferenceJson: '{"max":0,"items":[]}',
              tieBreakChainJson: '["points","rsc_seniority","rank_seniority"]',
            },
          ]
        : []),
    ],
    positions: [
      {
        id: 'A101',
        templateVersion: '2026.1',
        bidParticipation: 'BIDDABLE',
        isExcludedFromCount: false,
        shift: 'A',
        station: '1',
        unit: 'Engine 1',
        rankRequired: 'FF',
        positionName: 'Engine 1 FF',
      },
      ...(options?.includeInvalidRule
        ? [
            {
              id: 'B101',
              templateVersion: '2026.1',
              bidParticipation: 'BIDDABLE',
              isExcludedFromCount: false,
              shift: 'B',
              station: '1',
              unit: 'Engine 1',
              rankRequired: 'FF',
              positionName: 'Invalid synthetic policy row',
            },
          ]
        : []),
    ],
  };
  await h.db.run(
    `INSERT INTO bid_session_policy_snapshots
       (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
     VALUES (?, '2026.2', '2026.1', 0, ?, ?);`,
    [
      sessionId,
      JSON.stringify({
        v: 3,
        ruleBookVersion: '2026.2',
        ruleBookRevision: 0,
        positionTemplateVersion: '2026.1',
        configurationRevision: 1,
        settings: { v: 1, expectedDurationDays: 2, turnTimerSeconds: 180 },
        capturedAtMs: capturedAt,
        members: [
          {
            memberId: 60,
            pool: 'FF',
            rscSeniority: 80,
            rankSeniority: null,
            exclusionReason: null,
            authoritativeAssignmentId: null,
            rank: 'FF',
            isProbationary: false,
            credentialNames: [],
          },
        ],
        ruleBookMaterial,
      }),
      capturedAt,
    ],
  );
}

async function seedMockSessionWithEligibleFF(
  h: TestD1,
  sessionId: string,
  opts?: { isMock?: boolean },
) {
  const now = Date.now();
  const isMock = opts?.isMock ?? true;
  await h.db.run(
    "INSERT INTO members (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority, is_probationary, created_at, updated_at) VALUES (60, '60060', 'Proxy', 'Bid', 'FF', 'FF', 80, 0, ?, ?);",
    [now, now],
  );
  await h.db.run(
    "INSERT INTO position_templates (version, effective_year) VALUES ('2026.1', 2026);",
  );
  await h.db.run(
    "INSERT INTO positions (id, template_version, shift, station, division, unit, rank_required, position_name) VALUES ('A101', '2026.1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Engine 1 FF');",
  );
  await h.db.run(
    "INSERT INTO rule_books (version, effective_year, status) VALUES ('2026.2', 2026, 'draft');",
  );
  await h.db.run(
    `INSERT INTO position_rules
     (rule_book_version, position_id, template_version, required_criteria, points_preference, tie_break_chain)
     VALUES ('2026.2', 'A101', '2026.1',
       '{"rank":["FF"],"credentials":[],"custom":[]}',
       '{"max":0,"items":[]}',
       '["points","rsc_seniority","rank_seniority"]');`,
  );
  await h.db.run(
    `INSERT INTO bid_years
       (year, status, position_template_version, rule_book_version, config_json, configuration_revision)
     VALUES
       (2026, 'configuring', '2026.1', '2026.2',
        '{"v":1,"expectedDurationDays":2,"turnTimerSeconds":180}', 1);`,
  );
  await h.db.run(
    "INSERT INTO bid_sessions (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock) VALUES (?, 2026, ?, 'position_bid', 180, 2, 1, ?);",
    [sessionId, now, isMock ? 1 : 0],
  );
  await insertV3PolicySnapshot(h, sessionId, now);
}

describe('POST /api/admin/rehearsal/:sessionId/manual-pick', () => {
  let h: TestD1;
  const sessionId = '01HMANUAL000000000000000PICK';

  beforeEach(async () => {
    h = await setupTestD1();
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('commits a pick on a mock session and writes the audit row', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-commit',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bid_id: string; forced: boolean };
    expect(body.forced).toBe(false);

    const bidRows = await h.db.run('SELECT member_id, position_id, forced FROM bids WHERE id = ?', [
      body.bid_id,
    ]);
    const r = bidRows.results[0] as
      | { member_id: number; position_id: string; forced: number }
      | undefined;
    expect(r?.member_id).toBe(60);
    expect(r?.position_id).toBe('A101');
    expect(r?.forced).toBe(0);

    const auditRows = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'admin_bid_for_member' AND bid_session_id = ?",
      [sessionId],
    );
    expect(auditRows.results[0]?.n).toBe(1);
  });

  it('replays a manual pick before filled-position validation and rejects altered or stale commands', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    const token = await adminJwt();
    const request = (body: Record<string, unknown>, key = 'manual-exact-replay') =>
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      });
    const initialBody = {
      member_id: 60,
      position_id: 'A101',
      expected_mock_control_revision: 0,
    };

    const first = await app.fetch(request(initialBody), { ...h.env, JWT_SIGNING_KEY: KEY });
    const firstText = await first.text();
    expect(first.status).toBe(201);

    const replay = await app.fetch(request(initialBody), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('x-mbfd-idempotent-replay')).toBe('true');
    expect(await replay.text()).toBe(firstText);

    const altered = await app.fetch(request({ ...initialBody, force: true }), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(altered.status).toBe(409);
    expect(await altered.json()).toEqual({ error: 'rehearsal_idempotency_key_reused' });

    const stale = await app.fetch(request(initialBody, 'manual-stale-revision'), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: 'stale_mock_control_revision',
      expected_mock_control_revision: 0,
      current_mock_control_revision: 1,
    });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [sessionId]))
        .results[0],
    ).toMatchObject({ n: 1 });
  });

  it('rolls back receipt and domain writes for pre- and post-reservation batch failures', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    const token = await adminJwt();
    const request = () =>
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-fault-injection',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          expected_mock_control_revision: 0,
        }),
      });
    const assertNothingCommitted = async () => {
      expect(
        (await h.db.run('SELECT mock_control_revision FROM bid_sessions WHERE id = ?', [sessionId]))
          .results[0],
      ).toMatchObject({ mock_control_revision: 0 });
      expect(
        (await h.db.run('SELECT count(*) AS n FROM mock_rehearsal_command_receipts')).results[0],
      ).toMatchObject({ n: 0 });
      expect((await h.db.run('SELECT count(*) AS n FROM bids')).results[0]).toMatchObject({ n: 0 });
      expect((await h.db.run('SELECT count(*) AS n FROM audit_log')).results[0]).toMatchObject({
        n: 0,
      });
    };

    // Failure before receipt reservation: there is no identity or domain state.
    h.failNextBatchAt(0);
    const beforeReservation = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(beforeReservation.status).toBe(503);
    await assertNothingCommitted();

    // Failure immediately after reservation: the native D1-style batch rolls
    // the pending receipt back with every other command write.
    h.failNextBatchAt(1);
    const afterReservation = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(afterReservation.status).toBe(503);
    await assertNothingCommitted();

    const retry = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(retry.status).toBe(201);
    expect((await h.db.run('SELECT count(*) AS n FROM bids')).results[0]).toMatchObject({ n: 1 });
  });

  it('recovers an untouched legacy pending receipt by reusing its command identity', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    const body = { member_id: 60, position_id: 'A101' };
    const key = 'manual-pending-pre-domain';
    const fingerprint = manualCommandFingerprint(sessionId, body);
    await insertPendingManualReceipt(h, {
      sessionId,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
    });
    const token = await adminJwt();
    const request = () =>
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ ...body, expected_mock_control_revision: 0 }),
      });

    const recovered = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(recovered.status).toBe(201);
    const recoveredBody = await recovered.text();
    expect(
      (
        await h.db.run(
          `SELECT state, resulting_mock_control_revision
             FROM mock_rehearsal_command_receipts
            WHERE bid_session_id = ? AND idempotency_key = ?`,
          [sessionId, key],
        )
      ).results[0],
    ).toEqual({ state: 'completed', resulting_mock_control_revision: 1 });

    const replay = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('x-mbfd-idempotent-replay')).toBe('true');
    expect(await replay.text()).toBe(recoveredBody);
    expect((await h.db.run('SELECT count(*) AS n FROM bids')).results[0]).toMatchObject({ n: 1 });
  });

  it('reconciles a post-domain legacy pending receipt without issuing a second pick', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    const body = { member_id: 60, position_id: 'A101' };
    const key = 'manual-pending-post-domain';
    const fingerprint = manualCommandFingerprint(sessionId, body);
    await insertPendingManualReceipt(h, {
      sessionId,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
    });
    await h.db.run('UPDATE bid_sessions SET mock_control_revision = 1 WHERE id = ?', [sessionId]);
    await h.db.run(
      `INSERT INTO bids (
         id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
         admin_actor_id, reason, idempotency_key, portal_sync_status, portal_sync_attempts
       ) VALUES ('legacy-post-domain-bid', ?, 1, 60, 'A101', ?, 0, NULL,
         'legacy interruption boundary', ?, 'pending', 0);`,
      [sessionId, Math.floor(Date.now() / 1000), `rehearsal-manual:${fingerprint}`],
    );
    await insertLegacyMockBidAudit(h, {
      sessionId,
      bidId: 'legacy-post-domain-bid',
      auditId: 'legacy-post-domain-audit',
    });
    const token = await adminJwt();
    const request = () =>
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ ...body, expected_mock_control_revision: 0 }),
      });

    const recovered = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toEqual({
      bid_id: 'legacy-post-domain-bid',
      forced: false,
      mock_control_revision: 1,
    });
    expect((await h.db.run('SELECT count(*) AS n FROM bids')).results[0]).toMatchObject({ n: 1 });

    const replay = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('x-mbfd-idempotent-replay')).toBe('true');
    expect(await replay.json()).toEqual({
      bid_id: 'legacy-post-domain-bid',
      forced: false,
      mock_control_revision: 1,
    });
  });

  it('terminalizes a partially committed pending receipt without falsely calling it not applied', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    const body = { member_id: 60, position_id: 'A101' };
    const key = 'manual-pending-inconsistent';
    const fingerprint = manualCommandFingerprint(sessionId, body);
    await insertPendingManualReceipt(h, {
      sessionId,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
    });
    // This models the old unsafe interruption boundary: the Bid and revision
    // exist, but the matching audit evidence does not. Recovery must not call
    // this "not applied" and must not create a duplicate Bid.
    await h.db.run('UPDATE bid_sessions SET mock_control_revision = 1 WHERE id = ?', [sessionId]);
    await h.db.run(
      `INSERT INTO bids (
         id, bid_session_id, ordinal, member_id, position_id, picked_at, forced,
         admin_actor_id, reason, idempotency_key, portal_sync_status, portal_sync_attempts
       ) VALUES ('legacy-partial-without-audit', ?, 1, 60, 'A101', ?, 0, NULL,
         'legacy interruption boundary', ?, 'pending', 0);`,
      [sessionId, Math.floor(Date.now() / 1000), `rehearsal-manual:${fingerprint}`],
    );
    const token = await adminJwt();
    const request = (idempotencyKey = key) =>
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ ...body, expected_mock_control_revision: 0 }),
      });

    const terminal = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(terminal.status).toBe(409);
    expect(await terminal.json()).toMatchObject({
      error: 'rehearsal_command_recovery_required',
    });
    expect(
      (
        await h.db.run(
          `SELECT outcome
             FROM mock_rehearsal_command_recovery_outcomes
            WHERE bid_session_id = ? AND idempotency_key = ?`,
          [sessionId, key],
        )
      ).results[0],
    ).toEqual({
      outcome: 'recovery_required',
    });
    expect((await h.db.run('SELECT count(*) AS n FROM bids')).results[0]).toMatchObject({ n: 1 });
    expect((await h.db.run('SELECT count(*) AS n FROM audit_log')).results[0]).toMatchObject({
      n: 0,
    });
    const terminalReplay = await app.fetch(request(), { ...h.env, JWT_SIGNING_KEY: KEY });
    expect(terminalReplay.status).toBe(409);
    expect(terminalReplay.headers.get('x-mbfd-idempotent-replay')).toBe('true');

    const crossOperationKey = 'manual-cross-operation-key';
    await insertPendingManualReceipt(h, {
      sessionId,
      idempotencyKey: crossOperationKey,
      requestFingerprint: fingerprint,
      operation: 'auto_bid',
    });
    const crossOperation = await app.fetch(request(crossOperationKey), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(crossOperation.status).toBe(409);
    expect(await crossOperation.json()).toEqual({ error: 'rehearsal_idempotency_key_reused' });
  });

  it('rejects manual-pick after a canonical command has locked the mock session', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    await h.db.run(
      `INSERT INTO canonical_bid_session_state
       (bid_session_id, current_seq, state_json, last_command_id, created_at, updated_at)
       VALUES (?, 0, ?, NULL, ?, ?);`,
      [
        sessionId,
        JSON.stringify({
          bidSessionId: sessionId,
          currentPhase: 'paused',
          frozenAt: 1,
          lastSeq: 0,
        }),
        Date.now(),
        Date.now(),
      ],
    );

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-canonical',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'canonical_mutation_requires_command' });
    const bidRows = await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id = ?', [
      sessionId,
    ]);
    expect(bidRows.results[0]).toMatchObject({ n: 0 });
    const auditRows = await h.db.run(
      'SELECT count(*) AS n FROM audit_log WHERE bid_session_id = ?',
      [sessionId],
    );
    expect(auditRows.results[0]).toMatchObject({ n: 0 });
  });

  it('refuses with 403 when the session is not a mock', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId, { isMock: false });
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-not-mock',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_mock_session');
  });

  it('refuses with 422 when the member is ineligible for the position', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    // Rebuild this isolated fixture before the operation so its immutable
    // material, not a mutable source row, carries the LT-only rule.
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?;', [
      sessionId,
    ]);
    await insertV3PolicySnapshot(h, sessionId, Date.now(), { requiredRank: 'LT' });
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-ineligible',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; reasons: { code: string }[] };
    expect(body.error).toBe('ineligible');
    expect(body.reasons.some((r) => r.code === 'RANK_REQUIRED')).toBe(true);
  });

  it('honours force=true to bypass eligibility', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?;', [
      sessionId,
    ]);
    await insertV3PolicySnapshot(h, sessionId, Date.now(), { requiredRank: 'LT' });
    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-force',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          force: true,
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { bid_id: string; forced: boolean };
    expect(body.forced).toBe(true);
    const auditRows = await h.db.run(
      "SELECT count(*) AS n FROM audit_log WHERE action = 'forced_pick' AND bid_session_id = ?",
      [sessionId],
    );
    expect(auditRows.results[0]?.n).toBe(1);
  });

  it('does not let force=true bypass invalid captured V3 rule material', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    await h.db.run('DELETE FROM bid_session_policy_snapshots WHERE bid_session_id = ?;', [
      sessionId,
    ]);
    await insertV3PolicySnapshot(h, sessionId, Date.now(), { includeInvalidRule: true });

    const res = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-invalid-frozen',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          force: true,
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'session_policy_snapshot_unavailable',
      policy_error: 'session_rule_book_invalid',
    });
  });

  it('refuses with 409 when the position is already filled', async () => {
    await seedMockSessionWithEligibleFF(h, sessionId);
    // First pick succeeds.
    const first = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-filled-first',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          expected_mock_control_revision: 0,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(first.status).toBe(201);
    // Second pick targets the same position — should be rejected.
    const second = await app.fetch(
      new Request(`http://x/api/admin/rehearsal/${sessionId}/manual-pick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await adminJwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'manual-filled-second',
        },
        body: JSON.stringify({
          member_id: 60,
          position_id: 'A101',
          expected_mock_control_revision: 1,
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('position_already_filled');
  });
});
