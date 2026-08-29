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
});
