import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'q'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

async function adminJwt(): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-qualification-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

async function request(h: TestD1, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${await adminJwt()}`);
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), {
    ...h.env,
    JWT_SIGNING_KEY: KEY,
  });
}

async function postEvent(
  h: TestD1,
  idempotencyKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return request(h, '/api/admin/qualification-lifecycle/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

describe('admin qualification lifecycle', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (1, 'synthetic-qualification-001', 'Qualified', 'Member', 'FF', 'FF', 1, 0, ${NOW}, ${NOW});
       INSERT INTO credentials (id, name) VALUES
         (10, 'Synthetic EMT'),
         (20, 'Synthetic Hazmat');`,
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('records gained, expiration, and specialty evidence as an idempotent immutable admin-audited history', async () => {
    const gained = {
      kind: 'CERTIFICATION_GAINED',
      member_id: 1,
      credential_id: 10,
      effective_on: '2026-08-01',
      expires_on: '2026-10-01',
      evidence_source: 'synthetic-state-registry',
      evidence_reference: 'SYNTH-EMT-001',
      reason: 'Synthetic EMT renewal evidence reviewed.',
    };
    const created = await postEvent(h, 'qualification-gain-001', gained);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      replayed: false,
      event: {
        kind: 'CERTIFICATION_GAINED',
        memberId: 1,
        credentialId: 10,
        effectiveOn: '2026-08-01',
        expiresOn: '2026-10-01',
        evidenceSource: 'synthetic-state-registry',
        actorSubject: '0',
      },
    });

    const replay = await postEvent(h, 'qualification-gain-001', gained);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      replayed: true,
      event: { kind: 'CERTIFICATION_GAINED' },
    });

    const expired = await postEvent(h, 'qualification-expire-001', {
      kind: 'CERTIFICATION_EXPIRED',
      member_id: 1,
      credential_id: 10,
      effective_on: '2026-09-15',
      expires_on: '2026-09-15',
      evidence_source: 'synthetic-state-registry',
      evidence_reference: 'SYNTH-EMT-EXP-001',
      reason: 'Synthetic EMT expiration evidence reviewed.',
    });
    expect(expired.status).toBe(201);

    const specialty = await postEvent(h, 'qualification-specialty-001', {
      kind: 'SPECIALTY_QUALIFIED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-08-01',
      expires_on: '2027-08-01',
      evidence_source: 'synthetic-specialty-board',
      evidence_reference: 'SYNTH-TR-001',
      reason: 'Synthetic technical rescue qualification reviewed.',
    });
    expect(specialty.status).toBe(201);

    const beforeExpiry = await request(
      h,
      '/api/admin/qualification-lifecycle/members/1?as_of=2026-09-14',
    );
    expect(beforeExpiry.status).toBe(200);
    expect(await beforeExpiry.json()).toMatchObject({
      asOf: '2026-09-14',
      certifications: [
        expect.objectContaining({
          credentialId: 10,
          credentialName: 'Synthetic EMT',
          status: 'active',
        }),
      ],
      specialties: [
        expect.objectContaining({ specialtyCode: 'TECHNICAL_RESCUE', status: 'active' }),
      ],
    });

    const atExpiry = await request(
      h,
      '/api/admin/qualification-lifecycle/members/1?as_of=2026-09-15',
    );
    expect(atExpiry.status).toBe(200);
    expect(await atExpiry.json()).toMatchObject({
      asOf: '2026-09-15',
      certifications: [
        expect.objectContaining({
          credentialId: 10,
          credentialName: 'Synthetic EMT',
          status: 'expired',
        }),
      ],
      specialties: [
        expect.objectContaining({ specialtyCode: 'TECHNICAL_RESCUE', status: 'active' }),
      ],
    });

    expect(
      (await h.db.run('SELECT COUNT(*) AS count FROM member_qualification_events')).results,
    ).toEqual([{ count: 3 }]);
    const qualificationAuditRows = (
      await h.db.run(
        "SELECT action, actor_type, actor_id, target_kind, reason, created_at FROM audit_log WHERE action = 'qualification_lifecycle' ORDER BY created_at, id",
      )
    ).results as Array<{
      action: string;
      actor_id: number | null;
      actor_type: string;
      created_at: number;
      reason: string;
      target_kind: string;
    }>;
    expect(qualificationAuditRows).toEqual([
      expect.objectContaining({
        action: 'qualification_lifecycle',
        actor_type: 'admin',
        actor_id: 0,
        target_kind: 'credential',
        reason: gained.reason,
      }),
      expect.objectContaining({ action: 'qualification_lifecycle', target_kind: 'credential' }),
      expect.objectContaining({ action: 'qualification_lifecycle', target_kind: 'specialty' }),
    ]);
    expect(qualificationAuditRows[0]?.created_at).toEqual(expect.any(Number));
    expect(qualificationAuditRows[0]?.created_at).toBeLessThan(10_000_000_000);
    await expect(
      h.db.run("UPDATE member_qualification_events SET reason = 'tamper'"),
    ).rejects.toThrow('immutable');
  });

  it('requires an active certification before expiration or revocation and keeps the retired direct toggle fail-closed', async () => {
    const invalidExpiration = await postEvent(h, 'qualification-expire-missing-001', {
      kind: 'CERTIFICATION_EXPIRED',
      member_id: 1,
      credential_id: 20,
      effective_on: '2026-09-15',
      expires_on: '2026-09-15',
      evidence_source: 'synthetic-state-registry',
      reason: 'Synthetic missing evidence must not expire a credential.',
    });
    expect(invalidExpiration.status).toBe(422);
    await expect(invalidExpiration.json()).resolves.toEqual({
      error: 'credential_not_active_at_effective_on',
    });

    expect(
      (
        await postEvent(h, 'qualification-hazmat-gain-001', {
          kind: 'CERTIFICATION_GAINED',
          member_id: 1,
          credential_id: 20,
          effective_on: '2026-08-01',
          evidence_source: 'synthetic-state-registry',
          reason: 'Synthetic Hazmat evidence reviewed.',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await postEvent(h, 'qualification-hazmat-revoke-001', {
          kind: 'CERTIFICATION_REVOKED',
          member_id: 1,
          credential_id: 20,
          effective_on: '2026-08-20',
          evidence_source: 'synthetic-state-registry',
          evidence_reference: 'SYNTH-REVOCATION-001',
          reason: 'Synthetic Hazmat revocation evidence reviewed.',
        })
      ).status,
    ).toBe(201);

    const afterRevocation = await request(
      h,
      '/api/admin/qualification-lifecycle/members/1?as_of=2026-08-28',
    );
    expect(afterRevocation.status).toBe(200);
    expect(await afterRevocation.json()).toMatchObject({
      certifications: [expect.objectContaining({ credentialId: 20, status: 'revoked' })],
    });

    const beforeLegacyToggle = await h.db.run(
      `SELECT
         (SELECT COUNT(*) FROM member_credentials) AS credentials,
         (SELECT COUNT(*) FROM member_qualification_events) AS events,
         (SELECT COUNT(*) FROM audit_log) AS audit_rows`,
    );
    const legacyToggle = await request(h, '/api/admin/members/1/credentials/20', {
      method: 'POST',
    });
    expect(legacyToggle.status).toBe(410);
    await expect(legacyToggle.json()).resolves.toMatchObject({
      error: 'legacy_member_write_retired',
      operation: 'credential_change',
      credential_lifecycle: {
        status: 'configured',
        api: '/api/admin/qualification-lifecycle/events',
      },
    });
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM member_credentials) AS credentials,
             (SELECT COUNT(*) FROM member_qualification_events) AS events,
             (SELECT COUNT(*) FROM audit_log) AS audit_rows`,
        )
      ).results,
    ).toEqual(beforeLegacyToggle.results);
  });

  it('records specialty expiration, revocation, and removal as terminal append-only evidence with idempotency and an effective-dated projection', async () => {
    const inactiveTerminal = await postEvent(h, 'specialty-revoke-inactive-001', {
      kind: 'SPECIALTY_REVOKED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-08-01',
      evidence_source: 'synthetic-specialty-board',
      reason: 'Synthetic terminal state requires active specialty evidence.',
    });
    expect(inactiveTerminal.status).toBe(422);
    await expect(inactiveTerminal.json()).resolves.toEqual({
      error: 'specialty_not_active_at_effective_on',
    });

    const invalidExpiry = await postEvent(h, 'specialty-expire-invalid-001', {
      kind: 'SPECIALTY_EXPIRED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-08-01',
      expires_on: '2026-08-02',
      evidence_source: 'synthetic-specialty-board',
      reason: 'Synthetic specialty expiry must match its effective date.',
    });
    expect(invalidExpiry.status).toBe(422);
    await expect(invalidExpiry.json()).resolves.toEqual({
      error: 'expiration_must_match_effective_on',
    });

    const qualified = {
      kind: 'SPECIALTY_QUALIFIED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-08-01',
      evidence_source: 'synthetic-specialty-board',
      evidence_reference: 'SYNTH-TR-001',
      reason: 'Synthetic technical rescue qualification reviewed.',
    };
    expect((await postEvent(h, 'specialty-gain-001', qualified)).status).toBe(201);

    const revoked = {
      kind: 'SPECIALTY_REVOKED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-08-20',
      evidence_source: 'synthetic-specialty-board',
      evidence_reference: 'SYNTH-TR-REV-001',
      reason: 'Synthetic technical rescue revocation reviewed.',
    };
    const revokedCreated = await postEvent(h, 'specialty-revoke-001', revoked);
    expect(revokedCreated.status).toBe(201);
    expect(await revokedCreated.json()).toMatchObject({
      replayed: false,
      event: { kind: 'SPECIALTY_REVOKED', specialtyCode: 'TECHNICAL_RESCUE' },
    });
    const revokedReplay = await postEvent(h, 'specialty-revoke-001', revoked);
    expect(revokedReplay.status).toBe(200);
    expect(await revokedReplay.json()).toMatchObject({
      replayed: true,
      event: { kind: 'SPECIALTY_REVOKED' },
    });

    const afterRevocation = await request(
      h,
      '/api/admin/qualification-lifecycle/members/1?as_of=2026-08-28',
    );
    expect(afterRevocation.status).toBe(200);
    const revokedHistory = (await afterRevocation.json()) as {
      specialties: unknown[];
      events: unknown[];
    };
    expect(revokedHistory.specialties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ specialtyCode: 'TECHNICAL_RESCUE', status: 'revoked' }),
      ]),
    );
    expect(revokedHistory.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'SPECIALTY_REVOKED' })]),
    );
    expect(
      (
        await h.db.run(
          "SELECT kind, specialty_terminal_status FROM member_qualification_events WHERE idempotency_key = 'specialty-revoke-001'",
        )
      ).results,
    ).toEqual([{ kind: 'SPECIALTY_QUALIFIED', specialty_terminal_status: 'REVOKED' }]);

    expect(
      (
        await postEvent(h, 'specialty-regain-001', {
          ...qualified,
          effective_on: '2026-09-01',
          reason: 'Synthetic technical rescue requalification reviewed.',
        })
      ).status,
    ).toBe(201);
    const removed = await postEvent(h, 'specialty-remove-001', {
      kind: 'SPECIALTY_REMOVED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-09-10',
      evidence_source: 'synthetic-specialty-board',
      evidence_reference: 'SYNTH-TR-REMOVE-001',
      reason: 'Synthetic specialty roster removal reviewed.',
    });
    expect(removed.status).toBe(201);
    const afterRemoval = await request(
      h,
      '/api/admin/qualification-lifecycle/members/1?as_of=2026-09-10',
    );
    expect(afterRemoval.status).toBe(200);
    expect(await afterRemoval.json()).toMatchObject({
      specialties: [
        expect.objectContaining({ specialtyCode: 'TECHNICAL_RESCUE', status: 'removed' }),
      ],
    });

    expect(
      (
        await postEvent(h, 'specialty-requalify-expiry-001', {
          ...qualified,
          effective_on: '2026-10-01',
          reason: 'Synthetic technical rescue requalification before expiry reviewed.',
        })
      ).status,
    ).toBe(201);
    const expired = await postEvent(h, 'specialty-expire-001', {
      kind: 'SPECIALTY_EXPIRED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-10-15',
      expires_on: '2026-10-15',
      evidence_source: 'synthetic-specialty-board',
      evidence_reference: 'SYNTH-TR-EXP-001',
      reason: 'Synthetic technical rescue expiration reviewed.',
    });
    expect(expired.status).toBe(201);
    expect(await expired.json()).toMatchObject({
      event: { kind: 'SPECIALTY_EXPIRED', specialtyCode: 'TECHNICAL_RESCUE' },
    });
    const afterExpiry = await request(
      h,
      '/api/admin/qualification-lifecycle/members/1?as_of=2026-10-15',
    );
    expect(afterExpiry.status).toBe(200);
    expect(await afterExpiry.json()).toMatchObject({
      specialties: [
        expect.objectContaining({ specialtyCode: 'TECHNICAL_RESCUE', status: 'expired' }),
      ],
    });

    const invalidTarget = await postEvent(h, 'specialty-terminal-invalid-target-001', {
      kind: 'SPECIALTY_EXPIRED',
      member_id: 1,
      credential_id: 10,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-09-15',
      expires_on: '2026-09-15',
      evidence_source: 'synthetic-specialty-board',
      reason: 'Specialty terminal events never accept credential identifiers.',
    });
    expect(invalidTarget.status).toBe(400);

    const specialtyAudit = await h.db.run(
      "SELECT target_kind, target_id FROM audit_log WHERE action = 'qualification_lifecycle' AND target_kind = 'specialty' ORDER BY created_at, id",
    );
    expect(specialtyAudit.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target_kind: 'specialty', target_id: '1:TECHNICAL_RESCUE' }),
      ]),
    );
  });

  it('fails closed when a constraint-bypassed specialty terminal discriminator is corrupt', async () => {
    h.sqlite.pragma('ignore_check_constraints = ON');
    try {
      h.sqlite
        .prepare(
          `INSERT INTO member_qualification_events
             (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
              effective_on, expires_on, evidence_source, evidence_reference, reason,
              actor_subject, idempotency_key, before_state, after_state, created_at)
           VALUES (?, ?, NULL, ?, ?, 'SPECIALTY_QUALIFIED', ?, NULL, ?, NULL, ?, ?, ?, '{}', '{}', ?)`,
        )
        .run(
          'corrupt-specialty-terminal-001',
          1,
          'TECHNICAL_RESCUE',
          'BROKEN',
          '2026-08-01',
          'synthetic-corruption-fixture',
          'Synthetic corruption fixture only.',
          '0',
          'corrupt-specialty-terminal-key-001',
          NOW,
        );
    } finally {
      h.sqlite.pragma('ignore_check_constraints = OFF');
    }

    const history = await request(
      h,
      '/api/admin/qualification-lifecycle/members/1?as_of=2026-08-28',
    );
    expect(history.status).toBe(409);
    await expect(history.json()).resolves.toEqual({
      error: 'qualification_lifecycle_data_invalid',
    });

    const corruptReceiptReplay = await postEvent(h, 'corrupt-specialty-terminal-key-001', {
      kind: 'SPECIALTY_QUALIFIED',
      member_id: 1,
      specialty_code: 'TECHNICAL_RESCUE',
      effective_on: '2026-08-01',
      evidence_source: 'synthetic-corruption-fixture',
      reason: 'Synthetic corruption fixture only.',
    });
    expect(corruptReceiptReplay.status).toBe(409);
    await expect(corruptReceiptReplay.json()).resolves.toEqual({
      error: 'qualification_lifecycle_data_invalid',
    });

    const newEvent = await postEvent(h, 'corrupt-specialty-terminal-new-key-001', {
      kind: 'SPECIALTY_QUALIFIED',
      member_id: 1,
      specialty_code: 'SYNTHETIC_TEST_SPECIALTY',
      effective_on: '2026-08-28',
      evidence_source: 'synthetic-state-registry',
      reason: 'Do not project around corrupt lifecycle evidence.',
    });
    expect(newEvent.status).toBe(409);
    await expect(newEvent.json()).resolves.toEqual({
      error: 'qualification_lifecycle_data_invalid',
    });
  });

  it('stages, reviews, and explicitly applies a resolved qualification row through the canonical ledger', async () => {
    const auth = {
      Authorization: `Bearer ${await adminJwt()}`,
      'Content-Type': 'application/json',
    };
    const batch = await request(h, '/api/admin/qualification-lifecycle/reviews/batches', {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': 'review-batch-apply-001' },
      body: JSON.stringify({
        source_system: 'synthetic-registry',
        source_reference: 'SYNTHETIC-IMPORT-001',
      }),
    });
    expect(batch.status).toBe(201);
    const { batchId } = (await batch.json()) as { batchId: string };

    const staged = await request(
      h,
      `/api/admin/qualification-lifecycle/reviews/batches/${batchId}/rows`,
      {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'review-row-apply-001' },
        body: JSON.stringify({
          source_member_reference: 'synthetic-qualification-001',
          source_credential_reference: 'Synthetic EMT',
          source_status: 'active',
          effective_on: '2026-08-01',
          expires_on: '2027-08-01',
          provenance: 'synthetic-registry/SYNTHETIC-IMPORT-001/row-1',
        }),
      },
    );
    expect(staged.status).toBe(201);
    const { rowId } = (await staged.json()) as { rowId: string };

    const decision = await request(
      h,
      `/api/admin/qualification-lifecycle/reviews/rows/${rowId}/decision`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ decision: 'accepted', note: 'Synthetic operator review.' }),
      },
    );
    expect(decision.status).toBe(200);

    const applied = await request(
      h,
      `/api/admin/qualification-lifecycle/reviews/rows/${rowId}/apply`,
      {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'review-apply-001' },
        body: JSON.stringify({ reason: 'Synthetic reviewed qualification evidence applied.' }),
      },
    );
    expect(applied.status).toBe(201);
    await expect(applied.json()).resolves.toMatchObject({
      replayed: false,
      rowId,
      annualEligibility: 'PENDING_CONFIGURATION',
    });

    const replay = await request(
      h,
      `/api/admin/qualification-lifecycle/reviews/rows/${rowId}/apply`,
      {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'review-apply-001' },
        body: JSON.stringify({ reason: 'Synthetic reviewed qualification evidence applied.' }),
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true, rowId });

    const detail = await request(
      h,
      `/api/admin/qualification-lifecycle/reviews/batches/${batchId}`,
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      annualEligibility: 'PENDING_CONFIGURATION',
      rows: [
        expect.objectContaining({
          id: rowId,
          decision: 'accepted',
          appliedEventId: expect.any(String),
        }),
      ],
    });
    expect(
      await h.db.run('SELECT count(*) AS count FROM member_qualification_events'),
    ).toMatchObject({ results: [{ count: 1 }] });
  });
});
