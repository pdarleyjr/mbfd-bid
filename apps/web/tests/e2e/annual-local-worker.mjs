import { createServer } from 'node:http';
import { syntheticAdminRead } from './synthetic-admin-read-fixtures.mjs';
import { syntheticPolicyDocument } from './synthetic-policy-document.mjs';

const port = 31987;
let sequence = 3;
const contactHistory = [];
const staffingReceipts = new Map();
const staffingSeats = [];

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function bidder(memberId, firstName, lastName, ordinal) {
  return {
    memberId,
    ordinal,
    pool: 'FF',
    firstName,
    lastName,
    rank: 'FF',
    employeeId: String(9000 + memberId),
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const fixture = request.method === 'GET' ? syntheticAdminRead(url.pathname) : null;
  if (fixture) {
    json(response, fixture.status, fixture.body);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/current-roster') {
    json(response, 200, {
      asOf: url.searchParams.get('as_of') ?? '2027-01-01',
      administrativeAssignmentPolicy: {
        status: 'unconfigured',
        bidYear: 2027,
        ruleBookVersion: null,
      },
      positions: staffingSeats,
      summary: {
        totalPositions: staffingSeats.length,
        occupiedPositions: 0,
        vacantPositions: staffingSeats.length,
        administrativelyAssignedNonBiddablePositions: 0,
      },
      unassignedMembers: [],
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/personnel/changes') {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        json(response, 400, { error: 'invalid_fixture_json' });
        return;
      }
      const seat = body.staffing_position;
      if (
        body.kind !== 'POSITION_CREATE' ||
        seat?.station !== '7' ||
        seat?.unit !== 'Synthetic Engine 7'
      ) {
        json(response, 400, { error: 'synthetic_staffing_fixture_only' });
        return;
      }
      const key = request.headers['idempotency-key'];
      if (!key) {
        json(response, 400, { error: 'idempotency_key_required' });
        return;
      }
      const prior = staffingReceipts.get(key);
      if (prior && prior !== raw) {
        json(response, 409, { error: 'idempotency_key_reused' });
        return;
      }
      if (!prior) {
        staffingReceipts.set(key, raw);
        staffingSeats.push({
          id: seat.id,
          stableSlotKey: seat.stable_slot_key,
          division: seat.division,
          shift: seat.shift,
          station: seat.station,
          unit: seat.unit,
          positionName: seat.position_name,
          applicableRank: seat.applicable_rank,
          occupancy: 'vacant',
          administrativeAssignment: false,
          assignment: null,
          member: null,
        });
      }
      json(response, prior ? 200 : 201, {
        replayed: Boolean(prior),
        event: { id: 'synthetic-seat-receipt', kind: body.kind },
      });
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/annual-policy-documents/2088') {
    json(response, 200, { documents: [syntheticPolicyDocument] });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/me') {
    json(response, 200, { memberId: 1 });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/board') {
    json(response, 200, {
      bidSessionId: 'annual-specialty-e2e',
      lastSeq: sequence,
      currentPhase: 'position_bid',
      currentBidderId: 1,
      currentBidder: bidder(1, 'Alex', 'Original', 1),
      onDeck: [bidder(2, 'Jordan', 'Candidate', 2)],
      members: {
        1: { id: 1, firstName: 'Alex', lastName: 'Original', rank: 'FF', employeeId: '9001' },
        2: { id: 2, firstName: 'Jordan', lastName: 'Candidate', rank: 'FF', employeeId: '9002' },
      },
      fills: {},
      bidOrder: [
        { ordinal: 1, memberId: 1, pool: 'FF' },
        { ordinal: 2, memberId: 2, pool: 'FF' },
      ],
      bidOrderPreview: false,
      isMock: false,
      mockControlRevision: null,
      sessionStartedAt: Date.now() - 60_000,
      turnStartedAtMs: Date.now(),
      turnTimerSeconds: 180,
      positions: [
        {
          id: 'A101',
          templateVersion: '2027.1',
          bidParticipation: 'BIDDABLE',
          shift: 'A',
          station: '1',
          unit: 'Marine 1',
          rankRequired: 'FF',
          positionName: 'Marine Firefighter',
        },
      ],
      annual: null,
      advisory: {
        v: 1,
        determinationSource: 'authoritative_bid_state',
        sessionId: 'annual-specialty-e2e',
        sequence,
        ruleBookVersion: '2027.1',
        positionTemplateVersion: '2027.1',
        configurationRevision: 1,
        cards: [
          {
            kind: 'bid_state',
            severity: 'ready',
            title: 'Bid state',
            summary: `Position bidding is active at sequence ${sequence}. Alex Original (order 1) is the current bidder.`,
            sources: ['canonical_session_state', 'frozen_policy_snapshot'],
          },
        ],
      },
    });
    return;
  }
  if (
    request.method === 'GET' &&
    url.pathname === '/api/admin/bid-session/annual-specialty-e2e/specialty-live'
  ) {
    json(response, 200, {
      bid_session_id: 'annual-specialty-e2e',
      sequence,
      current_bidder: { member_id: 1, first_name: 'Alex', last_name: 'Original', rank: 'FF' },
      remaining_order: [1, 2],
      fills: {},
      specialties: [
        {
          id: 'marine',
          label: 'Marine',
          mode: 'INTERRUPTING',
          positions: [{ id: 'A101', label: '1 Marine 1 Marine Firefighter' }],
        },
      ],
      active: {
        specialty_id: 'marine',
        specialty_label: 'Marine',
        requested_position_id: 'A101',
        original_bidder: {
          member_id: 1,
          first_name: 'Alex',
          last_name: 'Original',
          rank: 'FF',
          points: 3,
          policy_rank: 2,
        },
        candidates: [
          {
            member_id: 2,
            first_name: 'Jordan',
            last_name: 'Candidate',
            rank: 'FF',
            points: 8,
            policy_rank: 1,
            status: 'CURRENT',
            contact_history: contactHistory,
          },
        ],
        current_candidate_id: 2,
        remaining_candidate_ids: [2],
        suspended_turn: true,
        resume: { member_id: 1, queue_cursor: 0, current_phase: 'position_bid' },
      },
    });
    return;
  }
  if (
    request.method === 'POST' &&
    url.pathname === '/api/admin/bid-session/annual-specialty-e2e/commands/live'
  ) {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const command = JSON.parse(raw);
      sequence += 1;
      if (command.type === 'live.record_contact_attempt') {
        contactHistory.push({ method: command.method, at_ms: Date.now(), actor_member_id: 901 });
      }
      json(response, 200, { kind: 'accepted', commandId: command.commandId, seq: sequence });
    });
    return;
  }
  json(response, 404, { error: 'annual_local_worker_route_not_found' });
});

server.listen(port, '127.0.0.1');

function close() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
