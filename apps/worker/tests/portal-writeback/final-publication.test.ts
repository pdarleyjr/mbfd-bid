import { PortalPayloadSchema } from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signJwt } from '../../src/lib/jwt.js';
import { claimFinalMessage } from '../../src/portal-writeback/final-outbox.js';
import { previewFinalPublication } from '../../src/portal-writeback/final-preview.js';
import {
  FINAL_WORKBOOK_SHA256,
  type FinalPublicationBody,
  type FinalSourceRow,
  RETAINED_POSITION_IDS,
  buildFinalPortalPayload,
} from '../../src/portal-writeback/final-source.js';
import { postBidAssignment } from '../../src/portal-writeback/portal-client.js';
import { handlePortalQueueBatch } from '../../src/portal-writeback/queue-handler.js';
import portal from '../../src/routes/admin/portal.js';
import { type TestD1, setupTestD1, teardownTestD1 } from '../integration/helpers/test-d1.js';

const mocks = vi.hoisted(() => ({
  official: vi.fn(),
  result: vi.fn(),
  canonical: vi.fn(),
  retained: vi.fn(),
}));
vi.mock('../../src/lib/official-annual-completion.js', () => ({
  loadOfficialAnnualCompletion: mocks.official,
}));
vi.mock('../../src/lib/bid-result-package.js', () => ({
  loadCanonicalBidResultPackage: mocks.result,
}));
vi.mock('../../src/commands/canonical-command-service.js', () => ({
  loadCanonicalBidSessionState: mocks.canonical,
}));
vi.mock('../../src/lib/frozen-nonbid-assignments.js', () => ({
  projectFrozenNonBidAssignments: mocks.retained,
}));

const SID = 'synthetic-final-2026';
const RESULT_HASH = 'a'.repeat(64);
const NOW = 1791291600000;
function fixture() {
  const rows: FinalSourceRow[] = [];
  const rankCode: Record<string, string> = {
    Captain: 'CPT',
    Lieutenant: 'LT',
    Firefighter: 'FF',
    'Division Chief': 'DC',
  };
  const days = ['G1', 'G2', 'G3', 'G4', 'MON', 'FRI'] as const;
  const dayLabels = ['Group 1', 'Group 2', 'Group 3', 'Group 4', 'Monday', 'Friday'];
  const dayEnds = [55, 108, 161, 214, 217, 218];
  for (let i = 0; i < 218; i++) {
    const shift = i < 71 ? 'A' : i < 143 ? 'B' : i < 214 ? 'C' : 'D';
    const offset = i < 71 ? i : i < 143 ? i - 71 : i < 214 ? i - 143 : i - 214;
    const group = dayEnds.findIndex((end) => i < end);
    const unit =
      i === 0 ? 'Captain 5' : i === 1 ? 'Combat Float' : i === 2 ? 'Rescue Float' : 'Combat 1';
    rows.push({
      source_worksheet: 'Bid Pick',
      source_row: i + 2,
      employee_id: `synthetic-${i + 1}`,
      position_id: `${shift}${offset + 100}`,
      rank_label: i < 20 ? 'Captain' : i < 58 ? 'Lieutenant' : 'Firefighter',
      shift_label: `${shift} Shift` as FinalSourceRow['shift_label'],
      station_label: 'Station #1',
      division_label: 'Combat',
      unit_label: unit,
      bid_selection_label: unit,
      position_label: i === 1 ? 'Firefighter DE #2' : 'Firefighter #1',
      assignment_type: 'Assigned',
      assignment_source: 'bid_award',
      a_day_code: days[group] ?? 'G1',
      a_day_label: dayLabels[group] ?? 'Group 1',
    });
  }
  for (const [i, id] of RETAINED_POSITION_IDS.entries())
    rows.push({
      source_worksheet: 'Bid Pick',
      source_row: 220 + i,
      employee_id: `synthetic-retained-${i}`,
      position_id: id,
      rank_label: 'Division Chief',
      shift_label: `${id[0]} Shift` as FinalSourceRow['shift_label'],
      station_label: 'Station #2',
      division_label: 'Combat',
      unit_label: '300',
      bid_selection_label: '300',
      position_label: 'Division Chief',
      assignment_type: 'Assigned',
      assignment_source: 'retained_nonbiddable',
      a_day_code: 'G3',
      a_day_label: 'Group 3',
    });
  const identities = rows.map((row, index) => ({
    memberId: index + 1,
    employeeId: row.employee_id,
    rank: rankCode[row.rank_label],
    firstName: 'Synthetic',
    lastName: 'Fixture',
  }));
  const positions = rows.map((row) => ({
    id: row.position_id,
    shift: row.shift_label[0],
    station: row.station_label,
    division: row.division_label,
    unit: row.unit_label,
    positionName: row.position_label,
    isFloating: false,
    bidParticipation:
      row.assignment_source === 'bid_award' ? 'BIDDABLE' : 'ADMIN_ASSIGNED_NON_BIDDABLE',
  }));
  const fills = Object.fromEntries(
    rows
      .slice(0, 218)
      .map((row, index) => [
        row.position_id,
        { memberId: index + 1, bidId: `bid-${index}`, ordinal: index + 1 },
      ]),
  );
  const state = {
    bidSessionId: SID,
    lastSeq: 300,
    currentPhase: 'complete',
    fills,
    live: { withdrawnPositionIds: ['A718', 'B718', 'C718'] },
  };
  const body: FinalPublicationBody = {
    workbook_sha256: FINAL_WORKBOOK_SHA256,
    expected_sequence: 300,
    expected_result_hash: RESULT_HASH,
    hub_identity_receipt_sha256: 'b'.repeat(64),
    hub_matched_employee_ids: rows.map((row) => row.employee_id),
    rows,
  };
  const official = {
    ok: true,
    snapshot: { v: 3, operatorIdentityProjection: identities, ruleBookMaterial: { positions } },
    completion: {
      participants: rows.slice(0, 218).map((row, index) => ({
        memberId: index + 1,
        positionId: row.position_id,
        aDay: row.a_day_code,
      })),
    },
  };
  return { body, official, state };
}

describe('final assignment publication', () => {
  let h: TestD1;
  let data: ReturnType<typeof fixture>;
  beforeEach(async () => {
    h = await setupTestD1();
    data = fixture();
    mocks.official.mockResolvedValue(data.official);
    mocks.result.mockResolvedValue({
      ok: true,
      document: { bidYear: 2026 },
      packageSha256: RESULT_HASH,
    });
    mocks.canonical.mockResolvedValue(data.state);
    mocks.retained.mockReturnValue(
      new Map(
        data.body.rows.slice(218).map((row, index) => [row.position_id, { memberId: index + 219 }]),
      ),
    );
    h.sqlite.exec(`INSERT INTO bid_years(year,status) VALUES(2026,'live');
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,employment_status,created_at,updated_at)
      VALUES(900001,'operator','Synthetic','Operator','CHIEF','EXCLUDED',0,0,'inactive',0,0);
      INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,turn_timer_seconds,expected_duration_days,day_count,is_mock)
      VALUES('${SID}',2026,0,'complete',180,2,1,0);
      INSERT INTO rule_books(version,effective_year,revision) VALUES('synthetic-final',2026,0);
      INSERT INTO bid_session_policy_snapshots(bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
      VALUES('${SID}','synthetic-final','synthetic-final',0,'{"v":3,"ruleBookRevision":0}',0);`);
    h.sqlite
      .prepare(`INSERT INTO canonical_bid_session_state(bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at)
      VALUES(?,83,?,'command-0',0,0)`)
      .run(SID, JSON.stringify({ ...data.state, lastSeq: 83 }));
    const receipt =
      h.sqlite.prepare(`INSERT INTO bid_command_receipts(command_id,bid_session_id,command_type,request_sha256,actor_id,expected_seq,result_seq,outcome,result_json,created_at)
      VALUES(?,?,'live.pick',?,900001,?,?,'accepted','{}',?)`);
    const event =
      h.sqlite.prepare(`INSERT INTO bid_command_events(id,bid_session_id,command_id,audit_log_id,seq,event_type,event_json,actor_id,created_at)
      VALUES(?,?,?,? ,?,'live_command_applied',?,900001,?)`);
    for (const [i, row] of data.body.rows.slice(0, 218).entries()) {
      if (i > 0)
        h.sqlite
          .prepare(
            'UPDATE canonical_bid_session_state SET current_seq=?,state_json=?,last_command_id=? WHERE bid_session_id=?',
          )
          .run(83 + i, JSON.stringify({ ...data.state, lastSeq: 83 + i }), `command-${i}`, SID);
      receipt.run(`command-${i}`, SID, RESULT_HASH, 82 + i, 83 + i, NOW + i);
      h.sqlite
        .prepare(
          "INSERT INTO audit_log(id,bid_session_id,seq,actor_type,actor_id,action,created_at) VALUES(?,? ,?,'admin',900001,'pick',?)",
        )
        .run(`audit-${i}`, SID, 83 + i, Math.floor((NOW + i) / 1000));
      event.run(
        `event-${i}`,
        SID,
        `command-${i}`,
        `audit-${i}`,
        83 + i,
        JSON.stringify({
          bidId: `bid-${i}`,
          memberId: i + 1,
          positionId: row.position_id,
          operation: 'pick',
        }),
        NOW + i,
      );
    }
  });
  afterEach(async () => {
    await teardownTestD1(h);
    vi.clearAllMocks();
  });
  const env = () => ({
    ...h.env,
    ENV: 'production' as const,
    PORTAL_WRITEBACK_ENABLED: 'true' as const,
    PORTAL_WRITEBACK_BASE_URL: 'https://receiver.example',
    PORTAL_BID_WRITER: 'synthetic-test-writer',
    PORTAL_QUEUE: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as TestD1['env']['PORTAL_QUEUE'],
  });
  async function request(
    operation: string,
    body: FinalPublicationBody,
    enabled = true,
    withQueue = true,
  ) {
    const runtime = env();
    if (!withQueue) Reflect.deleteProperty(runtime, 'PORTAL_QUEUE');
    if (!enabled) runtime.PORTAL_WRITEBACK_ENABLED = 'false' as 'true';
    const token = await signJwt(
      {
        sub: 900001,
        emp: 'operator',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Operator',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      runtime.JWT_SIGNING_KEY,
    );
    return new Hono().route('/api/admin', portal).request(
      `/api/admin/portal-final/${SID}/${operation}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      runtime,
    );
  }
  it('preserves exact V2 selection/seat and keeps retained timestamps null', async () => {
    const preview = await previewFinalPublication(h.env.DB, SID, data.body);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.payloads[1]).toMatchObject({
      payload_version: 2,
      unit_label: 'Combat Float',
      bid_selection_label: 'Combat Float',
      position_label: 'Firefighter DE #2',
      a_day_code: 'G1',
      a_day_label: 'Group 1',
      picked_at: new Date(NOW + 1).toISOString(),
    });
    expect(
      preview.payloads.filter((p) => p.assignment_source === 'retained_nonbiddable'),
    ).toHaveLength(8);
    expect(preview.payloads.slice(218).every((p) => p.picked_at === null && !p.is_forced)).toBe(
      true,
    );
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM bids').get()).toEqual({ n: 0 });
  });
  it('preview writes nothing while publication is disabled', async () => {
    const before = h.sqlite.prepare('SELECT COUNT(*) n FROM audit_log').get();
    const response = await request('preview', data.body, false);
    expect(response.status).toBe(200);
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM final_portal_outbox').get()).toEqual({ n: 0 });
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM audit_log').get()).toEqual(before);
  });
  it('requires publication policy and exact confirmation then publishes twice without duplicate assignments', async () => {
    expect((await request('publish', data.body, false)).status).toBe(409);
    expect((await request('publish', data.body)).status).toBe(400);
    data.body.confirmation_phrase = `PUBLISH FINAL 2026–2027 ${SID} 300`;
    expect((await request('publish', data.body)).status).toBe(200);
    expect((await request('publish', data.body)).status).toBe(200);
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM final_portal_outbox').get()).toEqual({
      n: 226,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM final_portal_publications').get()).toEqual({
      n: 1,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM bids').get()).toEqual({ n: 0 });
  });
  it('rejects publication before any write if the dedicated queue binding is absent', async () => {
    data.body.confirmation_phrase = `PUBLISH FINAL 2026–2027 ${SID} 300`;
    expect((await request('publish', data.body, true, false)).status).toBe(503);
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM final_portal_publications').get()).toEqual({
      n: 0,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM final_portal_outbox').get()).toEqual({ n: 0 });
  });
  it('rejects Mock, unfinished and incomplete canonical results before queuing', async () => {
    mocks.official.mockResolvedValueOnce({ ok: false, error: 'mock_session_not_transitionable' });
    expect((await request('preview', data.body)).status).toBe(409);
    mocks.official.mockResolvedValueOnce({ ok: false, error: 'annual_completion_required' });
    expect((await request('preview', data.body)).status).toBe(409);
    data.official.completion.participants.pop();
    expect((await request('publish', data.body)).status).toBe(409);
  });
  it('rejects invented award times, label overrides, open awards and lost withdrawals', async () => {
    const row = data.body.rows[0];
    if (!row) throw new Error('Fixture row missing');
    const fill = data.state.fills[row.position_id];
    if (!fill) throw new Error('Fixture fill missing');
    const bidId = fill.bidId;
    fill.bidId = 'no-accepted-award-event';
    const missingClock = await previewFinalPublication(h.env.DB, SID, data.body);
    expect(missingClock.ok).toBe(false);
    if (!missingClock.ok)
      expect(missingClock.issues).toContain(`canonical_award_timestamp_required:${row.source_row}`);
    fill.bidId = bidId;
    row.position_label = 'Invented Engine';
    expect((await previewFinalPublication(h.env.DB, SID, data.body)).ok).toBe(false);
    row.frozen_position_label = 'Firefighter #1';
    row.metadata_override_reason = 'Reviewed exact workbook final seat description.';
    expect((await previewFinalPublication(h.env.DB, SID, data.body)).ok).toBe(true);
    data.state.live.withdrawnPositionIds = [];
    expect((await previewFinalPublication(h.env.DB, SID, data.body)).ok).toBe(false);
    data.state.live.withdrawnPositionIds = ['A718', 'B718', 'C718'];
    row.position_id = 'A717';
    expect((await previewFinalPublication(h.env.DB, SID, data.body)).ok).toBe(false);
  });
  it('batch audit failure rolls back the entire publication', async () => {
    data.body.confirmation_phrase = `PUBLISH FINAL 2026–2027 ${SID} 300`;
    h.failNextBatchAt(3);
    expect((await request('publish', data.body)).status).toBe(500);
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM final_portal_publications').get()).toEqual({
      n: 0,
    });
    expect(h.sqlite.prepare('SELECT COUNT(*) n FROM final_portal_outbox').get()).toEqual({ n: 0 });
  });
  it('claims once, refuses altered queue payloads and supersedes stale canonical results', async () => {
    data.body.confirmation_phrase = `PUBLISH FINAL 2026–2027 ${SID} 300`;
    await request('publish', data.body);
    const row = h.sqlite.prepare('SELECT * FROM final_portal_outbox LIMIT 1').get() as {
      id: string;
      payload_json: string;
      publication_id: string;
      employee_id: string;
    };
    const msg = {
      bidId: row.id,
      queueRowId: row.id,
      employeeId: row.employee_id,
      payload: PortalPayloadSchema.parse(JSON.parse(row.payload_json)),
      attempts: 0,
      finalPublicationId: row.publication_id,
    };
    expect(await claimFinalMessage(h.env, msg, Date.now())).toBe('claimed');
    expect(await claimFinalMessage(h.env, msg, Date.now())).toBe('skip');
    h.sqlite.prepare("UPDATE final_portal_outbox SET status='queued' WHERE id=?").run(row.id);
    expect(await claimFinalMessage(h.env, { ...msg, employeeId: 'wrong-member' }, Date.now())).toBe(
      'retry',
    );
    const next = { ...data.state, lastSeq: 301 };
    h.sqlite
      .prepare(
        'UPDATE canonical_bid_session_state SET current_seq=301,state_json=? WHERE bid_session_id=?',
      )
      .run(JSON.stringify(next), SID);
    expect(await claimFinalMessage(h.env, msg, Date.now())).toBe('skip');
    expect(
      h.sqlite.prepare('SELECT status FROM final_portal_outbox WHERE id=?').get(row.id),
    ).toEqual({ status: 'superseded' });
  });
  it('unsupported V2 and retained synthetic pick provenance cannot fall through to V1', () => {
    const row = data.body.rows[218];
    if (!row) throw new Error('Retained fixture row missing');
    const payload = buildFinalPortalPayload({
      row,
      sessionId: SID,
      sequence: 300,
      resultHash: RESULT_HASH,
      pickedAt: null,
      forcedActorEmployeeId: null,
    });
    expect(PortalPayloadSchema.safeParse({ ...payload, payload_version: 3 }).success).toBe(false);
    expect(
      PortalPayloadSchema.safeParse({ ...payload, picked_at: new Date(NOW).toISOString() }).success,
    ).toBe(false);
  });
  it('delivers retained assignments through the existing queue without writing a bid and recognizes exact duplicate receipts', async () => {
    data.body.confirmation_phrase = `PUBLISH FINAL 2026–2027 ${SID} 300`;
    await request('publish', data.body);
    const row = h.sqlite
      .prepare(
        "SELECT * FROM final_portal_outbox WHERE assignment_source='retained_nonbiddable' LIMIT 1",
      )
      .get() as { id: string; employee_id: string; publication_id: string; payload_json: string };
    const msg = {
      bidId: row.id,
      queueRowId: row.id,
      employeeId: row.employee_id,
      finalPublicationId: row.publication_id,
      payload: PortalPayloadSchema.parse(JSON.parse(row.payload_json)),
      attempts: 0,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'already_recorded' }), { status: 409 }),
      );
    vi.stubGlobal('fetch', fetcher);
    const ack = vi.fn();
    const retry = vi.fn();
    try {
      await handlePortalQueueBatch(
        { messages: [{ body: msg, ack, retry }] } as unknown as Parameters<
          typeof handlePortalQueueBatch
        >[0],
        env(),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(ack).toHaveBeenCalledOnce();
      expect(retry).not.toHaveBeenCalled();
      expect(
        h.sqlite.prepare('SELECT status FROM final_portal_outbox WHERE id=?').get(row.id),
      ).toEqual({ status: 'done' });
      expect(h.sqlite.prepare('SELECT COUNT(*) n FROM bids').get()).toEqual({ n: 0 });
      await handlePortalQueueBatch(
        { messages: [{ body: msg, ack, retry }] } as unknown as Parameters<
          typeof handlePortalQueueBatch
        >[0],
        env(),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      const conflict = await postBidAssignment({
        employeeId: row.employee_id,
        payload: msg.payload,
        portalBaseUrl: 'https://receiver.example',
        publicationEnabled: true,
        token: 'synthetic-test-writer',
        fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 409 })),
      });
      expect(conflict.kind).toBe('permanent');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
