import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 't'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);

async function jwt(role: 'admin' | 'member'): Promise<string> {
  return signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role,
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

interface ImportSummary {
  id: string;
  sourceSystem: string;
  sourceVersion: string;
  status: string;
  inputRowCount: number;
  reconciliationRevision: number;
  reconciliation: {
    sourceRows: number;
    pendingSourceRows: number;
    hardBlockerSourceRows: number;
    missingObservationFindings: number;
    pendingMissingObservationFindings: number;
  };
}

describe('admin TeleStaff read-only history', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();

    await h.db.run(
      `INSERT INTO assignment_imports
         (id, source_system, source_version, source_hash, input_row_count, status, created_at)
       VALUES
         ('import-synthetic-v1', 'telestaff', 'synthetic-contract-v1', '${'a'.repeat(64)}', 2, 'staged', ${NOW});

       INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          normalized_source_topology, source_a_r_day, disposition,
          reconciliation_classification, review_status, resolution_action,
          reviewed_at, reviewed_by_member_id, resolution_reason, created_at)
       VALUES
         ('row-reviewed', 'import-synthetic-v1', 7, '${'b'.repeat(64)}', '${'d'.repeat(64)}',
          'synthetic-topology-reviewed', 'G1', 'moved',
          'MOVED', 'approved', 'APPLY_OBSERVATION',
          ${NOW}, 0, 'synthetic review', ${NOW}),
         ('row-hard-blocked', 'import-synthetic-v1', 8, '${'c'.repeat(64)}', '${'e'.repeat(64)}',
          'synthetic-topology-blocked', 'G2', 'unknown_employee',
          'UNKNOWN_EMPLOYEE', 'rejected', 'REJECT_SOURCE_ROW',
          ${NOW}, 0, 'synthetic rejection', ${NOW});

       INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES
         ('slot-synthetic', 'SYNTHETIC/SLOT', '2026-01-01', 'approved', ${NOW}, ${NOW});

       INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status,
          effective_from, effective_to, created_at, updated_at)
       VALUES
         ('assignment-synthetic', 77, 'slot-synthetic', 'ADMIN_TRANSFER', 'synthetic-baseline', 'active',
          '2026-01-01', NULL, ${NOW}, ${NOW});

       INSERT INTO assignment_import_missing_observations
         (id, import_id, member_assignment_id, classification, review_status, created_at)
       VALUES
         ('missing-synthetic', 'import-synthetic-v1', 'assignment-synthetic', 'MISSING_OBSERVATION', 'pending', ${NOW});`,
    );
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('requires an administrator credential', async () => {
    const missingAuth = await app.fetch(new Request('http://x/api/admin/telestaff/imports'), {
      ...h.env,
      JWT_SIGNING_KEY: KEY,
    });
    expect(missingAuth.status).toBe(401);

    const member = await app.fetch(
      new Request('http://x/api/admin/telestaff/imports', {
        headers: { Authorization: `Bearer ${await jwt('member')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(member.status).toBe(403);
  });

  it('lists import history with explicit parse/apply blockers and no raw personnel identifiers', async () => {
    const response = await app.fetch(
      new Request('http://x/api/admin/telestaff/imports', {
        headers: { Authorization: `Bearer ${await jwt('admin')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      imports: ImportSummary[];
      readiness: {
        readOnly: boolean;
        parse: { ready: boolean; blocker: string };
        apply: { ready: boolean; blocker: string };
        externalSourceAccess: boolean;
        auditWrites: boolean;
      };
    };

    expect(body.readiness).toEqual({
      readOnly: true,
      parse: {
        ready: false,
        blocker: 'APPROVED_SANITIZED_SOURCE_CONTRACT_REQUIRED',
        reason: 'Parsing remains unavailable until an approved sanitized source contract exists.',
      },
      apply: {
        ready: false,
        blocker: 'AUTHORITATIVE_STAFFING_BASELINE_REQUIRED',
        reason:
          'Applying reconciliation remains unavailable until an authoritative staffing baseline exists.',
      },
      externalSourceAccess: false,
      auditWrites: false,
    });
    expect(body.imports).toEqual([
      expect.objectContaining({
        id: 'import-synthetic-v1',
        sourceSystem: 'telestaff',
        sourceVersion: 'synthetic-contract-v1',
        status: 'staged',
        inputRowCount: 2,
        reconciliation: {
          sourceRows: 2,
          pendingSourceRows: 0,
          hardBlockerSourceRows: 1,
          missingObservationFindings: 1,
          pendingMissingObservationFindings: 1,
        },
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain('hmac');
    expect(JSON.stringify(body)).not.toContain('synthetic review');
  });

  it('returns a sanitized import detail and never changes source or reconciliation records', async () => {
    const before = await h.db.run(
      `SELECT id, reconciliation_revision, status
       FROM assignment_imports
       ORDER BY id`,
    );

    const response = await app.fetch(
      new Request('http://x/api/admin/telestaff/imports/import-synthetic-v1?limit=25&offset=0', {
        headers: { Authorization: `Bearer ${await jwt('admin')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      import: ImportSummary;
      rows: Array<Record<string, unknown>>;
      missingObservationFindings: Array<Record<string, unknown>>;
      pagination: { limit: number; offset: number; totalRows: number };
    };
    expect(body.import.id).toBe('import-synthetic-v1');
    expect(body.pagination).toEqual({ limit: 25, offset: 0, totalRows: 2 });
    expect(body.rows).toEqual([
      expect.objectContaining({
        id: 'row-reviewed',
        sourceRowNumber: 7,
        sourceARDay: 'G1',
        disposition: 'moved',
        reconciliationClassification: 'MOVED',
        reviewStatus: 'approved',
        resolutionAction: 'APPLY_OBSERVATION',
        hasResolvedMember: false,
        hasStaffingPositionSourceMapping: false,
      }),
      expect.objectContaining({
        id: 'row-hard-blocked',
        reconciliationClassification: 'UNKNOWN_EMPLOYEE',
        resolutionAction: 'REJECT_SOURCE_ROW',
      }),
    ]);
    expect(body.rows[0]).not.toHaveProperty('memberReferenceHmac');
    expect(body.rows[0]).not.toHaveProperty('resolvedMemberId');
    expect(body.rows[0]).not.toHaveProperty('reviewedByMemberId');
    expect(body.rows[0]).not.toHaveProperty('resolutionReason');
    expect(body.missingObservationFindings).toEqual([
      {
        id: 'missing-synthetic',
        classification: 'MISSING_OBSERVATION',
        reviewStatus: 'pending',
        resolutionAction: null,
        reviewedAt: null,
        hasAssignmentContext: true,
      },
    ]);
    expect(body.missingObservationFindings[0]).not.toHaveProperty('memberAssignmentId');
    expect(body.missingObservationFindings[0]).not.toHaveProperty('reviewedByMemberId');
    expect(body.missingObservationFindings[0]).not.toHaveProperty('resolutionReason');

    const after = await h.db.run(
      `SELECT id, reconciliation_revision, status
       FROM assignment_imports
       ORDER BY id`,
    );
    expect(after.results).toEqual(before.results);
  });

  it('rejects invalid pagination and reports a missing import without exposing an alternate write path', async () => {
    const invalid = await app.fetch(
      new Request('http://x/api/admin/telestaff/imports/import-synthetic-v1?limit=0', {
        headers: { Authorization: `Bearer ${await jwt('admin')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: 'invalid_limit' });

    const missing = await app.fetch(
      new Request('http://x/api/admin/telestaff/imports/does-not-exist', {
        headers: { Authorization: `Bearer ${await jwt('admin')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: 'not_found' });

    const post = await app.fetch(
      new Request('http://x/api/admin/telestaff/imports', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await jwt('admin')}` },
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
    expect(post.status).toBe(404);
  });
});
