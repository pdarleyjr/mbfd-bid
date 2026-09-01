import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const key = 'd'.repeat(64);
const sessionId = '01HZZ0000000000000000SESS10';
const actions = [
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
const dispositions = ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'];
async function jwt() {
  return signJwt(
    {
      sub: 42,
      emp: '42',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Operator',
      last_name: 'Test',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    key,
  );
}
function policy(grant: boolean) {
  return {
    v: 3,
    ruleBookVersion: '2026.1',
    ruleBookRevision: 0,
    positionTemplateVersion: '2026.1',
    configurationRevision: 0,
    credentialEvaluationOn: '2026-01-15',
    capturedAtMs: 1,
    settings: {
      v: 3,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-01-15',
      livePolicy: {
        v: 1,
        policyRevision: 'test',
        stages: [
          {
            id: 'D_CAPTAIN',
            label: 'D Captain',
            order: 0,
            memberIds: [42],
            opportunityPositionIds: ['A205'],
            kind: 'CAPTAIN',
          },
        ],
        dispositions: dispositions.map((disposition) => ({
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
        actionPermissions: actions.map((action) => ({
          action,
          actorMemberIds: grant && action === 'force' ? [42] : [99],
        })),
        specialtyCatalogReference: null,
        aDayPolicyReference: null,
        transitionPolicyReference: null,
        publicationPolicyReference: null,
      },
    },
    members: [
      {
        memberId: 42,
        pool: 'FF',
        rscSeniority: 1,
        rankSeniority: null,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
      },
    ],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: '2026.1',
          positionId: 'A205',
          templateVersion: '2026.1',
          requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["rsc_seniority"]',
        },
      ],
      positions: [
        {
          id: 'A205',
          templateVersion: '2026.1',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '2',
          unit: 'Rescue',
          rankRequired: 'FF',
          positionName: 'Rescue',
        },
      ],
    },
  };
}
describe('real force-pick legacy boundary', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      "INSERT INTO bid_years (year,status) VALUES (2026,'live'); INSERT INTO position_templates (version,effective_year) VALUES ('2026.1',2026); INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name) VALUES ('A205','2026.1','A','2','Combat','Rescue','FF','Rescue Firefighter'); INSERT INTO rule_books (version,effective_year,status) VALUES ('2026.1',2026,'active'); INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) VALUES ('2026.1','A205','2026.1','{\"rank\":[\"FF\"],\"credentials\":[],\"custom\":[]}', '{\"max\":0,\"items\":[]}', '[\"rsc_seniority\"]'); INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (42,'42','Operator','Test','FF','FF',1,0,1,1); INSERT INTO bid_sessions (id,bid_year,started_at,current_phase,turn_timer_seconds,expected_duration_days,day_count) VALUES ('01HZZ0000000000000000SESS10',2026,1,'position_bid',180,2,1);",
    );
  });
  afterEach(async () => teardownTestD1(h));
  async function request(grant: boolean) {
    await h.db.run(
      'INSERT INTO bid_session_policy_snapshots (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at) VALUES (?,?,?,0,?,1)',
      [sessionId, '2026.1', '2026.1', JSON.stringify(policy(grant))],
    );
    return app.fetch(
      new Request(`http://x/api/admin/bid-session/${sessionId}/force-pick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await jwt()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_id: 42,
          position_id: 'A205',
          reason_code: 'force.cert_mandate',
          reason: 'test reason',
        }),
      }),
      { ...h.env, JWT_SIGNING_KEY: key },
    );
  }
  it('B rejects a missing force grant before mutation', async () => {
    const res = await request(false);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'live_action_forbidden', action: 'force' });
    expect(
      (await h.db.run('SELECT count(*) AS n FROM bids WHERE bid_session_id=?', [sessionId]))
        .results,
    ).toEqual([{ n: 0 }]);
  });
  it('A rejects an authorized legacy route with no bid/audit/event/outbox side effects', async () => {
    const res = await request(true);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: 'canonical_live_command_required',
      command: 'live.force_selection',
    });
    for (const table of ['bids', 'audit_log', 'bid_command_events', 'bid_audit_outbox'])
      expect(
        (await h.db.run(`SELECT count(*) AS n FROM ${table} WHERE bid_session_id=?`, [sessionId]))
          .results,
      ).toEqual([{ n: 0 }]);
  });
});
