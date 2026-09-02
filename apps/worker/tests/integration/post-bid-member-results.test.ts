import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'b'.repeat(64);
let h: TestD1;

async function request(path: string, token: string) {
  return app.fetch(
    new Request(`http://x${path}`, { headers: { Authorization: `Bearer ${token}` } }),
    h.env,
  );
}

beforeEach(async () => {
  h = await setupTestD1();
  const now = Date.now();
  await h.db.run(
    `INSERT INTO bid_years (year, status)
       VALUES (2030, 'closed');
     INSERT INTO members
       (id, employee_id, first_name, last_name, rank, bid_category, rsc_seniority,
        is_probationary, employment_status, created_at, updated_at)
       VALUES (7, '70007', 'Published', 'Member', 'FF', 'FF', 1, 0, 'active', ${now}, ${now}),
              (8, '80008', 'Other', 'Member', 'FF', 'FF', 2, 0, 'active', ${now}, ${now});
     INSERT INTO bid_sessions
       (id, bid_year, started_at, current_phase, turn_timer_seconds, expected_duration_days, day_count)
       VALUES ('annual-2030', 2030, ${now}, 'complete', 180, 2, 1);
     INSERT INTO bid_post_bid_transitions
       (bid_session_id, bid_year, status, policy_version, policy_json, annual_completion_at,
        reviewed_at, reviewed_by_member_id, approved_at, approved_by_member_id, effective_on,
        future_roster_json, published_at, published_by_member_id, updated_at)
       VALUES ('annual-2030', 2030, 'PUBLISHED', '2030.1', '{"publication_gates":["APPROVED"]}',
         ${now - 1000}, ${now - 900}, 7, ${now - 800}, 7, '2030-02-01',
         '[{"memberId":7,"employeeId":"70007","memberName":"Published Member","rank":"FF","shift":"A","station":"1","unit":"Engine","position":"Firefighter","positionId":"A101","aDay":"G1","specialty":null,"priorAssignmentPositionId":"OLD","annualSessionId":"annual-2030","annualBidYear":2030,"ruleBookVersion":"2030.1"},{"memberId":8,"employeeId":"80008","memberName":"Other Member","rank":"FF","shift":"B","station":"2","unit":"Truck","position":"Lieutenant","positionId":"B201","aDay":"G2","specialty":null,"priorAssignmentPositionId":null,"annualSessionId":"annual-2030","annualBidYear":2030,"ruleBookVersion":"2030.1"}]',
         ${now}, 7, ${now});`,
  );
});

afterEach(async () => teardownTestD1(h));

describe('member published Post-Bid results', () => {
  it('returns only the caller’s immutable published result', async () => {
    const token = await signJwt(
      {
        sub: 7,
        emp: '70007',
        role: 'member',
        rank: 'FF',
        first_name: 'Published',
        last_name: 'Member',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
    const response = await request('/api/me/post-bid-result?session=annual-2030', token);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      annualSessionId: 'annual-2030',
      annualBidYear: 2030,
      completionAt: expect.any(Number),
      effectiveOn: '2030-02-01',
      publishedAt: expect.any(Number),
      policyVersion: '2030.1',
      ruleBookVersion: '2030.1',
      result: {
        assignment: 'Firefighter',
        positionId: 'A101',
        shift: 'A',
        station: '1',
        unit: 'Engine',
        aDay: 'G1',
        specialty: null,
      },
    });
  });

  it('does not disclose unpublished or another member’s result', async () => {
    const token = await signJwt(
      {
        sub: 9,
        emp: '90009',
        role: 'member',
        rank: 'FF',
        first_name: 'No',
        last_name: 'Result',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
    const response = await request('/api/me/post-bid-result?session=annual-2030', token);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'member_not_in_published_results' });
  });
});
