import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  LiveBidActionSchema,
  type PostAwardObligation,
} from '@mbfd/shared';
import { syntheticAnnualCompletionSource } from '../../fixtures/synthetic-annual-completion.js';
import type { TestD1 } from './test-d1.js';
// Synthetic persistence fixture only; not a replay or accepted operational session.
export function seedSyntheticOfficialCompletion(
  h: TestD1,
  postAward: PostAwardObligation[],
  withAwardEvent = true,
) {
  const original = syntheticAnnualCompletionSource();
  if (!original.state.annual?.completion) throw new Error('Synthetic completion missing');
  const completedAtMs = Date.parse('2027-02-01T18:00:00Z');
  const source = {
    ...original,
    completion: { ...original.completion, completedAtMs },
    state: {
      ...original.state,
      annual: {
        ...original.state.annual,
        completion: {
          ...original.state.annual.completion,
          readyForFinalizationAtMs: completedAtMs,
        },
      },
    },
  };
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
        requiredCriteriaJson: JSON.stringify({
          rank: ['FF'],
          credentials: [],
          custom: [],
          ...(p.id === 'P-RESCUE-1' ? { postAward } : {}),
        }),
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

  h.sqlite.exec(
    "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (99,'synthetic-reviewer','Synthetic','Reviewer','FF','FF',99,0,1,1)",
  );
  const insertState = h.sqlite.prepare(
    'INSERT INTO canonical_bid_session_state (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at) VALUES (?,?,?,?,1,1)',
  );
  if (withAwardEvent) {
    const awardedAt = Date.parse('2027-01-31T18:00:00Z');
    insertState.run(
      source.session.id,
      11,
      JSON.stringify({ ...source.state, lastSeq: 11 }),
      'synthetic-award-command',
    );
    h.sqlite
      .prepare(
        "INSERT INTO bid_command_receipts (command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at) VALUES ('synthetic-award-command',?,'live.amend_selection',?,99,10,11,'accepted','{}',?)",
      )
      .run(source.session.id, 'b'.repeat(64), awardedAt);
    h.sqlite
      .prepare(
        "INSERT INTO audit_log (id,bid_session_id,seq,actor_type,actor_id,action,reason,created_at) VALUES ('synthetic-award-audit',?,11,'admin',99,'amend_selection','Synthetic award clock fixture',?)",
      )
      .run(source.session.id, Math.floor(awardedAt / 1000));
    h.sqlite
      .prepare(
        "INSERT INTO bid_command_events (id,bid_session_id,command_id,audit_log_id,seq,event_type,event_json,actor_id,created_at) VALUES ('synthetic-award-event',?,'synthetic-award-command','synthetic-award-audit',11,'live_command_applied',?,99,?)",
      )
      .run(
        source.session.id,
        JSON.stringify({
          operation: 'amend_selection',
          replacementBidId: 'award-final',
          supersedesBidId: 'award-superseded',
          memberId: 202,
          toPositionId: 'P-RESCUE-1',
          fromPositionId: 'P-RESCUE-2',
        }),
        awardedAt,
      );
    h.sqlite
      .prepare(
        'UPDATE canonical_bid_session_state SET current_seq=12,state_json=?,last_command_id=? WHERE bid_session_id=?',
      )
      .run(JSON.stringify(source.state), source.completion.commandId, source.session.id);
  } else
    insertState.run(
      source.session.id,
      12,
      JSON.stringify(source.state),
      source.completion.commandId,
    );
  h.sqlite
    .prepare(
      "INSERT INTO bid_command_receipts (command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at) VALUES (?,?,'live.complete_session',?,99,11,12,'accepted','{}',?)",
    )
    .run(
      source.completion.commandId,
      source.session.id,
      'a'.repeat(64),
      source.completion.completedAtMs,
    );
  return source;
}
