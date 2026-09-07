import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { syntheticAnnualCompletionSource } from '../fixtures/synthetic-annual-completion.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('verified official board and clone source', () => {
  let h: TestD1;
  let token: string;
  const source = syntheticAnnualCompletionSource();
  const request = (path: string, init: RequestInit = {}) =>
    app.fetch(
      new Request(`http://x/api/admin/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      }),
      h.env,
    );
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    token = await signJwt(
      {
        sub: 0,
        emp: 'synthetic-admin',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
    h.sqlite.exec(`INSERT INTO bid_years (year,status) VALUES (2027,'complete');
      INSERT INTO position_templates (version,effective_year) VALUES ('2027.1',2027);
      INSERT INTO rule_books (version,effective_year,status) VALUES ('2027.1',2027,'active');
      INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,is_mock) VALUES ('annual-real-2027',2027,1,'complete',0),('mock-newer',2027,2,'complete',1);`);
    const livePolicy = {
      v: 1,
      policyRevision: 'synthetic-reviewed-policy',
      stages: [
        {
          id: 'annual',
          label: 'Annual',
          order: 0,
          memberIds: [101, 202],
          opportunityPositionIds: source.frozen.positions.map((p) => p.id),
          kind: 'FIREFIGHTER',
        },
      ],
      dispositions: BidDispositionSchema.options.map((disposition) => ({
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
      actionPermissions: LiveBidActionSchema.options.map((action) => ({
        action,
        actorMemberIds: [99],
      })),
      specialtyCatalogReference: null,
      aDayPolicyReference: null,
      transitionPolicyReference: null,
      publicationPolicyReference: null,
    };
    const snapshot = BidSessionPolicySnapshotSchema.parse({
      v: 3,
      ruleBookVersion: '2027.1',
      ruleBookRevision: 0,
      positionTemplateVersion: '2027.1',
      configurationRevision: 1,
      settings: {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-01',
        livePolicy,
      },
      credentialEvaluationOn: '2027-01-01',
      capturedAtMs: 1000,
      members: [101, 202].map((id) => ({
        memberId: id,
        pool: 'FF',
        rscSeniority: id,
        rankSeniority: null,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
      })),
      operatorIdentityProjection: [101, 202].map((id) => ({
        memberId: id,
        employeeId: `synthetic-${id}`,
        firstName: 'Historical',
        lastName: `Winner ${id}`,
        rank: 'FF',
      })),
      ruleBookMaterial: {
        v: 1,
        positions: source.frozen.positions.map((p) => ({
          id: p.id,
          templateVersion: '2027.1',
          shift: p.shift,
          station: p.station,
          unit: p.unit,
          rankRequired: 'FF',
          positionName: p.position,
          isExcludedFromCount: false,
          bidParticipation: 'BIDDABLE',
          division: 'Combat',
          isFloating: false,
          isVacantByDesign: false,
        })),
        rules: source.frozen.positions.map((p) => ({
          positionId: p.id,
          templateVersion: '2027.1',
          ruleBookVersion: '2027.1',
          requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["points","rsc_seniority"]',
        })),
      },
    });
    h.sqlite
      .prepare(
        `INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at) VALUES ('annual-real-2027','2027.1','2027.1',0,?,1000)`,
      )
      .run(JSON.stringify(snapshot));
    h.sqlite
      .prepare(
        'INSERT INTO canonical_bid_session_state (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at) VALUES (?,12,?,?,1,1)',
      )
      .run(source.session.id, JSON.stringify(source.state), source.completion.commandId);
    h.sqlite
      .prepare(
        `INSERT INTO bid_command_receipts (command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at) VALUES (?,'annual-real-2027','live.complete_session',?,99,11,12,'accepted','{}',1)`,
      )
      .run(source.completion.commandId, 'a'.repeat(64));
  });
  afterEach(async () => teardownTestD1(h));

  it('projects frozen seats and names independently of current catalogs and excludes an explicit Mock', async () => {
    h.sqlite.exec(
      `INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (101,'synthetic-101','Renamed','Current Person','FF','FF',101,0,1,1)`,
    );
    const result = await request('bid-board?view=previous&shift=A');
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      view: 'previous',
      lifecycle: 'COMPLETE',
      source: { sessionId: 'annual-real-2027', completionRevision: 12 },
      seats: [
        {
          station: '1',
          award: { memberId: 101, name: 'Historical Winner 101', nameSource: 'frozen' },
          aDay: 'G1',
        },
      ],
    });
    expect(
      await (await request('bid-board?view=previous&session=mock-newer')).json(),
    ).toMatchObject({ lifecycle: 'UNAVAILABLE', seats: [] });
    expect(await (await request('annual-plan/official-sources')).json()).toMatchObject({
      sources: [{ sessionId: 'annual-real-2027', year: 2027 }],
    });
  });

  it('copies frozen topology and rules into a new year without current occupants or live grants', async () => {
    const response = await request('annual-plan', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'synthetic-clone' },
      body: JSON.stringify({
        year: 2028,
        effective_on: '2028-01-01',
        credential_evaluation_on: '2027-12-01',
        expected_duration_days: 2,
        turn_timer_seconds: 180,
        source_session_id: 'annual-real-2027',
        reason: 'Synthetic source clone verification',
      }),
    });
    expect(response.status).toBe(201);
    const clone = (await response.json()) as { templateVersion: string; ruleBookVersion: string };
    expect(
      h.sqlite
        .prepare('SELECT COUNT(*) AS count FROM positions WHERE template_version = ?')
        .get(clone.templateVersion),
    ).toEqual({ count: 3 });
    expect(
      h.sqlite
        .prepare('SELECT COUNT(*) AS count FROM position_rules WHERE rule_book_version = ?')
        .get(clone.ruleBookVersion),
    ).toEqual({ count: 3 });
    expect(await (await request('bid-board?view=upcoming&year=2028&shift=A')).json()).toMatchObject(
      { lifecycle: 'DRAFT', seats: [{ participation: 'BIDDABLE', mapping: 'review_required' }] },
    );
    const year = h.sqlite.prepare('SELECT config_json FROM bid_years WHERE year=2028').get() as {
      config_json: string;
    };
    expect(JSON.parse(year.config_json).livePolicy).toBeUndefined();
    expect(() =>
      h.sqlite
        .prepare("UPDATE rule_books SET status='active' WHERE version=?")
        .run(clone.ruleBookVersion),
    ).toThrow('managed annual plan requires completed Mock freeze');
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
