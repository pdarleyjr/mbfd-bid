import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '../../src/db/index.js';
import { acceptAuthoritativeStaffingBaseline } from '../../src/lib/authoritative-staffing-baseline-acceptance.js';
import { evaluateTeleStaffImportCompleteness } from '../../src/lib/authoritative-staffing-baseline.js';
import {
  SYNTHETIC_BASELINE_NOW,
  seedAuthoritativeBaseline,
} from './helpers/authoritative-staffing-baseline.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

describe('authoritative staffing baseline local acceptance control', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
  });

  afterEach(async () => {
    await teardownTestD1(h);
  });

  it('rejects a committed partial source before it can become an accepted baseline', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'acceptance-partial',
      rows: [
        { sourceRowNumber: 1, normalizedTopology: 'synthetic/one', materializeObservation: true },
        { sourceRowNumber: 2, normalizedTopology: 'synthetic/two', materializeObservation: false },
      ],
      accept: false,
    });

    const accepted = await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), {
      acceptanceId: 'acceptance-partial-ledger',
      bidYear: 2027,
      importId: 'acceptance-partial',
      actorMemberId: 9001,
      reason: 'A partial source must not be designated.',
      acceptedAtMs: SYNTHETIC_BASELINE_NOW,
    });

    expect(accepted).toMatchObject({
      ok: false,
      code: 'SOURCE_IMPORT_NOT_COMPLETE',
      baseline: {
        status: 'BLOCKED',
        blockingCodes: expect.arrayContaining(['MISSING_REQUIRED_OBSERVATION']),
      },
    });
    expect(
      (await h.db.run('SELECT COUNT(*) AS count FROM bid_year_staffing_baselines')).results,
    ).toEqual([{ count: 0 }]);
  });

  it('keeps a complete synthetic fixture out of official acceptance', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'acceptance-synthetic',
      sourceKind: 'synthetic_test',
      rows: [
        {
          sourceRowNumber: 1,
          normalizedTopology: 'synthetic/fixture',
          topologyCompleteness: 'incomplete',
          classification: 'INCOMPLETE_TOPOLOGY',
          materializeObservation: false,
        },
      ],
      accept: false,
    });

    const completeness = await evaluateTeleStaffImportCompleteness(
      getDb(h.env.DB),
      'acceptance-synthetic',
    );
    expect(completeness.status).toBe('PASS');
    expect(completeness.sourceKind).toBe('synthetic_test');

    const accepted = await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), {
      acceptanceId: 'acceptance-synthetic-ledger',
      bidYear: 2027,
      importId: 'acceptance-synthetic',
      actorMemberId: 9001,
      reason: 'A local fixture is never an official annual baseline.',
      acceptedAtMs: SYNTHETIC_BASELINE_NOW,
    });
    expect(accepted).toMatchObject({ ok: false, code: 'NON_OFFICIAL_SOURCE' });
  });

  it('accepts a complete official manifest once and makes an identical retry idempotent', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'acceptance-official',
      rows: [
        { sourceRowNumber: 1, normalizedTopology: 'synthetic/one' },
        { sourceRowNumber: 2, normalizedTopology: 'synthetic/two' },
      ],
      accept: false,
    });
    const request = {
      acceptanceId: 'acceptance-official-ledger',
      bidYear: 2027,
      importId: 'acceptance-official',
      actorMemberId: 9001,
      reason: 'Complete official source manifest reviewed for local proof.',
      acceptedAtMs: SYNTHETIC_BASELINE_NOW,
    };

    const first = await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), request);
    const retry = await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), request);
    const conflicting = await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), {
      ...request,
      acceptanceId: 'acceptance-official-conflict',
    });
    const conflictingPayload = await acceptAuthoritativeStaffingBaseline(
      h.env.DB,
      getDb(h.env.DB),
      {
        ...request,
        reason: 'A different acceptance reason must not be treated as idempotent.',
      },
    );

    expect(first).toMatchObject({ ok: true, idempotent: false });
    expect(retry).toMatchObject({ ok: true, idempotent: true });
    expect(conflicting).toEqual({ ok: false, code: 'BASELINE_ALREADY_ACCEPTED' });
    expect(conflictingPayload).toEqual({ ok: false, code: 'ACCEPTANCE_PAYLOAD_CONFLICT' });
  });

  it('does not report a retry as idempotent after its accepted canonical projection is no longer complete', async () => {
    await seedAuthoritativeBaseline(h, {
      bidYear: 2027,
      importId: 'acceptance-ended-projection',
      rows: [{ sourceRowNumber: 1, normalizedTopology: 'synthetic/one' }],
      accept: false,
    });
    const request = {
      acceptanceId: 'acceptance-ended-projection-ledger',
      bidYear: 2027,
      importId: 'acceptance-ended-projection',
      actorMemberId: 9001,
      reason: 'Complete source manifest reviewed for local retry proof.',
      acceptedAtMs: SYNTHETIC_BASELINE_NOW,
    };
    expect(
      await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), request),
    ).toMatchObject({
      ok: true,
      idempotent: false,
    });

    await h.db.run(
      "UPDATE member_assignments SET status = 'ended', effective_to = '2026-08-28' WHERE source_observation_id = 'acceptance-ended-projection-observation-1'",
    );

    expect(
      await acceptAuthoritativeStaffingBaseline(h.env.DB, getDb(h.env.DB), request),
    ).toMatchObject({
      ok: false,
      code: 'SOURCE_IMPORT_NOT_COMPLETE',
      baseline: {
        status: 'BLOCKED',
        blockingCodes: expect.arrayContaining(['MISSING_CANONICAL_ASSIGNMENT']),
      },
    });
  });
});
