import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '../../src/db/index.js';
import {
  loadFrozenSessionBidPolicy,
  prepareBidSessionPolicySnapshot,
} from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import { SPECIALTY_TEST_POLICY_LABEL } from '../../src/lib/specialty-test-policy.js';
import specialtyAdjudication from '../../src/routes/admin/specialty-adjudication.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const CAPTURED_BEFORE_EXPIRY = Date.UTC(2026, 8, 1, 12, 0, 0);
const CAPTURED_AFTER_EXPIRY = Date.UTC(2026, 9, 2, 12, 0, 0);
const CAPTURED_AFTER_LEGACY_EXPIRY = Date.UTC(2027, 0, 2, 12, 0, 0);
const SESSION_ID = '01HZZ0000000000000QUALPOL';
const ROUTE_SESSION_ID = '01HZZ0000000000000QUALRT';
const JWT_KEY = 's'.repeat(64);
const LIVE_ACTIONS = [
  'record_selection',
  'amend_selection',
  'skip_defer',
  'mark_unreachable',
  'force',
  'resolve_tie',
  'alter_order',
  'pause_resume',
  'approve_transition',
  'approve_final_results',
  'publish',
];
const LIVE_DISPOSITIONS = ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'];

function liveConfiguration() {
  return {
    v: 3,
    expectedDurationDays: 2,
    turnTimerSeconds: 180,
    credentialEvaluationOn: '2026-09-01',
    livePolicy: {
      v: 1,
      policyRevision: 'qualification-lifecycle-test',
      stages: [
        {
          id: 'D_CAPTAIN',
          label: 'D Captain',
          order: 0,
          memberIds: [1, 2, 3, 4],
          opportunityPositionIds: ['A101'],
          kind: 'CAPTAIN',
        },
      ],
      dispositions: LIVE_DISPOSITIONS.map((disposition) => ({
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
      actionPermissions: LIVE_ACTIONS.map((action) => ({ action, actorMemberIds: [1] })),
      specialtyCatalogReference: null,
      aDayPolicyReference: null,
      transitionPolicyReference: null,
      publicationPolicyReference: null,
    },
  };
}

type SpecialtyDurableCall = { path: string; method: string; body: unknown };

function stubSpecialtyBidSessionNamespace(calls: SpecialtyDurableCall[]): WorkerEnv['BID_SESSION'] {
  const stub = {
    fetch: async (input: Request | string, init?: RequestInit) => {
      const request = typeof input === 'string' ? new Request(input, init) : input;
      const body = request.method === 'GET' ? null : await request.json();
      calls.push({ path: new URL(request.url).pathname, method: request.method, body });
      return new Response(
        JSON.stringify({
          mode: 'synthetic_test_only',
          kind: 'accepted',
          idempotent_replay: false,
          result: { kind: 'suspended', state: { revision: 1 }, events: [] },
          audit_receipt: {
            origin: 'synthetic_specialty_test',
            actor_type: 'admin',
            actor_id: 0,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  };
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: () => stub as unknown as DurableObjectStub,
    idFromString: () => ({ toString: () => 'synthetic-specialty-do' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'synthetic-specialty-do' }) as DurableObjectId,
  } as unknown as WorkerEnv['BID_SESSION'];
}

function syntheticSpecialtyRoutePolicy() {
  return {
    source: 'synthetic',
    policy_reference: 'synthetic-lifecycle-freeze-route-v1',
    test_policy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: 'synthetic-lifecycle-freeze-route-v1',
      specialty_pool: {
        id: 'SYNTHETIC_MARINE_POOL',
        label: 'Synthetic marine specialty rehearsal pool',
      },
      qualification_requirements: {
        v: 1,
        credential_names: ['Synthetic EMT'],
        specialty_codes: ['SYNTHETIC_MARINE'],
      },
      ranking: {
        source: 'EXPLICIT_TEST_PRIORITY',
        reference: 'synthetic-lifecycle-freeze-priority-v1',
      },
      scoring: { source: 'EXPLICIT_TEST_PRIORITY', direction: 'LOWER_SCORE_WINS' },
      tie_break_chain: ['rsc_seniority', 'rank_seniority', 'member_id'],
      normal_bid_interruption: 'SUSPEND_EXACT_NORMAL_TURN',
      candidate_outcomes: ['award', 'declined'],
      original_bidder_resume: 'RESUME_EXACT_ORIGINAL_TURN',
    },
    candidate_release_policy: {
      status: 'configured',
      on_release: 'continue_to_next_higher_priority',
    },
    candidates: [
      { member_id: 1, explicit_priority: 1 },
      { member_id: 2, explicit_priority: 2 },
      { member_id: 4, explicit_priority: 3 },
    ],
  };
}

async function freshAdminAuthorization(): Promise<string> {
  const token = await signJwt(
    {
      sub: 0,
      emp: 'synthetic-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Synthetic',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    JWT_KEY,
  );
  return `Bearer ${token}`;
}

async function seedPolicy(h: TestD1): Promise<void> {
  await h.db.run(
    `INSERT INTO position_templates (version, effective_year) VALUES ('qualification.v1', 2026);
     INSERT INTO rule_books (version, effective_year, status, revision)
       VALUES ('qualification.v1', 2026, 'draft', 0);
     INSERT INTO positions
       (id, template_version, shift, station, division, unit, rank_required, position_name)
       VALUES
        ('A101', 'qualification.v1', 'A', '1', 'Combat', 'Engine 1', 'FF', 'Synthetic FF'),
        ('A211', 'qualification.v1', 'A', '2', 'Command', '300', 'DC', 'Synthetic Admin Slot');
     INSERT INTO position_rules
       (rule_book_version, position_id, template_version, required_criteria,
        points_preference, tie_break_chain)
       VALUES ('qualification.v1', 'A101', 'qualification.v1',
        '{"rank":["FF"],"credentials":["Synthetic EMT"],"custom":[]}',
        '{"max":0,"items":[]}',
        '["points","rsc_seniority","rank_seniority"]');
     INSERT INTO rule_book_position_participation
       (rule_book_version, position_id, template_version, bid_participation,
        authoritative_source_ref, created_at)
       VALUES
        ('qualification.v1', 'A101', 'qualification.v1', 'BIDDABLE', 'synthetic/A101', 1),
        ('qualification.v1', 'A211', 'qualification.v1', 'ADMIN_ASSIGNED_NON_BIDDABLE', 'synthetic/A211', 1);
     UPDATE rule_books SET status = 'active' WHERE version = 'qualification.v1';
      INSERT INTO bid_years
        (year, status, position_template_version, rule_book_version, config_json, configuration_revision)
        VALUES (2026, 'live', 'qualification.v1', 'qualification.v1',
         '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2026-09-01"}', 0);
     INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, employment_status, employment_status_effective_on, created_at, updated_at)
       VALUES
        (1, 'synthetic-policy-001', 'Policy', 'Member', 'FF', 'FF', 1, 0, 'active', '2020-01-01', 1, 1),
        (2, 'synthetic-retirement-002', 'Retired', 'At Capture', 'FF', 'FF', 2, 0, 'active', '2020-01-01', 1, 1),
        (3, 'synthetic-unknown-003', 'Unconfirmed', 'Legacy', 'FF', 'FF', 3, 0, 'unknown', NULL, 1, 1),
        (4, 'synthetic-assignment-004', 'Planned', 'Admin', 'FF', 'FF', 4, 0, 'active', '2020-01-01', 1, 1);
     INSERT INTO staffing_positions
       (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
       VALUES ('qualification-admin-slot', 'SYNTHETIC/A/2/ADMIN', 'A', '2', '300', 'Synthetic Admin Slot', 'DC',
        '2020-01-01', 'approved', 1, 1);
     INSERT INTO position_staffing_bindings
       (position_id, template_version, staffing_position_id, authoritative_source_ref, review_status, created_at)
       VALUES ('A211', 'qualification.v1', 'qualification-admin-slot', 'synthetic/A211', 'approved', 1);
     INSERT INTO member_assignments
       (id, member_id, staffing_position_id, origin_type, origin_ref, status,
        effective_from, effective_to, created_at, updated_at)
       VALUES ('qualification-planned-admin-assignment', 4, 'qualification-admin-slot', 'ADMIN_TRANSFER',
        'synthetic/planned-admin', 'planned', '2026-10-01', NULL, 1, 1);
     INSERT INTO credentials (id, name) VALUES
       (10, 'Synthetic EMT'),
       (11, 'Legacy Dated Credential');
     INSERT INTO member_credentials (member_id, credential_id, start_date, expiration_date)
       VALUES (1, 11, '2026-10-01', '2026-12-31');
     INSERT INTO member_qualification_events
       (id, member_id, credential_id, specialty_code, kind, effective_on, expires_on,
        evidence_source, evidence_reference, reason, actor_subject, idempotency_key,
        before_state, after_state, created_at)
       VALUES ('qualification-gain-policy', 1, 10, NULL, 'CERTIFICATION_GAINED', '2026-08-01', NULL,
       'synthetic-state-registry', 'SYNTH-POLICY-GAIN', 'Synthetic certification evidence.', '0',
        'qualification-gain-policy', '{}', '{}', 1),
       ('specialty-gain-marine', 1, NULL, 'SYNTHETIC_MARINE', 'SPECIALTY_QUALIFIED', '2026-08-01', NULL,
        'synthetic-specialty-registry', 'SYNTH-MARINE-GAIN', 'Synthetic specialty evidence.', '0',
        'specialty-gain-marine', '{}', '{}', 2),
       ('specialty-gain-rescue', 1, NULL, 'SYNTHETIC_RESCUE', 'SPECIALTY_QUALIFIED', '2026-08-01', NULL,
        'synthetic-specialty-registry', 'SYNTH-RESCUE-GAIN', 'Synthetic specialty evidence.', '0',
        'specialty-gain-rescue', '{}', '{}', 3);
     INSERT INTO personnel_lifecycle_events
       (id, member_id, staffing_position_id, member_assignment_id, kind, effective_on,
        employment_status_before, employment_status_after, rank_before, rank_after,
        separation_type, reason, origin, actor_subject, idempotency_key, before_state, after_state, created_at)
       VALUES ('qualification-retirement-at-capture', 2, NULL, NULL, 'RETIREMENT', '2026-10-01',
        'active', 'retired', 'FF', 'FF', 'RETIREMENT', 'Synthetic effective-dated retirement.',
        'ADMIN', '0', 'qualification-retirement-at-capture',
        '{"employmentStatus":"active","employmentStatusEffectiveOn":"2020-01-01","separationType":null,"rank":"FF"}',
        '{"employmentStatus":"retired","separationType":"RETIREMENT","rank":"FF"}', 2);`,
  );
  await h.db.run('UPDATE bid_years SET config_json = ? WHERE year = 2026', [
    JSON.stringify(liveConfiguration()),
  ]);
}

/**
 * A committed official import designated as the annual baseline. The fixture
 * deliberately supplies no personnel correction for member 3: the mock path
 * must freeze source-backed participation without turning a legacy/unknown
 * employment record into an active personnel record.
 */
async function seedAcceptedMockParticipationBaseline(h: TestD1): Promise<void> {
  await h.db.run(
    `INSERT INTO staffing_positions
       (id, stable_slot_key, shift, station, unit, position_name, applicable_rank,
        active_from, review_status, created_at, updated_at)
     VALUES ('qualification-biddable-slot', 'SYNTHETIC/A/1/FF', 'A', '1', 'Engine 1',
       'Synthetic FF', 'FF', '2026-08-24', 'approved', 1, 1);
     INSERT INTO staffing_position_source_mappings
       (id, staffing_position_id, source_system, source_locator, source_signature,
       source_version, source_hash, effective_from, created_at)
     VALUES ('qualification-mock-mapping', 'qualification-biddable-slot', 'telestaff',
       '{"v":1,"shift":"A","division":"Suppression","station":"1","unit":"Engine 1","position":"Synthetic FF"}',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'synthetic-v1',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-08-24', 1);
     INSERT INTO assignment_imports
       (id, source_system, source_version, source_hash, source_format, parser_version, source_kind,
        status, input_row_count, normalized_data_row_count, unique_employee_count,
        report_row_count, structural_row_count, source_snapshot_as_of, created_at)
     VALUES ('qualification-mock-import', 'telestaff', 'synthetic-v1',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       'TELSTAFF_ASSIGNMENTS_HTML_V1', 'telestaff-assignments-html@1',
       'official', 'staged', 1, 1, 1, 1, 0, '2026-08-24', 1);
     INSERT INTO assignment_import_rows
       (id, import_id, source_row_number, row_fingerprint, member_reference_hmac,
        resolved_member_id, staffing_position_source_mapping_id, normalized_source_topology,
        disposition, reconciliation_classification, review_status, created_at)
     VALUES ('qualification-mock-row', 'qualification-mock-import', 1,
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 3,
       'qualification-mock-mapping',
       '{"v":1,"shift":"A","division":"Suppression","station":"1","unit":"Engine 1","position":"Synthetic FF"}',
       'unchanged', 'UNCHANGED', 'not_required', 1);`,
  );
  await h.db.run(
    "UPDATE assignment_imports SET status = 'reviewed' WHERE id = 'qualification-mock-import';",
  );
  await h.db.run(
    `UPDATE assignment_imports
       SET status = 'approved', approved_at = 1, approved_by_member_id = 1
       WHERE id = 'qualification-mock-import';`,
  );
  await h.db.run(
    "UPDATE assignment_imports SET status = 'committed', committed_at = 1 WHERE id = 'qualification-mock-import';",
  );
  await h.db.run(
    `INSERT INTO assignment_observations
       (id, assignment_import_id, assignment_import_row_id, member_id, staffing_position_id,
        staffing_position_source_mapping_id, normalized_source_topology, observed_at, created_at)
     VALUES ('qualification-mock-observation', 'qualification-mock-import', 'qualification-mock-row', 3,
       'qualification-biddable-slot', 'qualification-mock-mapping',
       '{"v":1,"shift":"A","division":"Suppression","station":"1","unit":"Engine 1","position":"Synthetic FF"}',
       1, 1);
     INSERT INTO member_assignments
       (id, member_id, staffing_position_id, origin_type, origin_ref, source_observation_id,
        status, effective_from, created_at, updated_at)
     VALUES ('qualification-mock-assignment', 3, 'qualification-biddable-slot', 'TELESTAFF_IMPORT',
       'qualification-mock-import', 'qualification-mock-observation', 'active', '2026-08-24', 1, 1);
     INSERT INTO bid_year_staffing_baselines
       (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
        acceptance_reason, created_at)
     VALUES ('qualification-mock-baseline', 2026, 'qualification-mock-import', 'accepted',
       1, 1, 'Synthetic accepted baseline for mock-only policy coverage.', 1);`,
  );
}

describe('qualification evidence in frozen Bid policy', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await seedPolicy(h);
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('uses the configured immutable credential evaluation date instead of a later capture timestamp and leaves an established snapshot unchanged', async () => {
    const db = getDb(h.env.DB);
    const beforeExpiry = await prepareBidSessionPolicySnapshot(
      db,
      2026,
      CAPTURED_BEFORE_EXPIRY,
      'live',
    );
    expect(beforeExpiry).toMatchObject({ ok: true });
    if (!beforeExpiry.ok) return;
    expect(beforeExpiry.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 1, credentialNames: ['Synthetic EMT'] }),
      ]),
    );
    expect(beforeExpiry.snapshot).toMatchObject({
      credentialEvaluationOn: '2026-09-01',
      settings: { v: 3, credentialEvaluationOn: '2026-09-01' },
    });
    expect(beforeExpiry.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          specialtyQualifications: [
            {
              specialtyCode: 'SYNTHETIC_MARINE',
              status: 'active',
              effectiveOn: '2026-08-01',
              expiresOn: null,
            },
            {
              specialtyCode: 'SYNTHETIC_RESCUE',
              status: 'active',
              effectiveOn: '2026-08-01',
              expiresOn: null,
            },
          ],
        }),
      ]),
    );

    await h.db.run(
      `INSERT INTO bid_sessions
         (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count, is_mock)
       VALUES (?, 2026, ?, 'config', 180, 2, 0, 0);`,
      [SESSION_ID, CAPTURED_BEFORE_EXPIRY],
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision, snapshot_json, captured_at)
       VALUES (?, 'qualification.v1', 'qualification.v1', 0, ?, ?);`,
      [SESSION_ID, JSON.stringify(beforeExpiry.snapshot), CAPTURED_BEFORE_EXPIRY],
    );

    await h.db.run(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, kind, effective_on, expires_on,
          evidence_source, evidence_reference, reason, actor_subject, idempotency_key,
          before_state, after_state, created_at)
       VALUES ('qualification-expire-policy', 1, 10, NULL, 'CERTIFICATION_EXPIRED', '2026-10-01', '2026-10-01',
        'synthetic-state-registry', 'SYNTH-POLICY-EXP', 'Synthetic expiration evidence.', '0',
        'qualification-expire-policy', '{}', '{}', 2);`,
    );
    await h.db.run(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
          effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
          idempotency_key, before_state, after_state, created_at)
       VALUES
        ('specialty-revoke-marine', 1, NULL, 'SYNTHETIC_MARINE', 'REVOKED', 'SPECIALTY_QUALIFIED',
         '2026-08-15', NULL, 'synthetic-specialty-registry', 'SYNTH-MARINE-REVOKE',
         'Synthetic specialty revocation.', '0', 'specialty-revoke-marine', '{}', '{}', 4),
        ('specialty-expire-rescue', 1, NULL, 'SYNTHETIC_RESCUE', 'EXPIRED', 'SPECIALTY_QUALIFIED',
         '2026-08-16', '2026-08-16', 'synthetic-specialty-registry', 'SYNTH-RESCUE-EXPIRE',
         'Synthetic specialty expiration.', '0', 'specialty-expire-rescue', '{}', '{}', 5);`,
    );

    const preserved = await loadFrozenSessionBidPolicy(db, SESSION_ID);
    expect(preserved).toMatchObject({ ok: true });
    if (!preserved.ok || preserved.snapshot.v !== 3) return;
    expect(preserved.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          credentialNames: ['Synthetic EMT'],
          specialtyQualifications: [
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_MARINE', status: 'active' }),
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_RESCUE', status: 'active' }),
          ],
        }),
      ]),
    );

    const afterExpiry = await prepareBidSessionPolicySnapshot(
      db,
      2026,
      CAPTURED_AFTER_EXPIRY,
      'live',
    );
    expect(afterExpiry).toMatchObject({ ok: true });
    if (!afterExpiry.ok) return;
    expect(afterExpiry.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          credentialNames: ['Synthetic EMT'],
          specialtyQualifications: [
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_MARINE', status: 'revoked' }),
            expect.objectContaining({
              specialtyCode: 'SYNTHETIC_RESCUE',
              status: 'expired',
              expiresOn: '2026-08-16',
            }),
          ],
        }),
      ]),
    );

    const afterLegacyExpiry = await prepareBidSessionPolicySnapshot(
      db,
      2026,
      CAPTURED_AFTER_LEGACY_EXPIRY,
      'live',
    );
    expect(afterLegacyExpiry).toMatchObject({ ok: true });
    if (!afterLegacyExpiry.ok) return;
    expect(afterLegacyExpiry.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          credentialNames: ['Synthetic EMT'],
          specialtyQualifications: [
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_MARINE', status: 'revoked' }),
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_RESCUE', status: 'expired' }),
          ],
        }),
      ]),
    );
  });

  it('forwards lifecycle-derived specialty eligibility from a generated frozen V3 snapshot after a later ledger mutation', async () => {
    const db = getDb(h.env.DB);
    const generated = await prepareBidSessionPolicySnapshot(
      db,
      2026,
      CAPTURED_BEFORE_EXPIRY,
      'live',
    );
    expect(generated).toMatchObject({ ok: true });
    if (!generated.ok || generated.snapshot.v !== 3) return;

    expect(generated.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          credentialNames: ['Synthetic EMT'],
          specialtyQualifications: expect.arrayContaining([
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_MARINE', status: 'active' }),
          ]),
        }),
      ]),
    );

    await h.db.run(
      `INSERT INTO bid_sessions
         (id, bid_year, started_at, current_phase, current_bidder_id, turn_timer_seconds,
          expected_duration_days, day_count, is_mock)
       VALUES (?, 2026, ?, 'position_bid', 1, 180, 2, 0, 1);`,
      [ROUTE_SESSION_ID, CAPTURED_BEFORE_EXPIRY],
    );
    await h.db.run(
      `INSERT INTO bid_order (bid_session_id, ordinal, member_id, pool)
       VALUES (?, 1, 1, 'FF'), (?, 2, 2, 'FF'), (?, 3, 4, 'FF');`,
      [ROUTE_SESSION_ID, ROUTE_SESSION_ID, ROUTE_SESSION_ID],
    );
    await h.db.run(
      `INSERT INTO bid_session_policy_snapshots
         (bid_session_id, rule_book_version, position_template_version, rule_book_revision,
          snapshot_json, captured_at)
       VALUES (?, 'qualification.v1', 'qualification.v1', 0, ?, ?);`,
      [ROUTE_SESSION_ID, JSON.stringify(generated.snapshot), CAPTURED_BEFORE_EXPIRY],
    );

    // This is an immutable, later-appended lifecycle fact that would make a
    // new snapshot treat the marine qualification as revoked. It must not
    // rewrite the already persisted session snapshot used by the route.
    await h.db.run(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
          effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
          idempotency_key, before_state, after_state, created_at)
       VALUES ('specialty-revoke-after-route-freeze', 1, NULL, 'SYNTHETIC_MARINE', 'REVOKED',
         'SPECIALTY_QUALIFIED', '2026-08-15', NULL, 'synthetic-specialty-registry',
         'SYNTH-MARINE-REVOKE-AFTER-FREEZE', 'Synthetic later-appended revocation.', '0',
         'specialty-revoke-after-route-freeze', '{}', '{}', ?);`,
      [CAPTURED_BEFORE_EXPIRY + 1],
    );

    const newlyGenerated = await prepareBidSessionPolicySnapshot(
      db,
      2026,
      CAPTURED_BEFORE_EXPIRY + 1,
      'live',
    );
    expect(newlyGenerated).toMatchObject({ ok: true });
    if (!newlyGenerated.ok || newlyGenerated.snapshot.v !== 3) return;
    expect(newlyGenerated.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          specialtyQualifications: expect.arrayContaining([
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_MARINE', status: 'revoked' }),
          ]),
        }),
      ]),
    );

    const frozenAfterMutation = await loadFrozenSessionBidPolicy(db, ROUTE_SESSION_ID);
    expect(frozenAfterMutation).toMatchObject({ ok: true });
    if (!frozenAfterMutation.ok || frozenAfterMutation.snapshot.v !== 3) return;
    expect(frozenAfterMutation.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 1,
          specialtyQualifications: expect.arrayContaining([
            expect.objectContaining({ specialtyCode: 'SYNTHETIC_MARINE', status: 'active' }),
          ]),
        }),
      ]),
    );

    const calls: SpecialtyDurableCall[] = [];
    const response = await specialtyAdjudication.fetch(
      new Request(`http://x/${ROUTE_SESSION_ID}/specialty-adjudication/requests`, {
        method: 'POST',
        headers: {
          Authorization: await freshAdminAuthorization(),
          'Content-Type': 'application/json',
          'Idempotency-Key': 'specialty-lifecycle-freeze-route-command-1',
        },
        body: JSON.stringify({
          command_id: 'specialty-lifecycle-freeze-route-command-1',
          expected_revision: 0,
          expected_normal_control_revision: 0,
          request_id: 'specialty-lifecycle-freeze-route-request-1',
          position_id: 'A101',
          policy: syntheticSpecialtyRoutePolicy(),
          reason: 'Verify that the synthetic route uses frozen lifecycle facts.',
        }),
      }),
      {
        ...h.env,
        JWT_SIGNING_KEY: JWT_KEY,
        BID_SESSION: stubSpecialtyBidSessionNamespace(calls),
      },
    );

    expect(response.status).toBe(200);
    const forwarded = calls.at(0)?.body as {
      command?: { policy?: { candidates?: unknown[] } };
    };
    expect(forwarded.command?.policy?.candidates).toEqual(
      expect.arrayContaining([
        {
          memberId: 1,
          priorityRank: 0,
          generalEligibility: { status: 'eligible' },
          specialtyEligibility: { status: 'eligible' },
        },
      ]),
    );
  });

  it('fails closed when a raw specialty terminal kind lacks its companion discriminator', async () => {
    // Simulate a legacy/manual import that bypassed the immutable ledger's
    // original kind constraint. A direct terminal kind has no valid persisted
    // representation without the additive discriminator.
    h.sqlite.pragma('ignore_check_constraints = ON');
    await h.db.run(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
          effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
          idempotency_key, before_state, after_state, created_at)
       VALUES ('missing-specialty-terminal-discriminator', 1, NULL, 'SYNTHETIC_MARINE', NULL,
         'SPECIALTY_REVOKED', '2026-08-15', NULL, 'synthetic-specialty-registry',
         'SYNTHETIC-MISSING-TERMINAL', 'Synthetic missing terminal discriminator.', '0',
         'missing-specialty-terminal-discriminator', '{}', '{}', 6);`,
    );

    const prepared = await prepareBidSessionPolicySnapshot(
      getDb(h.env.DB),
      2026,
      CAPTURED_AFTER_EXPIRY,
      'live',
    );
    expect(prepared).toEqual({ ok: false, code: 'qualification_lifecycle_data_invalid' });
  });

  it('fails closed when a persisted specialty terminal row is structurally inconsistent', async () => {
    // Simulate legacy/manual corruption after schema enforcement is bypassed:
    // a terminal discriminator may never coexist with a credential target.
    h.sqlite.exec('DROP TRIGGER member_qualification_events_specialty_terminal_shape;');
    h.sqlite.pragma('ignore_check_constraints = ON');
    await h.db.run(
      `INSERT INTO member_qualification_events
         (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind,
          effective_on, expires_on, evidence_source, evidence_reference, reason, actor_subject,
          idempotency_key, before_state, after_state, created_at)
       VALUES ('invalid-specialty-terminal', 1, 10, 'SYNTHETIC_MARINE', 'REVOKED',
         'SPECIALTY_QUALIFIED', '2026-08-15', NULL, 'synthetic-specialty-registry',
         'SYNTHETIC-INVALID-TERMINAL', 'Synthetic invalid terminal evidence.', '0',
         'invalid-specialty-terminal', '{}', '{}', 7);`,
    );

    const prepared = await prepareBidSessionPolicySnapshot(
      getDb(h.env.DB),
      2026,
      CAPTURED_AFTER_EXPIRY,
      'live',
    );
    expect(prepared).toEqual({ ok: false, code: 'qualification_lifecycle_data_invalid' });
  });

  it('uses lifecycle status and planned administrative occupancy as of the immutable capture date', async () => {
    const db = getDb(h.env.DB);
    const before = await prepareBidSessionPolicySnapshot(db, 2026, CAPTURED_BEFORE_EXPIRY, 'live');
    expect(before).toMatchObject({ ok: true });
    if (!before.ok) return;
    const beforeByMember = new Map(
      before.snapshot.members.map((member) => [member.memberId, member]),
    );
    expect(beforeByMember.get(2)).toMatchObject({ pool: 'FF', exclusionReason: null });
    expect(beforeByMember.get(3)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'MEMBER_EMPLOYMENT_UNCONFIRMED',
    });
    expect(beforeByMember.get(4)).toMatchObject({ pool: 'FF', exclusionReason: null });

    const after = await prepareBidSessionPolicySnapshot(db, 2026, CAPTURED_AFTER_EXPIRY, 'live');
    expect(after).toMatchObject({ ok: true });
    if (!after.ok) return;
    const afterByMember = new Map(
      after.snapshot.members.map((member) => [member.memberId, member]),
    );
    expect(afterByMember.get(2)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'MEMBER_NOT_ACTIVE',
      authoritativeAssignmentId: null,
    });
    expect(afterByMember.get(4)).toMatchObject({
      pool: 'EXCLUDED',
      exclusionReason: 'ADMIN_ASSIGNED_NON_BIDDABLE',
      authoritativeAssignmentId: 'qualification-planned-admin-assignment',
    });
  });

  it('uses an accepted TeleStaff baseline for mock participation without changing live personnel eligibility', async () => {
    await seedAcceptedMockParticipationBaseline(h);
    const db = getDb(h.env.DB);

    const live = await prepareBidSessionPolicySnapshot(db, 2026, CAPTURED_BEFORE_EXPIRY, 'live');
    expect(live).toMatchObject({ ok: true });
    if (!live.ok || live.snapshot.v !== 3) return;
    expect(live.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 3,
          pool: 'EXCLUDED',
          exclusionReason: 'MEMBER_EMPLOYMENT_UNCONFIRMED',
        }),
      ]),
    );

    await h.db.run("UPDATE rule_books SET status = 'draft' WHERE version = 'qualification.v1';");
    const mock = await prepareBidSessionPolicySnapshot(db, 2026, CAPTURED_BEFORE_EXPIRY, 'mock');
    expect(mock).toMatchObject({ ok: true });
    if (!mock.ok || mock.snapshot.v !== 3) return;
    expect(mock.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 3,
          pool: 'FF',
          exclusionReason: null,
          mockParticipationEvidence: 'ACCEPTED_STAFFING_BASELINE',
        }),
      ]),
    );
  });

  it('keeps civilians excluded from the operator identity projection when preparing a mock snapshot', async () => {
    await h.db.run(
      `INSERT INTO members
         (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
          is_probationary, employment_status, employment_status_effective_on, created_at, updated_at)
       VALUES (5, 'synthetic-civilian-005', 'Civilian', 'Observer', 'CIVILIAN', 'EXCLUDED', 0,
               0, 'active', '2020-01-01', 1, 1);`,
    );
    await seedAcceptedMockParticipationBaseline(h);
    await h.db.run("UPDATE rule_books SET status = 'draft' WHERE version = 'qualification.v1';");

    const prepared = await prepareBidSessionPolicySnapshot(
      getDb(h.env.DB),
      2026,
      CAPTURED_BEFORE_EXPIRY,
      'mock',
    );

    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok || prepared.snapshot.v !== 3) return;
    expect(prepared.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 5,
          rank: 'CIVILIAN',
          pool: 'EXCLUDED',
          exclusionReason: 'MEMBER_CATEGORY_EXCLUDED',
        }),
      ]),
    );
    expect(prepared.snapshot.operatorIdentityProjection).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ memberId: 5 })]),
    );
  });
});
