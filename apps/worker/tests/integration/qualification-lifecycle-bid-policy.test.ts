import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '../../src/db/index.js';
import {
  loadFrozenSessionBidPolicy,
  prepareBidSessionPolicySnapshot,
} from '../../src/lib/bid-policy.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const CAPTURED_BEFORE_EXPIRY = Date.UTC(2026, 8, 1, 12, 0, 0);
const CAPTURED_AFTER_EXPIRY = Date.UTC(2026, 9, 2, 12, 0, 0);
const CAPTURED_AFTER_LEGACY_EXPIRY = Date.UTC(2027, 0, 2, 12, 0, 0);
const SESSION_ID = '01HZZ0000000000000QUALPOL';

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
        '{"v":1,"expectedDurationDays":2,"turnTimerSeconds":180}', 0);
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
        'qualification-gain-policy', '{}', '{}', 1);
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

  it('uses evidence and dated legacy credentials as of the immutable capture date, excludes expiration, and leaves an established snapshot unchanged', async () => {
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

    const preserved = await loadFrozenSessionBidPolicy(db, SESSION_ID);
    expect(preserved).toMatchObject({ ok: true });
    if (!preserved.ok || preserved.snapshot.v !== 3) return;
    expect(preserved.snapshot.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ memberId: 1, credentialNames: ['Synthetic EMT'] }),
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
        expect.objectContaining({ memberId: 1, credentialNames: ['Legacy Dated Credential'] }),
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
      expect.arrayContaining([expect.objectContaining({ memberId: 1, credentialNames: [] })]),
    );
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
});
