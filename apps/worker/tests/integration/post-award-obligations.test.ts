import type { PostAwardObligation } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { loadPostAwardObligations } from '../../src/lib/post-award-obligations.js';
import { seedSyntheticOfficialCompletion } from './helpers/synthetic-official-completion.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
const term: PostAwardObligation = {
  id: 'training-qualification',
  credential: 'Synthetic training',
  sourceRef: 'Synthetic obligation source',
  deadline: {
    basis: 'FINAL_POSITION_AWARD',
    unit: 'CALENDAR_MONTHS',
    count: 3,
    timeZone: 'America/New_York',
  },
};
describe('official post-award obligations', () => {
  let h: TestD1;
  let token: string;
  const body = {
    final_bid_id: 'award-final',
    obligation_id: term.id,
    expected_revision: 0,
    expected_completion_seq: 12,
    effective_on: '2027-04-20',
    status: 'COMPLETED',
    completed_on: '2027-04-19',
    source_ref: 'Synthetic training completion evidence',
    reason: 'Synthetic reviewed completion',
  };
  const request = (value: unknown, key: string) =>
    app.fetch(
      new Request('http://x/api/admin/post-award-obligations/annual-real-2027/reviews', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(value),
      }),
      h.env,
    );
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    token = await signJwt(
      {
        sub: 99,
        emp: 'synthetic-reviewer',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Reviewer',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      h.env.JWT_SIGNING_KEY,
    );
  });
  afterEach(async () => teardownTestD1(h));
  it('uses the frozen approved bid start instead of substituting the final award date', async () => {
    seedSyntheticOfficialCompletion(h, [
      {
        ...term,
        deadline: { ...term.deadline, basis: 'APPROVED_BID_START_DATE', startOn: '2027-01-01' },
      },
    ]);
    expect(
      await loadPostAwardObligations(h.env.DB, 'annual-real-2027', '2027-04-20'),
    ).toMatchObject({
      ok: true,
      obligations: [
        {
          dueOn: '2027-04-01',
          status: 'PAST_DUE_REVIEW_REQUIRED',
          term: { deadline: { basis: 'APPROVED_BID_START_DATE', startOn: '2027-01-01' } },
          award: { eventId: 'synthetic-award-event' },
        },
      ],
    });
    expect((await request(body, 'approved-start-completion')).status).toBe(201);
    expect(
      await loadPostAwardObligations(h.env.DB, 'annual-real-2027', '2027-04-20'),
    ).toMatchObject({
      obligations: [
        { status: 'COMPLETED', completionTiming: 'AFTER_DEADLINE', dueOn: '2027-04-01' },
      ],
    });
  });
  it('uses the final amended award clock and immutable frozen terms; retries and dated corrections preserve history', async () => {
    seedSyntheticOfficialCompletion(h, [term]);
    const initial = await loadPostAwardObligations(h.env.DB, 'annual-real-2027', '2027-05-01');
    expect(initial).toMatchObject({
      ok: true,
      obligations: [
        {
          finalBidId: 'award-final',
          dueOn: '2027-04-30',
          status: 'PAST_DUE_REVIEW_REQUIRED',
          award: { eventId: 'synthetic-award-event' },
          latestRevision: 0,
        },
      ],
    });
    const first = await request(body, 'complete');
    expect(first.status).toBe(201);
    const saved = await first.json();
    expect(await (await request(body, 'complete')).json()).toEqual({
      ...(saved as object),
      replayed: true,
    });
    expect((await request({ ...body, completed_on: '2027-04-18' }, 'complete')).status).toBe(409);
    expect(
      await loadPostAwardObligations(h.env.DB, 'annual-real-2027', '2027-04-19'),
    ).toMatchObject({ obligations: [{ status: 'PENDING', review: null, latestRevision: 1 }] });
    expect(
      await loadPostAwardObligations(h.env.DB, 'annual-real-2027', '2027-04-20'),
    ).toMatchObject({
      obligations: [
        { status: 'COMPLETED', completionTiming: 'ON_TIME', review: { completedOn: '2027-04-19' } },
      ],
    });
    expect(
      (
        await request(
          {
            ...body,
            expected_revision: 1,
            effective_on: '2027-05-02',
            status: 'UNKNOWN',
            completed_on: null,
          },
          'corrected',
        )
      ).status,
    ).toBe(201);
    expect(
      await loadPostAwardObligations(h.env.DB, 'annual-real-2027', '2027-05-03'),
    ).toMatchObject({
      obligations: [
        { status: 'UNKNOWN', latestRevision: 2, history: [{ revision: 2 }, { revision: 1 }] },
      ],
    });
    expect((await request(body, 'stale')).status).toBe(409);
    expect(() =>
      h.sqlite.prepare("UPDATE post_award_obligation_reviews SET status='PENDING'").run(),
    ).toThrow(/immutable/);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('leaves missing canonical award evidence unknown and refuses fabricated reviews or Mock sources', async () => {
    seedSyntheticOfficialCompletion(h, [term], false);
    expect(
      await loadPostAwardObligations(h.env.DB, 'annual-real-2027', '2027-05-01'),
    ).toMatchObject({
      obligations: [{ award: null, dueOn: null, status: 'AWARD_EVIDENCE_UNKNOWN' }],
    });
    expect((await request(body, 'missing-clock')).status).toBe(409);
    expect(await loadPostAwardObligations(h.env.DB, 'mock-newer', '2027-05-01')).toMatchObject({
      ok: false,
      error: 'mock_session_not_transitionable',
    });
  });
  it('rolls back an audit failure and rejects unknown obligations, superseded awards and changed completion revisions', async () => {
    seedSyntheticOfficialCompletion(h, [term]);
    h.failNextBatchAt(1);
    expect((await request(body, 'retry')).status).toBe(409);
    expect(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM post_award_obligation_reviews').get(),
    ).toEqual({ n: 0 });
    expect((await request(body, 'retry')).status).toBe(201);
    expect((await request({ ...body, obligation_id: 'invented' }, 'invented')).status).toBe(409);
    expect(
      (await request({ ...body, final_bid_id: 'award-superseded' }, 'superseded')).status,
    ).toBe(409);
    expect(
      (await request({ ...body, expected_revision: 1, expected_completion_seq: 13 }, 'completion'))
        .status,
    ).toBe(409);
  });
});
