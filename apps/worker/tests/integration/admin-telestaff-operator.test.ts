import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { teleStaffApplyGuards } from '../../src/routes/admin/telestaff.js';
import { seedAuthoritativeBaseline } from './helpers/authoritative-staffing-baseline.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 't'.repeat(64);
const HMAC_KEY = 'h'.repeat(64);
const NOW = Date.UTC(2026, 7, 28, 12, 0, 0);
const SOURCE_SNAPSHOT = '2026-08-28';
const TOPOLOGY = JSON.stringify({
  v: 1,
  shift: 'A Shift',
  division: 'Suppression/Rescue',
  station: '1',
  unit: 'Engine 1',
  position: 'Firefighter',
});

function sourceHtml(employeeId = 'SYNTH-000001'): string {
  return `<!doctype html>
    <html><body><table>
      <thead><tr>
        <th>Name</th><th>Emp ID</th><th>Shift</th><th>Division</th>
        <th>Station</th><th>Unit</th><th>Position</th><th>A/R Day</th>
      </tr></thead>
      <tbody><tr>
        <td>Safe Synthetic</td><td>${employeeId}</td><td>A Shift</td>
        <td>Suppression/Rescue</td><td>1</td><td>Engine 1</td>
        <td>Firefighter</td><td>G1</td>
      </tr></tbody>
    </table></body></html>`;
}

function repeatedTopologyHtml(): string {
  return `<!doctype html>
    <html><body><table>
      <thead><tr>
        <th>Name</th><th>Emp ID</th><th>Shift</th><th>Division</th>
        <th>Station</th><th>Unit</th><th>Position</th><th>A/R Day</th>
      </tr></thead>
      <tbody>
        <tr><td>Safe Synthetic One</td><td>SYNTH-000001</td><td>A Shift</td>
          <td>Suppression/Rescue</td><td>1</td><td>Engine 1</td><td>Firefighter</td><td>G1</td></tr>
        <tr><td>Safe Synthetic Two</td><td>SYNTH-000002</td><td>A Shift</td>
          <td>Suppression/Rescue</td><td>1</td><td>Engine 1</td><td>Firefighter</td><td>G2</td></tr>
      </tbody>
    </table></body></html>`;
}

async function jwt(options: { fresh?: boolean; role?: 'admin' | 'member' } = {}): Promise<string> {
  const role = options.role ?? 'admin';
  return signJwt(
    {
      sub: role === 'admin' ? 1 : 2,
      emp: role === 'admin' ? 'operator' : 'member',
      role,
      rank: role === 'admin' ? 'CHIEF' : 'FF',
      first_name: 'Synthetic',
      last_name: role,
      fresh_auth_at: options.fresh === false ? 0 : Math.floor(Date.now() / 1000),
    },
    KEY,
  );
}

function importForm(
  options: {
    sourceKind?: 'official' | 'synthetic_test';
    omitSourceKind?: boolean;
    sourceSnapshotAsOf?: string;
    employeeId?: string;
    sourceObservedAt?: string;
    sourceObservationTimeBasis?: 'date_only' | 'source_metadata' | 'administrator_confirmed';
  } = {},
): FormData {
  const form = new FormData();
  form.set(
    'file',
    new File([sourceHtml(options.employeeId)], 'telestaff-assignments.html', { type: 'text/html' }),
  );
  form.set('source_snapshot_as_of', options.sourceSnapshotAsOf ?? SOURCE_SNAPSHOT);
  if (!options.omitSourceKind) form.set('source_kind', options.sourceKind ?? 'official');
  if (options.sourceObservedAt !== undefined)
    form.set('source_observed_at', options.sourceObservedAt);
  if (options.sourceObservationTimeBasis !== undefined) {
    form.set('source_observation_time_basis', options.sourceObservationTimeBasis);
  }
  return form;
}

function repeatedTopologyForm(): FormData {
  const form = new FormData();
  form.set(
    'file',
    new File([repeatedTopologyHtml()], 'telestaff-repeated-topology.html', { type: 'text/html' }),
  );
  form.set('source_snapshot_as_of', SOURCE_SNAPSHOT);
  form.set('source_kind', 'official');
  return form;
}

async function request(
  h: TestD1,
  path: string,
  init: RequestInit = {},
  options: { withHmacKey?: boolean; db?: D1Database } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${await jwt()}`);
  const env =
    options.withHmacKey === false
      ? { ...h.env, JWT_SIGNING_KEY: KEY }
      : {
          ...h.env,
          JWT_SIGNING_KEY: KEY,
          TELESTAFF_HMAC_KEY: HMAC_KEY,
        };
  if (options.db !== undefined) env.DB = options.db;
  return app.fetch(new Request(`http://x/api/admin/telestaff${path}`, { ...init, headers }), env);
}

async function seedOperatorAndMappedSlot(h: TestD1): Promise<void> {
  await h.db.run(
    `INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, created_at, updated_at)
     VALUES (1, 'SYNTH-000001', 'Synthetic', 'Operator', 'FF', 'FF', 1, 0, ${NOW}, ${NOW});

     INSERT INTO staffing_positions
       (id, stable_slot_key, division, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
     VALUES
       ('slot-a', 'SYNTHETIC/A/ENGINE-1/FF', 'Suppression/Rescue', 'A Shift', '1', 'Engine 1',
        'Firefighter', 'FF', '2026-01-01', 'approved', ${NOW}, ${NOW});

     INSERT INTO staffing_position_source_mappings
       (id, staffing_position_id, source_system, source_locator, source_signature, source_version,
        source_hash, effective_from, created_at)
     VALUES
       ('mapping-a', 'slot-a', 'telestaff', '${TOPOLOGY.replace(/'/g, "''")}', '${'a'.repeat(64)}',
        'TELSTAFF_ASSIGNMENTS_HTML_V1', '${'b'.repeat(64)}', '2026-01-01', ${NOW});`,
  );
}

describe('admin TeleStaff operator workflow', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('keeps every transactional apply guard below D1 statement limits for 211 rows', () => {
    const rows = Array.from({ length: 211 }, (_, index) => ({
      id: `source-row-${index}`,
      row_fingerprint: `fingerprint-${index}`,
      source_a_r_day: 'G1',
      normalized_source_topology: `topology-${index}`,
      source_topology_completeness: 'complete',
      reconciliation_classification: 'NEW_ASSIGNMENT',
      review_status: 'approved',
      resolution_action: 'APPLY_OBSERVATION',
      resolved_member_id: index + 1,
      staffing_position_source_mapping_id: `mapping-${index}`,
      staffing_position_id: `position-${index}`,
      member_employment_status: 'unknown',
      member_rank: 'FF',
      mapping_is_approved_for_snapshot: 1,
    }));
    const guards = teleStaffApplyGuards({
      importRecord: {
        id: 'import-211',
        source_system: 'telestaff',
        source_snapshot_as_of: '2026-08-24',
        source_observed_at: null,
        source_observation_time_basis: 'date_only',
      },
      rows,
      materializedRows: rows,
      endAssignments: [],
      canonicalEffectiveOn: '2026-08-24',
      expectedRevision: 786,
    } as never);

    expect(guards.length).toBeGreaterThan(211);
    expect(Math.max(...guards.map((guard) => guard.sql.length))).toBeLessThan(100_000);
  });

  it('parses a preview only in memory and returns no raw personnel evidence', async () => {
    const response = await request(h, '/imports/preview', {
      method: 'POST',
      body: importForm(),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { preview: Record<string, unknown> };
    expect(body.preview).toMatchObject({
      sourceKind: 'official',
      sourceSnapshotAsOf: SOURCE_SNAPSHOT,
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
      inputRowCount: 1,
      workflowState: 'PREVIEW_REQUIRES_STAGE',
    });
    expect(JSON.stringify(body)).not.toContain('SYNTH-000001');
    expect(JSON.stringify(body)).not.toContain('Safe Synthetic');
    expect(
      (await h.db.run('SELECT COUNT(*) AS import_count FROM assignment_imports')).results,
    ).toEqual([{ import_count: 0 }]);
  });

  it('lets a stepped-up Hub administrator designate one complete official import as the annual baseline', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'remote-acceptance-import',
      rows: [{ sourceRowNumber: 1, normalizedTopology: 'synthetic/one' }],
      accept: false,
    });
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, created_at, updated_at)
       VALUES (1, 'operator', 'Synthetic', 'Operator', 'CHIEF', 'OFC', 1, 0, ${NOW}, ${NOW})`,
    );

    const response = await request(h, '/imports/remote-acceptance-import/baseline-acceptance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'remote-acceptance-import-2027',
      },
      body: JSON.stringify({
        bid_year: 2027,
        reason: 'Complete official source reviewed for the staging annual baseline.',
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      importId: 'remote-acceptance-import',
      idempotent: false,
      baseline: { status: 'PASS' },
    });

    const replay = await request(h, '/imports/remote-acceptance-import/baseline-acceptance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'remote-acceptance-import-2027',
      },
      body: JSON.stringify({
        bid_year: 2027,
        reason: 'Complete official source reviewed for the staging annual baseline.',
      }),
    });
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toMatchObject({
      importId: 'remote-acceptance-import',
      idempotent: true,
    });
  });

  it('fails closed without a declared source kind and retains an explicit declaration with time provenance', async () => {
    const omitted = await request(h, '/imports/preview', {
      method: 'POST',
      body: importForm({ omitSourceKind: true }),
    });
    expect(omitted.status).toBe(400);
    await expect(omitted.json()).resolves.toEqual({ error: 'invalid_source_kind' });
    expect(
      (await h.db.run('SELECT COUNT(*) AS import_count FROM assignment_imports')).results,
    ).toEqual([{ import_count: 0 }]);

    const sourceObservedAt = '2026-08-28T14:05:06.789Z';
    const staged = await request(h, '/imports', {
      method: 'POST',
      body: importForm({
        sourceKind: 'official',
        sourceObservedAt,
        sourceObservationTimeBasis: 'source_metadata',
      }),
    });
    expect(staged.status).toBe(201);
    const body = (await staged.json()) as { import: { id: string; sourceKind: string } };
    expect(body.import.sourceKind).toBe('official');

    expect(
      (
        await h.db.run(
          `SELECT source_kind, source_observed_at, source_observation_time_basis, created_at
             FROM assignment_imports WHERE id = ?`,
          [body.import.id],
        )
      ).results,
    ).toEqual([
      {
        source_kind: 'official',
        source_observed_at: Date.parse(sourceObservedAt),
        source_observation_time_basis: 'source_metadata',
        created_at: expect.any(Number),
      },
    ]);
  });

  it('requires an injected TeleStaff HMAC key and an explicit valid snapshot before staging', async () => {
    const unavailable = await request(
      h,
      '/imports',
      { method: 'POST', body: importForm() },
      { withHmacKey: false },
    );
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: 'telestaff_configuration_unavailable',
    });

    const invalidSnapshot = await request(h, '/imports', {
      method: 'POST',
      body: importForm({ sourceSnapshotAsOf: '2026-02-30' }),
    });
    expect(invalidSnapshot.status).toBe(400);
    await expect(invalidSnapshot.json()).resolves.toEqual({
      error: 'invalid_source_snapshot_as_of',
    });
    expect(
      (await h.db.run('SELECT COUNT(*) AS import_count FROM assignment_imports')).results,
    ).toEqual([{ import_count: 0 }]);

    const invalidSourceTime = await request(h, '/imports', {
      method: 'POST',
      body: importForm({
        sourceObservedAt: '2026-08-28T14:05:06Z',
        sourceObservationTimeBasis: 'date_only',
      }),
    });
    expect(invalidSourceTime.status).toBe(400);
    await expect(invalidSourceTime.json()).resolves.toEqual({
      error: 'invalid_source_observation_time',
    });
  });

  it('requires a fresh administrator step-up before persisting a staged source', async () => {
    const stale = await request(h, '/imports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await jwt({ fresh: false })}` },
      body: importForm(),
    });
    expect(stale.status).toBe(401);
    await expect(stale.json()).resolves.toMatchObject({ error: 'step_up_required' });

    const member = await request(h, '/imports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await jwt({ role: 'member' })}` },
      body: importForm(),
    });
    expect(member.status).toBe(403);
  });

  it('onboards a reviewed unknown employee through the personnel ledger and then re-reconciles', async () => {
    await seedOperatorAndMappedSlot(h);
    const employeeId = 'SYNTH-009999';
    const stage = await request(h, '/imports', {
      method: 'POST',
      body: importForm({ employeeId }),
    });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
      unknownEmployees: Array<{
        rowId: string;
        sourceRowNumber: number;
        sourceEmployeeId: string;
        sourceDisplayName: string;
      }>;
    };
    expect(staged.unknownEmployees).toEqual([
      {
        rowId: expect.any(String),
        sourceRowNumber: 1,
        sourceEmployeeId: employeeId,
        sourceDisplayName: 'Safe Synthetic',
      },
    ]);

    const retainedBefore = await h.db.run(
      `SELECT member_reference_hmac, normalized_source_topology
         FROM assignment_import_rows WHERE import_id = ?`,
      [staged.import.id],
    );
    expect(JSON.stringify(retainedBefore.results)).not.toContain(employeeId);
    expect(JSON.stringify(retainedBefore.results)).not.toContain('Safe Synthetic');

    const hire = await app.fetch(
      new Request('http://x/api/admin/personnel/changes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await jwt()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `telestaff-onboard:${staged.import.id}:1`,
        },
        body: JSON.stringify({
          kind: 'NEW_HIRE',
          new_member: {
            employee_id: employeeId,
            first_name: 'Reviewed',
            last_name: 'Firefighter',
            rank: 'FF',
            bid_category: 'FF',
            rsc_seniority: 999,
            hired_at: SOURCE_SNAPSHOT,
          },
          effective_on: SOURCE_SNAPSHOT,
          reason: 'Reviewed TeleStaff unknown employee onboarding.',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY, TELESTAFF_HMAC_KEY: HMAC_KEY },
    );
    expect(hire.status).toBe(201);

    const reconciled = await request(h, `/imports/${staged.import.id}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: staged.import.reconciliationRevision,
      }),
    });
    expect(reconciled.status).toBe(200);
    await expect(reconciled.json()).resolves.toMatchObject({
      import: { id: staged.import.id, status: 'reviewed' },
      reconciliation: { NEW_ASSIGNMENT: 1, UNKNOWN_EMPLOYEE: 0 },
    });
    expect(
      (
        await h.db.run(
          `SELECT kind, origin, idempotency_key FROM personnel_lifecycle_events
             WHERE kind = 'NEW_HIRE'`,
        )
      ).results,
    ).toEqual([
      {
        kind: 'NEW_HIRE',
        origin: 'ADMIN',
        idempotency_key: `telestaff-onboard:${staged.import.id}:1`,
      },
    ]);

    const detail = await request(h, `/imports/${staged.import.id}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.text();
    expect(detailBody).toContain('NEW_ASSIGNMENT');
    expect(detailBody).not.toContain(employeeId);
    expect(detailBody).not.toContain('Safe Synthetic');
  });

  it('requires administrator role and fresh step-up for reviewed re-reconciliation', async () => {
    const importId = '01M1C1Q6RBEN5N2MCE9YMPHDEE';
    const member = await request(h, `/imports/${importId}/reconcile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await jwt({ role: 'member' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expected_reconciliation_revision: 0 }),
    });
    expect(member.status).toBe(403);

    const stale = await request(h, `/imports/${importId}/reconcile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await jwt({ fresh: false })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expected_reconciliation_revision: 0 }),
    });
    expect(stale.status).toBe(401);
    await expect(stale.json()).resolves.toMatchObject({ error: 'step_up_required' });
  });

  it('denies a normal member from invoking deterministic staffing certification', async () => {
    const response = await request(
      h,
      '/imports/01M1C1Q6RBEN5N2MCE9YMPHDEE/certify-deterministic-staffing',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await jwt({ role: 'member' })}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expected_reconciliation_revision: 0,
          reason: 'A normal member must not certify canonical staffing.',
        }),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('stages, reconciles, reviews, and applies only a resolved official observation', async () => {
    await seedOperatorAndMappedSlot(h);

    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; status: string; reconciliationRevision: number };
    };
    expect(staged.import.status).toBe('reviewed');

    const detailResponse = await request(h, `/imports/${staged.import.id}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{
        id: string;
        reconciliationClassification: string;
        reviewStatus: string;
        hasResolvedMember: boolean;
        hasStaffingPositionSourceMapping: boolean;
      }>;
    };
    expect(detail.rows).toEqual([
      expect.objectContaining({
        reconciliationClassification: 'NEW_ASSIGNMENT',
        reviewStatus: 'pending',
        hasResolvedMember: true,
        hasStaffingPositionSourceMapping: true,
      }),
    ]);
    expect(JSON.stringify(detail)).not.toContain('SYNTH-000001');

    const sourceRow = detail.rows[0];
    expect(sourceRow).toBeDefined();
    if (sourceRow === undefined) return;
    const review = await request(h, `/imports/${staged.import.id}/rows/${sourceRow.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as {
      import: { reconciliationRevision: number };
      row: { reviewStatus: string; resolutionAction: string };
    };
    expect(reviewed.row).toEqual({
      reviewStatus: 'approved',
      resolutionAction: 'APPLY_OBSERVATION',
    });

    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: reviewed.import.reconciliationRevision,
        canonical_effective_on: SOURCE_SNAPSHOT,
      }),
    });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({
      import: { id: staged.import.id, status: 'committed' },
      canonicalMutation: { createdObservations: 1, createdAssignments: 1, endedAssignments: 0 },
    });
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM assignment_observations) AS observations,
             (SELECT COUNT(*) FROM member_assignments WHERE origin_type = 'TELESTAFF_IMPORT')
               AS assignments,
             (SELECT COUNT(*) FROM portal_writeback_queue) AS portal_work`,
        )
      ).results,
    ).toEqual([{ observations: 1, assignments: 1, portal_work: 0 }]);
    expect(
      (await h.db.run('SELECT source_observed_at FROM assignment_observations')).results,
    ).toEqual([{ source_observed_at: null }]);

    const lifecycle = await h.db.run(
      `SELECT kind, effective_on, employment_status_before, employment_status_after,
              rank_before, rank_after, reason, origin, actor_subject, idempotency_key,
              before_state, after_state
         FROM personnel_lifecycle_events`,
    );
    expect(lifecycle.results).toHaveLength(1);
    const lifecycleRow = lifecycle.results[0];
    expect(lifecycleRow).toMatchObject({
      kind: 'ADMIN_REASSIGNMENT',
      effective_on: SOURCE_SNAPSHOT,
      employment_status_before: 'unknown',
      employment_status_after: 'unknown',
      rank_before: 'FF',
      rank_after: 'FF',
      origin: 'TELESTAFF',
      actor_subject: 'admin:1',
    });
    expect(lifecycleRow?.reason).toContain('TeleStaff');
    expect(lifecycleRow?.idempotency_key).toBe(`telestaff:apply:${sourceRow.id}`);
    expect(JSON.parse(String(lifecycleRow?.before_state))).toMatchObject({
      memberId: 1,
      assignment: null,
    });
    expect(JSON.parse(String(lifecycleRow?.after_state))).toMatchObject({
      memberId: 1,
      assignment: expect.objectContaining({ staffingPositionId: 'slot-a' }),
    });
    await expect(
      h.db.run("UPDATE personnel_lifecycle_events SET reason = 'tamper'"),
    ).rejects.toThrow('immutable');

    const audit = await h.db.run(
      `SELECT actor_type, actor_id, action, target_kind, target_id, before_state, after_state,
              reason, client_meta
         FROM audit_log`,
    );
    expect(audit.results).toHaveLength(1);
    const auditRow = audit.results[0];
    expect(auditRow).toMatchObject({
      actor_type: 'admin',
      actor_id: 1,
      action: 'telestaff_apply',
      target_kind: 'assignment_import',
      target_id: staged.import.id,
    });
    expect(auditRow?.reason).toContain('TeleStaff');
    expect(JSON.parse(String(auditRow?.before_state))).toMatchObject({
      importId: staged.import.id,
      reconciliationRevision: reviewed.import.reconciliationRevision,
    });
    expect(JSON.parse(String(auditRow?.after_state))).toMatchObject({
      importId: staged.import.id,
      createdAssignments: [expect.any(String)],
    });
  });

  it('rolls an exact newer TeleStaff assignment into a later official import without a false conflict', async () => {
    await seedOperatorAndMappedSlot(h);

    const firstStage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(firstStage.status).toBe(201);
    const firstStaged = (await firstStage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const firstDetail = (await (await request(h, `/imports/${firstStaged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string }>;
    };
    const firstRow = firstDetail.rows[0];
    expect(firstRow).toBeDefined();
    if (firstRow === undefined) return;
    const firstReview = await request(
      h,
      `/imports/${firstStaged.import.id}/rows/${firstRow.id}/review`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: firstDetail.import.reconciliationRevision,
          decision: 'accept_observation',
        }),
      },
    );
    expect(firstReview.status).toBe(200);
    const firstReviewed = (await firstReview.json()) as {
      import: { reconciliationRevision: number };
    };
    const firstApply = await request(h, `/imports/${firstStaged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: firstReviewed.import.reconciliationRevision,
        canonical_effective_on: '2026-09-03',
      }),
    });
    expect(firstApply.status).toBe(200);

    const secondStage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(secondStage.status).toBe(201);
    const secondStaged = (await secondStage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const secondDetail = (await (
      await request(h, `/imports/${secondStaged.import.id}`)
    ).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{
        id: string;
        reconciliationClassification: string;
        reviewStatus: string;
      }>;
    };
    expect(secondDetail.rows).toEqual([
      expect.objectContaining({
        reconciliationClassification: 'NEW_ASSIGNMENT',
        reviewStatus: 'pending',
      }),
    ]);
    const secondRow = secondDetail.rows[0];
    expect(secondRow).toBeDefined();
    if (secondRow === undefined) return;
    const secondReview = await request(
      h,
      `/imports/${secondStaged.import.id}/rows/${secondRow.id}/review`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: secondDetail.import.reconciliationRevision,
          decision: 'accept_observation',
        }),
      },
    );
    expect(secondReview.status).toBe(200);
    const secondReviewed = (await secondReview.json()) as {
      import: { reconciliationRevision: number };
    };

    const secondApply = await request(h, `/imports/${secondStaged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: secondReviewed.import.reconciliationRevision,
        canonical_effective_on: '2026-09-04',
      }),
    });
    expect(secondApply.status).toBe(200);
    await expect(secondApply.json()).resolves.toMatchObject({
      import: { id: secondStaged.import.id, status: 'committed' },
      canonicalMutation: { createdObservations: 1, createdAssignments: 1, endedAssignments: 1 },
    });
    expect(
      (
        await h.db.run(
          `SELECT status, effective_from, effective_to, origin_ref
             FROM member_assignments
            ORDER BY effective_from, id`,
        )
      ).results,
    ).toEqual([
      {
        status: 'ended',
        effective_from: '2026-09-03',
        effective_to: '2026-09-03',
        origin_ref: firstStaged.import.id,
      },
      {
        status: 'active',
        effective_from: '2026-09-04',
        effective_to: null,
        origin_ref: secondStaged.import.id,
      },
    ]);
  });

  it('applies an excluded civilian observation without inventing a fire rank', async () => {
    await seedOperatorAndMappedSlot(h);
    await h.db.run(
      "UPDATE members SET rank = 'CIVILIAN', bid_category = 'EXCLUDED', rsc_seniority = 0 WHERE id = 1",
    );

    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as { import: { id: string } };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string }>;
    };
    const row = detail.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    const review = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as { import: { reconciliationRevision: number } };

    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: reviewed.import.reconciliationRevision,
        canonical_effective_on: SOURCE_SNAPSHOT,
      }),
    });
    expect(apply.status).toBe(200);
    expect(
      (
        await h.db.run(
          `SELECT rank_before, rank_after, before_state, after_state
             FROM personnel_lifecycle_events`,
        )
      ).results,
    ).toEqual([
      expect.objectContaining({
        rank_before: null,
        rank_after: null,
        before_state: expect.stringContaining('"rank":null'),
        after_state: expect.stringContaining('"rank":null'),
      }),
    ]);
  });

  it('certifies a unique complete official source topology without deriving a slot from identity', async () => {
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          employment_status, is_probationary, created_at, updated_at)
       VALUES (1, 'SYNTH-000001', 'Synthetic', 'Operator', 'FF', 'FF', 1, 'unknown', 0, ${NOW}, ${NOW})`,
    );
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };

    const certified = await request(
      h,
      `/imports/${staged.import.id}/certify-deterministic-staffing`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: staged.import.reconciliationRevision,
          reason: 'Official unique topology certification for staging rehearsal.',
        }),
      },
    );
    expect(certified.status).toBe(201);
    await expect(certified.json()).resolves.toMatchObject({
      certifiedRows: 1,
      repeatedRowCount: 0,
      certification: {
        requestedCertifications: 1,
        createdCanonicalStaffingPositions: 1,
        createdSourceMappings: 1,
        existingIdempotentMatches: 0,
        unresolvedObservations: 0,
        skippedCollisions: 0,
        failures: [],
        idempotent: false,
      },
    });
    expect(
      (
        await h.db.run(
          `SELECT position_record.review_status, mapping.source_locator, row_record.reconciliation_classification,
                row_record.review_status, row_record.resolution_action
           FROM staffing_positions position_record
           JOIN staffing_position_source_mappings mapping ON mapping.staffing_position_id = position_record.id
           JOIN assignment_import_rows row_record ON row_record.staffing_position_source_mapping_id = mapping.id`,
        )
      ).results,
    ).toEqual([
      expect.objectContaining({
        review_status: 'approved',
        source_locator: TOPOLOGY,
        reconciliation_classification: 'NEW_ASSIGNMENT',
        resolution_action: 'APPLY_OBSERVATION',
      }),
    ]);

    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
    };
    const replay = await request(h, `/imports/${staged.import.id}/certify-deterministic-staffing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        reason: 'Repeat certification must preserve the existing deterministic staffing.',
      }),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      certifiedRows: 0,
      repeatedRowCount: 0,
      certification: {
        requestedCertifications: 1,
        createdCanonicalStaffingPositions: 0,
        createdSourceMappings: 0,
        existingIdempotentMatches: 1,
        idempotent: true,
      },
    });
    expect((await h.db.run('SELECT COUNT(*) AS count FROM staffing_positions')).results).toEqual([
      { count: 1 },
    ]);
    expect(
      (await h.db.run('SELECT COUNT(*) AS count FROM staffing_position_source_mappings')).results,
    ).toEqual([{ count: 1 }]);
  });

  it('certifies excluded civilian staffing without making the member bid eligible', async () => {
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          employment_status, is_probationary, created_at, updated_at)
       VALUES (1, 'SYNTH-000001', 'Synthetic', 'Civilian', 'CIVILIAN', 'EXCLUDED', 0,
               'unknown', 0, ${NOW}, ${NOW})`,
    );
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };

    const certified = await request(
      h,
      `/imports/${staged.import.id}/certify-deterministic-staffing`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: staged.import.reconciliationRevision,
          reason: 'Official civilian topology certification for production parity.',
        }),
      },
    );

    expect(certified.status).toBe(201);
    await expect(certified.json()).resolves.toMatchObject({
      certifiedRows: 1,
      certification: { createdCanonicalStaffingPositions: 1, createdSourceMappings: 1 },
    });
    expect(
      (
        await h.db.run(
          `SELECT member.rank, member.bid_category, position.applicable_rank
             FROM members member
             JOIN assignment_import_rows source_row ON source_row.resolved_member_id = member.id
             JOIN staffing_position_source_mappings mapping
               ON mapping.id = source_row.staffing_position_source_mapping_id
             JOIN staffing_positions position ON position.id = mapping.staffing_position_id`,
        )
      ).results,
    ).toEqual([{ rank: 'CIVILIAN', bid_category: 'EXCLUDED', applicable_rank: 'CIVILIAN' }]);
  });

  it('accepts all safe deterministic observations without depending on the paged detail response', async () => {
    await seedOperatorAndMappedSlot(h);
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    await h.db.run(
      `INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          source_topology_completeness, normalized_source_topology, source_a_r_day,
          resolved_member_id, staffing_position_source_mapping_id, disposition,
          reconciliation_classification, review_status, created_at)
       SELECT '01M1MGP01FV41595YQZ0ABF4ZZ', import_id, source_row_number + 1000,
              '${'c'.repeat(64)}', NULL, source_topology_completeness,
              normalized_source_topology, source_a_r_day, resolved_member_id,
              staffing_position_source_mapping_id, disposition,
              reconciliation_classification, review_status, created_at
         FROM assignment_import_rows WHERE import_id = ? LIMIT 1`,
      [staged.import.id],
    );
    const refreshed = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
    };

    const reviewed = await request(
      h,
      `/imports/${staged.import.id}/review-deterministic-observations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: refreshed.import.reconciliationRevision,
          reason: 'Accept every safe deterministic observation in the official import.',
        }),
      },
    );
    expect(reviewed.status).toBe(200);
    const reviewedBody = (await reviewed.json()) as {
      import: { reconciliationRevision: number };
      acceptedObservations: number;
      idempotent: boolean;
    };
    expect(reviewedBody).toMatchObject({ acceptedObservations: 2, idempotent: false });
    expect(
      (
        await h.db.run(
          `SELECT review_status, resolution_action, resolution_reason
             FROM assignment_import_rows WHERE import_id = ?`,
          [staged.import.id],
        )
      ).results,
    ).toEqual([
      {
        review_status: 'approved',
        resolution_action: 'APPLY_OBSERVATION',
        resolution_reason: 'ACCEPT_TELESTAFF_OBSERVATION',
      },
      {
        review_status: 'approved',
        resolution_action: 'APPLY_OBSERVATION',
        resolution_reason: 'ACCEPT_TELESTAFF_OBSERVATION',
      },
    ]);

    const replay = await request(
      h,
      `/imports/${staged.import.id}/review-deterministic-observations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: reviewedBody.import.reconciliationRevision,
          reason: 'Confirm the deterministic review is idempotent on replay.',
        }),
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      acceptedObservations: 0,
      idempotent: true,
    });
  });

  it('certifies repeated complete topology into internal cardinality seats without deriving a policy distinction', async () => {
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          employment_status, is_probationary, created_at, updated_at)
       VALUES
         (1, 'SYNTH-000001', 'Synthetic', 'One', 'FF', 'FF', 1, 'active', 0, ${NOW}, ${NOW}),
         (2, 'SYNTH-000002', 'Synthetic', 'Two', 'FF', 'FF', 2, 'active', 0, ${NOW}, ${NOW})`,
    );
    const stagedResponse = await request(h, '/imports', {
      method: 'POST',
      body: repeatedTopologyForm(),
    });
    expect(stagedResponse.status).toBe(201);
    const staged = (await stagedResponse.json()) as {
      import: { id: string; reconciliationRevision: number };
    };

    const response = await request(
      h,
      `/imports/${staged.import.id}/certify-deterministic-staffing`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: staged.import.reconciliationRevision,
          reason: 'Two distinct source occupants require two canonical internal cardinality seats.',
        }),
      },
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      certifiedRows: 2,
      repeatedRowCount: 2,
      certification: {
        createdCanonicalStaffingPositions: 2,
        createdSourceMappings: 2,
        unresolvedObservations: 0,
      },
    });
    expect((await h.db.run('SELECT COUNT(*) AS count FROM staffing_positions')).results).toEqual([
      { count: 2 },
    ]);
    expect(
      (
        await h.db.run(
          `SELECT COUNT(*) AS count
             FROM assignment_import_rows
            WHERE import_id = ?
              AND reconciliation_classification = 'NEW_ASSIGNMENT'
              AND review_status = 'approved'
              AND staffing_position_source_mapping_id IS NOT NULL`,
          [staged.import.id],
        )
      ).results,
    ).toEqual([{ count: 2 }]);
    expect(
      (
        await h.db.run(
          `SELECT source_discriminator
             FROM staffing_position_source_mappings
            ORDER BY source_discriminator`,
        )
      ).results,
    ).toEqual([
      { source_discriminator: 'canonical-cardinality-001' },
      { source_discriminator: 'canonical-cardinality-002' },
    ]);

    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
    };
    const resolution = await request(h, `/imports/${staged.import.id}/resolve-safe-exceptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        reason:
          'No exception is needed once repeated source occupancy has canonical cardinality seats.',
      }),
    });
    expect(resolution.status).toBe(200);
    await expect(resolution.json()).resolves.toMatchObject({
      counts: {
        deferredRepeatedTopology: 0,
        retainedIncompleteTopology: 0,
        rejectedUnknownPerson: 0,
        rejectedAmbiguousMapping: 0,
      },
      idempotent: true,
    });
    expect(
      (
        await h.db.run(
          `SELECT COUNT(*) AS count FROM assignment_import_rows
            WHERE import_id = ? AND resolution_action = 'DEFER_NEW_POSITION'`,
          [staged.import.id],
        )
      ).results,
    ).toEqual([{ count: 0 }]);
  });

  it('terminally rejects an ambiguous source observation without changing canonical staffing', async () => {
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          employment_status, is_probationary, created_at, updated_at)
       VALUES
         (1, 'SYNTH-000001', 'Synthetic', 'One', 'FF', 'FF', 1, 'active', 0, ${NOW}, ${NOW});

       INSERT INTO staffing_positions
         (id, stable_slot_key, division, shift, station, unit, position_name, applicable_rank,
          active_from, review_status, created_at, updated_at)
       VALUES
         ('slot-a', 'SYNTHETIC/A/ENGINE-1/FF-1', 'Suppression/Rescue', 'A Shift', '1',
          'Engine 1', 'Firefighter', 'FF', '2026-01-01', 'approved', ${NOW}, ${NOW}),
         ('slot-b', 'SYNTHETIC/A/ENGINE-1/FF-2', 'Suppression/Rescue', 'A Shift', '1',
          'Engine 1', 'Firefighter', 'FF', '2026-01-01', 'approved', ${NOW}, ${NOW});

       INSERT INTO staffing_position_source_mappings
         (id, staffing_position_id, source_system, source_locator, source_discriminator,
          source_signature, source_version, source_hash, effective_from, created_at)
       VALUES
         ('mapping-a', 'slot-a', 'telestaff', '${TOPOLOGY.replace(/'/g, "''")}',
          'canonical-cardinality-001', '${'a'.repeat(64)}', 'TELSTAFF_ASSIGNMENTS_HTML_V1',
          '${'b'.repeat(64)}', '2026-01-01', ${NOW}),
         ('mapping-b', 'slot-b', 'telestaff', '${TOPOLOGY.replace(/'/g, "''")}',
          'canonical-cardinality-002', '${'c'.repeat(64)}', 'TELSTAFF_ASSIGNMENTS_HTML_V1',
          '${'d'.repeat(64)}', '2026-01-01', ${NOW});`,
    );
    const stagedResponse = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stagedResponse.status).toBe(201);
    const staged = (await stagedResponse.json()) as {
      import: { id: string; reconciliationRevision: number };
    };

    const resolution = await request(h, `/imports/${staged.import.id}/resolve-safe-exceptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: staged.import.reconciliationRevision,
        reason: 'Ambiguous source evidence cannot choose between canonical cardinality seats.',
      }),
    });
    expect(resolution.status).toBe(200);
    await expect(resolution.json()).resolves.toMatchObject({
      counts: {
        deferredRepeatedTopology: 0,
        retainedIncompleteTopology: 0,
        rejectedUnknownPerson: 0,
        rejectedAmbiguousMapping: 1,
      },
      idempotent: false,
    });
    expect(
      (
        await h.db.run(
          `SELECT reconciliation_classification, review_status, resolution_action
             FROM assignment_import_rows WHERE import_id = ?`,
          [staged.import.id],
        )
      ).results,
    ).toEqual([
      {
        reconciliation_classification: 'AMBIGUOUS_MAPPING',
        review_status: 'rejected',
        resolution_action: 'REJECT_SOURCE_ROW',
      },
    ]);
    expect((await h.db.run('SELECT COUNT(*) AS count FROM member_assignments')).results).toEqual([
      { count: 0 },
    ]);
  });

  it('accepts a trigger-inclusive native D1 review change count', async () => {
    await seedOperatorAndMappedSlot(h);
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as { import: { id: string } };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string }>;
    };
    const sourceRow = detail.rows[0];
    expect(sourceRow).toBeDefined();
    if (sourceRow === undefined) return;

    const originalPrepare = h.env.DB.prepare.bind(h.env.DB);
    const nativeTriggerCountingDb = Object.create(h.env.DB) as D1Database;
    nativeTriggerCountingDb.prepare = ((query: string) => {
      const statement = originalPrepare(query);
      if (
        !query.includes('UPDATE assignment_import_rows') ||
        !query.includes('SET review_status')
      ) {
        return statement;
      }
      const triggerInclusiveStatement = Object.create(statement) as D1PreparedStatement;
      triggerInclusiveStatement.bind = (...bindings: unknown[]) => {
        const bound = statement.bind(...bindings);
        const triggerInclusiveBound = Object.create(bound) as D1PreparedStatement;
        triggerInclusiveBound.run = async <T = Record<string, unknown>>() => {
          const result = await bound.run<T>();
          // Native D1 reports both the guarded source-row update and its
          // reconciliation-revision trigger in `meta.changes`.
          return { ...result, meta: { ...result.meta, changes: 2 } };
        };
        return triggerInclusiveBound;
      };
      return triggerInclusiveStatement;
    }) as D1Database['prepare'];

    const review = await request(
      h,
      `/imports/${staged.import.id}/rows/${sourceRow.id}/review`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: detail.import.reconciliationRevision,
          decision: 'accept_observation',
        }),
      },
      { db: nativeTriggerCountingDb },
    );

    expect(review.status).toBe(200);
    await expect(review.json()).resolves.toMatchObject({
      row: { reviewStatus: 'approved', resolutionAction: 'APPLY_OBSERVATION' },
      import: { reconciliationRevision: detail.import.reconciliationRevision + 1 },
    });
  });

  it('atomically rejects source-row provenance that changes after review but before materialization', async () => {
    await seedOperatorAndMappedSlot(h);
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string }>;
    };
    const sourceRow = detail.rows[0];
    expect(sourceRow).toBeDefined();
    if (sourceRow === undefined) return;
    const review = await request(h, `/imports/${staged.import.id}/rows/${sourceRow.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as { import: { reconciliationRevision: number } };

    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    let injected = false;
    const concurrentDb = Object.create(h.env.DB) as D1Database;
    concurrentDb.batch = async (statements) => {
      if (!injected) {
        injected = true;
        await h.db.run('UPDATE assignment_import_rows SET row_fingerprint = ? WHERE id = ?', [
          'f'.repeat(64),
          sourceRow.id,
        ]);
      }
      return originalBatch(statements);
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const apply = await request(
      h,
      `/imports/${staged.import.id}/apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: reviewed.import.reconciliationRevision,
          canonical_effective_on: SOURCE_SNAPSHOT,
        }),
      },
      { db: concurrentDb },
    );
    expect(errorSpy).toHaveBeenCalledWith('telestaff apply failed', expect.anything());
    errorSpy.mockRestore();
    expect(apply.status).toBe(409);
    await expect(apply.json()).resolves.toEqual({ error: 'apply_rejected' });
    expect(
      (
        await h.db.run(
          `SELECT status, reconciliation_revision,
                  (SELECT COUNT(*) FROM assignment_observations) AS observations,
                  (SELECT COUNT(*) FROM member_assignments) AS assignments
             FROM assignment_imports WHERE id = ?`,
          [staged.import.id],
        )
      ).results,
    ).toEqual([
      {
        status: 'reviewed',
        reconciliation_revision: reviewed.import.reconciliationRevision,
        observations: 0,
        assignments: 0,
      },
    ]);
  });

  it('atomically protects a manual source-boundary correction written after review', async () => {
    await seedOperatorAndMappedSlot(h);
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string }>;
    };
    const sourceRow = detail.rows[0];
    expect(sourceRow).toBeDefined();
    if (sourceRow === undefined) return;
    const review = await request(h, `/imports/${staged.import.id}/rows/${sourceRow.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as { import: { reconciliationRevision: number } };

    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    let injected = false;
    const concurrentDb = Object.create(h.env.DB) as D1Database;
    concurrentDb.batch = async (statements) => {
      if (!injected) {
        injected = true;
        await h.db.run(
          `INSERT INTO staffing_positions
             (id, stable_slot_key, active_from, review_status, created_at, updated_at)
           VALUES ('slot-race-manual', 'SYNTHETIC/RACE/MANUAL/FF', '2026-01-01', 'approved', ?, ?)`,
          [NOW, NOW],
        );
        await h.db.run(
          `INSERT INTO member_assignments
             (id, member_id, staffing_position_id, origin_type, origin_ref, status,
              effective_from, effective_to, created_at, updated_at)
           VALUES ('manual-race-boundary', 1, 'slot-race-manual', 'ADMIN_TRANSFER',
              'synthetic-race-correction', 'active', ?, NULL, ?, ?)`,
          [SOURCE_SNAPSHOT, NOW, NOW],
        );
      }
      return originalBatch(statements);
    };
    const apply = await request(
      h,
      `/imports/${staged.import.id}/apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_reconciliation_revision: reviewed.import.reconciliationRevision,
          canonical_effective_on: SOURCE_SNAPSHOT,
        }),
      },
      { db: concurrentDb },
    );
    expect(apply.status).toBe(409);
    await expect(apply.json()).resolves.toEqual({ error: 'apply_rejected' });
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM assignment_observations) AS observations,
             (SELECT COUNT(*) FROM member_assignments WHERE id = 'manual-race-boundary')
               AS protected_manual,
             (SELECT COUNT(*) FROM member_assignments WHERE origin_type = 'TELESTAFF_IMPORT')
               AS source_assignments`,
        )
      ).results,
    ).toEqual([{ observations: 0, protected_manual: 1, source_assignments: 0 }]);
  });

  it('rejects two reviewed source rows that resolve to the same member before assigning either slot', async () => {
    await seedOperatorAndMappedSlot(h);
    const secondaryTopology = TOPOLOGY.replace('Engine 1', 'Engine 2');
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string }>;
    };
    const sourceRow = detail.rows[0];
    expect(sourceRow).toBeDefined();
    if (sourceRow === undefined) return;
    const review = await request(h, `/imports/${staged.import.id}/rows/${sourceRow.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(200);
    await h.db.run(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES ('slot-b', 'SYNTHETIC/A/ENGINE-2/FF', '2026-01-01', 'approved', ${NOW}, ${NOW});
       INSERT INTO staffing_position_source_mappings
         (id, staffing_position_id, source_system, source_locator, source_signature, source_version,
          source_hash, effective_from, created_at)
       VALUES ('mapping-b', 'slot-b', 'telestaff', '${secondaryTopology.replace(/'/g, "''")}',
          '${'c'.repeat(64)}', 'TELSTAFF_ASSIGNMENTS_HTML_V1', '${'d'.repeat(64)}',
          '2026-01-01', ${NOW});
       INSERT INTO assignment_import_rows
         (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
          resolved_member_id, staffing_position_source_mapping_id, source_a_r_day,
          normalized_source_topology, source_topology_completeness, disposition,
          reconciliation_classification, review_status, resolution_action, reviewed_at,
          reviewed_by_member_id, resolution_reason, created_at)
       VALUES ('duplicate-resolved-member-row', '${staged.import.id}', 2, '${'e'.repeat(64)}', NULL,
          1, 'mapping-b', 'G1', '${secondaryTopology.replace(/'/g, "''")}', 'complete',
          'new_combination', 'NEW_ASSIGNMENT', 'approved', 'APPLY_OBSERVATION', ${NOW}, 1,
          'APPLY_OBSERVATION', ${NOW});`,
    );
    const revision = await h.db.run(
      'SELECT reconciliation_revision FROM assignment_imports WHERE id = ?',
      [staged.import.id],
    );
    const expectedRevision = revision.results[0]?.reconciliation_revision;
    expect(expectedRevision).toEqual(expect.any(Number));

    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: expectedRevision,
        canonical_effective_on: SOURCE_SNAPSHOT,
      }),
    });
    expect(apply.status).toBe(409);
    await expect(apply.json()).resolves.toEqual({ error: 'duplicate_source_to_canonical_member' });
    expect(
      (
        await h.db.run(
          `SELECT (SELECT COUNT(*) FROM assignment_observations) AS observations,
                  (SELECT COUNT(*) FROM member_assignments) AS assignments`,
        )
      ).results,
    ).toEqual([{ observations: 0, assignments: 0 }]);
  });

  it('persists a trustworthy exact source observation time without using it as canonical effectivity', async () => {
    await seedOperatorAndMappedSlot(h);
    const sourceObservedAt = '2026-08-28T14:05:06.789Z';
    const expectedSourceObservedAt = Date.parse(sourceObservedAt);
    const stage = await request(h, '/imports', {
      method: 'POST',
      body: importForm({
        sourceObservedAt,
        sourceObservationTimeBasis: 'source_metadata',
      }),
    });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: {
        id: string;
        reconciliationRevision: number;
        sourceSnapshotAsOf: string;
        sourceObservedAt: number | null;
        sourceObservationTimeBasis: string;
      };
    };
    expect(staged.import).toMatchObject({
      sourceSnapshotAsOf: SOURCE_SNAPSHOT,
      sourceObservedAt: expectedSourceObservedAt,
      sourceObservationTimeBasis: 'source_metadata',
    });

    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number; sourceObservedAt: number | null };
      rows: Array<{ id: string }>;
    };
    expect(detail.import.sourceObservedAt).toBe(expectedSourceObservedAt);
    const row = detail.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    const review = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as { import: { reconciliationRevision: number } };
    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: reviewed.import.reconciliationRevision,
        canonical_effective_on: '2026-09-01',
      }),
    });
    expect(apply.status).toBe(200);
    expect(
      (
        await h.db.run(
          `SELECT import_record.source_observed_at AS import_source_observed_at,
                  import_record.source_observation_time_basis,
                  observation.source_observed_at AS observation_source_observed_at,
                  assignment_record.effective_from
           FROM assignment_imports import_record
           JOIN assignment_observations observation ON observation.assignment_import_id = import_record.id
           JOIN member_assignments assignment_record ON assignment_record.source_observation_id = observation.id
           WHERE import_record.id = ?`,
          [staged.import.id],
        )
      ).results,
    ).toEqual([
      {
        import_source_observed_at: expectedSourceObservedAt,
        source_observation_time_basis: 'source_metadata',
        observation_source_observed_at: expectedSourceObservedAt,
        effective_from: '2026-09-01',
      },
    ]);
  });

  it('rechecks the mapped canonical slot is approved and active before apply', async () => {
    await seedOperatorAndMappedSlot(h);
    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string }>;
    };
    const row = detail.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    const review = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as { import: { reconciliationRevision: number } };

    await h.db.run("UPDATE staffing_positions SET review_status = 'draft' WHERE id = 'slot-a'");
    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: reviewed.import.reconciliationRevision,
        canonical_effective_on: SOURCE_SNAPSHOT,
      }),
    });
    expect(apply.status).toBe(409);
    await expect(apply.json()).resolves.toEqual({ error: 'terminal_reconciliation_required' });
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM assignment_observations) AS observations,
             (SELECT COUNT(*) FROM member_assignments) AS assignments`,
        )
      ).results,
    ).toEqual([{ observations: 0, assignments: 0 }]);
  });

  it('protects a backdated manual assignment even when the requested canonical effective date is future', async () => {
    await seedOperatorAndMappedSlot(h);
    await h.db.run(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES ('slot-b', 'SYNTHETIC/B/ENGINE-2/FF', '2026-01-01', 'approved', ${NOW}, ${NOW});
       INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status,
          effective_from, effective_to, created_at, updated_at)
       VALUES ('prior-effective-range', 1, 'slot-b', 'ADMIN_TRANSFER', 'synthetic-prior-range',
          'ended', '2026-01-01', '2026-12-31', ${NOW}, ${NOW});`,
    );

    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string; reconciliationClassification: string }>;
    };
    expect(detail.rows).toEqual([
      expect.objectContaining({ reconciliationClassification: 'MOVED' }),
    ]);
    const row = detail.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    const review = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(review.status).toBe(409);
    await expect(review.json()).resolves.toEqual({ error: 'unsafe_review_decision' });
    expect(
      (
        await h.db.run(
          `SELECT id, staffing_position_id, origin_type, status, effective_from, effective_to
             FROM member_assignments
            WHERE member_id = 1
            ORDER BY id`,
        )
      ).results,
    ).toEqual([
      {
        id: 'prior-effective-range',
        staffing_position_id: 'slot-b',
        origin_type: 'ADMIN_TRANSFER',
        status: 'ended',
        effective_from: '2026-01-01',
        effective_to: '2026-12-31',
      },
    ]);
  });

  it('fails closed when multiple reviewer-controlled mappings share a source locator', async () => {
    await seedOperatorAndMappedSlot(h);
    await h.db.run(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES ('slot-duplicate', 'SYNTHETIC/A/ENGINE-1/FF-DUPLICATE', '2026-01-01', 'approved', ${NOW}, ${NOW});
       INSERT INTO staffing_position_source_mappings
         (id, staffing_position_id, source_system, source_locator, source_discriminator,
          source_signature, source_version, source_hash, effective_from, created_at)
       VALUES
         ('mapping-secondary', 'slot-duplicate', 'telestaff', '${TOPOLOGY.replace(/'/g, "''")}',
          'secondary', '${'c'.repeat(64)}', 'TELSTAFF_ASSIGNMENTS_HTML_V1', '${'d'.repeat(64)}',
          '2026-01-01', ${NOW});`,
    );

    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{
        id: string;
        reconciliationClassification: string;
        reviewState: string;
        allowedReviewActions: string[];
        hasStaffingPositionSourceMapping: boolean;
      }>;
    };
    expect(detail.rows).toEqual([
      expect.objectContaining({
        reconciliationClassification: 'AMBIGUOUS_MAPPING',
        reviewState: 'AMBIGUOUS_MAPPING_REVIEW_REQUIRED',
        allowedReviewActions: ['reject_source_row'],
        hasStaffingPositionSourceMapping: false,
      }),
    ]);
    const row = detail.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    const review = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'reject_source_row',
      }),
    });
    expect(review.status).toBe(200);
    const reviewed = (await review.json()) as { import: { reconciliationRevision: number } };
    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: reviewed.import.reconciliationRevision,
      }),
    });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({
      canonicalMutation: { createdObservations: 0, createdAssignments: 0 },
    });
  });

  it('cannot allow a synthetic test import to reach canonical staffing', async () => {
    await seedOperatorAndMappedSlot(h);

    const stage = await request(h, '/imports', {
      method: 'POST',
      body: importForm({ sourceKind: 'synthetic_test' }),
    });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as {
      import: { id: string; reconciliationRevision: number };
    };

    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: staged.import.reconciliationRevision,
      }),
    });
    expect(apply.status).toBe(409);
    await expect(apply.json()).resolves.toEqual({ error: 'synthetic_source_cannot_apply' });
    expect(
      (
        await h.db.run(
          `SELECT
             (SELECT COUNT(*) FROM assignment_observations) AS observations,
             (SELECT COUNT(*) FROM member_assignments) AS assignments,
             (SELECT COUNT(*) FROM portal_writeback_queue) AS portal_work`,
        )
      ).results,
    ).toEqual([{ observations: 0, assignments: 0, portal_work: 0 }]);
  });

  it('keeps a current approved assignment when the source observation is older', async () => {
    await seedOperatorAndMappedSlot(h);
    await h.db.run(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES ('slot-b', 'SYNTHETIC/B/ENGINE-3/FF', '2026-01-01', 'approved', ${NOW}, ${NOW});
       INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status,
          effective_from, effective_to, created_at, updated_at)
       VALUES ('manual-newer', 1, 'slot-b', 'ADMIN_TRANSFER', 'synthetic-transfer', 'active',
          '2026-08-28', NULL, ${NOW}, ${NOW});`,
    );

    const stage = await request(h, '/imports', {
      method: 'POST',
      body: importForm({ sourceSnapshotAsOf: '2026-08-27' }),
    });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as { import: { id: string } };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{ id: string; reconciliationClassification: string; reviewState: string }>;
    };
    expect(detail.rows).toEqual([
      expect.objectContaining({
        reconciliationClassification: 'MOVED',
        reviewState: 'CURRENT_RECORD_PROTECTED_FROM_SOURCE_OBSERVATION',
      }),
    ]);

    const row = detail.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    const keep = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'keep_current',
      }),
    });
    expect(keep.status).toBe(200);
    const kept = (await keep.json()) as { import: { reconciliationRevision: number } };

    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: kept.import.reconciliationRevision,
      }),
    });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({
      canonicalMutation: { createdObservations: 0, createdAssignments: 0, endedAssignments: 0 },
    });
    expect(
      (
        await h.db.run(
          `SELECT id, staffing_position_id, origin_type, status, effective_from
             FROM member_assignments ORDER BY id`,
        )
      ).results,
    ).toEqual([
      {
        id: 'manual-newer',
        staffing_position_id: 'slot-b',
        origin_type: 'ADMIN_TRANSFER',
        status: 'active',
        effective_from: '2026-08-28',
      },
    ]);
  });

  it('protects a manual assignment effective on the exact source snapshot date', async () => {
    await seedOperatorAndMappedSlot(h);
    await h.db.run(
      `INSERT INTO staffing_positions
         (id, stable_slot_key, active_from, review_status, created_at, updated_at)
       VALUES ('slot-b', 'SYNTHETIC/B/ENGINE-3/FF', '2026-01-01', 'approved', ${NOW}, ${NOW});
       INSERT INTO member_assignments
         (id, member_id, staffing_position_id, origin_type, origin_ref, status,
          effective_from, effective_to, created_at, updated_at)
       VALUES ('manual-same-date', 1, 'slot-b', 'ADMIN_TRANSFER', 'synthetic-manual-correction',
          'active', '${SOURCE_SNAPSHOT}', NULL, ${NOW}, ${NOW});`,
    );

    const stage = await request(h, '/imports', { method: 'POST', body: importForm() });
    expect(stage.status).toBe(201);
    const staged = (await stage.json()) as { import: { id: string } };
    const detail = (await (await request(h, `/imports/${staged.import.id}`)).json()) as {
      import: { reconciliationRevision: number };
      rows: Array<{
        id: string;
        reconciliationClassification: string;
        reviewState: string;
        allowedReviewActions: string[];
      }>;
    };
    expect(detail.rows).toEqual([
      expect.objectContaining({
        reconciliationClassification: 'MOVED',
        reviewState: 'CURRENT_RECORD_PROTECTED_FROM_SOURCE_OBSERVATION',
        allowedReviewActions: ['keep_current', 'reject_source_row'],
      }),
    ]);
    const row = detail.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    const unsafeAccept = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'accept_observation',
      }),
    });
    expect(unsafeAccept.status).toBe(409);
    await expect(unsafeAccept.json()).resolves.toEqual({ error: 'unsafe_review_decision' });

    const keep = await request(h, `/imports/${staged.import.id}/rows/${row.id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: detail.import.reconciliationRevision,
        decision: 'keep_current',
      }),
    });
    expect(keep.status).toBe(200);
    const kept = (await keep.json()) as { import: { reconciliationRevision: number } };
    const apply = await request(h, `/imports/${staged.import.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expected_reconciliation_revision: kept.import.reconciliationRevision,
      }),
    });
    expect(apply.status).toBe(200);
    await expect(apply.json()).resolves.toMatchObject({
      canonicalMutation: { createdAssignments: 0, endedAssignments: 0 },
    });
    expect(
      (
        await h.db.run(
          `SELECT id, staffing_position_id, origin_type, status, effective_from
             FROM member_assignments ORDER BY id`,
        )
      ).results,
    ).toEqual([
      {
        id: 'manual-same-date',
        staffing_position_id: 'slot-b',
        origin_type: 'ADMIN_TRANSFER',
        status: 'active',
        effective_from: SOURCE_SNAPSHOT,
      },
    ]);
  });
});
