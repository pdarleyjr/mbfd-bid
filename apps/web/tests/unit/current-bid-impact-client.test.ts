import {
  BidDefinitionContentSchema,
  type BidImpactResponse,
  BidImpactResponseSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const YEAR = 2027;
const BASELINE = 'a'.repeat(64);
const CANDIDATE = 'b'.repeat(64);
const IMPACT = 'c'.repeat(64);
const CONTEXT = 'd'.repeat(64);
const SOURCE = 'e'.repeat(64);
const DIFFERENT = 'f'.repeat(64);
const POSITION = 'synthetic-impact-position';
const MEMBER = 10001;
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';

type ValidImpact = Extract<BidImpactResponse, { valid: true }>;
type EvaluatedSide = Extract<ValidImpact['before'], { status: 'EVALUATED' }>;
type EvaluatedComparison = Extract<ValidImpact['comparison'], { status: 'EVALUATED' }>;
type Trace = NonNullable<ValidImpact['trace']>;

// Synthetic transport fixtures use the actual shared schemas; no worker or live data is loaded.
function request(mode: 'mock' | 'live' = 'mock') {
  return {
    kind: 'impact' as const,
    expected: {
      kind: 'version' as const,
      versionId: 'synthetic-impact-version',
      revision: 2,
      sha256: BASELINE,
    },
    intent: {
      operation: 'save' as const,
      content: BidDefinitionContentSchema.parse({
        v: 1,
        bidYear: YEAR,
        settings: null,
        notes: { bid: null, positions: null },
        policy: null,
        planning: null,
        authoring: null,
        positions: [],
        rules: [],
        participation: [],
        staffingBindings: [],
        sourceDecisions: [],
      }),
    },
    mode,
    changeOffset: 0,
  };
}

function pool() {
  return {
    pool: 'FF' as const,
    exclusionReason: null,
    authoritativeAssignmentId: null,
    mockParticipationEvidence: null,
  };
}

function side(): EvaluatedSide {
  return {
    status: 'EVALUATED',
    contextSha256: CONTEXT,
    executionReferenceErrors: [],
    personnelEvaluationOn: '2027-01-01',
    credentialEvaluationOn: '2027-01-01',
    members: [{ memberId: MEMBER, displayName: null, rank: 'FF', ...pool() }],
    opportunities: [{ positionId: POSITION, evaluatedMemberCount: 1, eligibleMemberCount: 1 }],
    stageOrder: {
      status: 'EVALUATED',
      codes: [],
      entries: [{ ordinal: 1, memberId: MEMBER, stageId: 'synthetic-stage' }],
    },
    specialties: [],
    selectionConsequences: {
      status: 'REQUIRES_SELECTION_CONTEXT',
      areas: ['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS'],
    },
  };
}

function comparison(): EvaluatedComparison {
  const score = {
    eligible: true,
    points: 0,
    soPoints: 0,
    moPoints: 0,
    priority: 1,
    reasons: [],
  };
  return {
    status: 'EVALUATED',
    affectedMemberIds: [MEMBER],
    unavailableAreas: [],
    eligibility: {
      policyComparisonCount: 1,
      evidenceComparisonCount: 1,
      policyChangeCount: 1,
      evidenceChangeCount: 0,
      changeCount: 1,
      changeOffset: 0,
      changes: [
        {
          cause: 'POLICY',
          positionId: POSITION,
          memberId: MEMBER,
          before: score,
          after: { ...score, points: 1 },
        },
      ],
      nextChangeOffset: null,
      incomparable: {
        addedMemberIds: [],
        removedMemberIds: [],
        addedPositionIds: [],
        removedPositionIds: [],
      },
    },
    poolChanges: [],
    stageChanges: [],
    stageOpportunityChanges: [],
    specialtyChanges: [],
  };
}

function impact(mode: 'mock' | 'live' = 'mock'): ValidImpact {
  const keyed = { addedIds: [], removedIds: [], changedIds: [] };
  return {
    valid: true,
    v: 1,
    bidYear: YEAR,
    source: {
      kind: 'UNSAVED_DRAFT',
      baselineContentSha256: BASELINE,
      candidateContentSha256: CANDIDATE,
    },
    mode,
    capturedAtMs: 1_799_000_000_000,
    runtimeSourceToken: SOURCE,
    impactSha256: IMPACT,
    before: side(),
    after: side(),
    comparison: comparison(),
    trace: null,
    diff: {
      positions: keyed,
      rules: { ...keyed, changedIds: [POSITION] },
      participation: keyed,
      staffingBindings: keyed,
      sourceDecisions: keyed,
      changedSections: ['rules'],
    },
  };
}

function trace(selection: Trace['selection']): Trace {
  return {
    selection,
    before: { status: 'UNAVAILABLE', code: 'member_not_in_evaluation' },
    after: { status: 'NOT_APPLICABLE', code: 'position_not_biddable', pool: pool() },
  };
}

function evaluatedTraceSide(): Extract<Trace['after'], { status: 'EVALUATED' }> {
  const total = { credential: 'Synthetic total credential', awarded: 7 };
  const so = { credential: 'Synthetic SO credential', awarded: 5, reason: 'Synthetic SO credit' };
  const mo = { credential: 'Synthetic MO credential', awarded: 3 };
  return {
    status: 'EVALUATED',
    pool: pool(),
    eligible: true,
    reasons: [],
    points: 7,
    soPoints: 5,
    moPoints: 3,
    breakdown: { total: 7, soTotal: 5, moTotal: 3, itemized: [total] },
    channels: {
      total: { total: 7, itemized: [total] },
      so: { total: 5, itemized: [so] },
      mo: { total: 3, itemized: [mo] },
    },
    priority: 1,
    tieBreakChain: ['points', 'so_points', 'mo_points', 'rsc_seniority'],
    comparison: null,
    comparisonUnavailableReason: 'comparison_requires_two_eligible_members',
    stage: { id: 'synthetic-stage', opportunityAllowed: true },
    postAward: [],
    evidence: {
      rank: 'FF',
      isProbationary: false,
      credentialNames: [total.credential, so.credential, mo.credential],
      scoringEvidence: null,
      serviceCredits: [],
    },
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let client: typeof import('../../app/admin/current-bid/bid-client');
let browser: { fetch: typeof fetch; location: { origin: string } };

beforeEach(async () => {
  vi.resetModules();
  browser = {
    location: { origin: 'https://synthetic-bid.example.test' },
    fetch: vi.fn(async () => {
      throw new Error('Unexpected unconfigured synthetic request');
    }),
  };
  vi.stubGlobal('window', browser);
  vi.stubGlobal('fetch', browser.fetch);
  client = await import('../../app/admin/current-bid/bid-client');
});

afterEach(() => vi.unstubAllGlobals());

function serve(body: unknown, status = 200) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input) === '/api/auth/csrf' ? response({ token: CSRF }) : response(body, status),
  );
  browser.fetch = fetcher;
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('Current Bid impact request identity', () => {
  it.each(['mock', 'live'] as const)(
    'accepts the strict %s calculation using only the CSRF-protected preview request',
    async (mode) => {
      const body = request(mode);
      const result = impact(mode);
      expect(BidImpactResponseSchema.parse(result)).toStrictEqual(result);
      const fetcher = serve(result);
      const controller = new AbortController();
      expect(
        await client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
          body,
          signal: controller.signal,
        }),
      ).toStrictEqual(result);
      expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
        '/api/auth/csrf',
        '/api/admin/bid/2027/preview',
      ]);
      const init = fetcher.mock.calls[1]?.[1];
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      expect(new Headers(init?.headers).get('X-MBFD-CSRF')).toBe(CSRF);
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBeNull();
    },
  );

  it('preserves a pinned page and the exact selected member comparison', async () => {
    const selection = { memberId: MEMBER, positionId: POSITION, compareMemberId: MEMBER + 1 };
    const body = {
      ...request(),
      changeOffset: 100,
      expectedImpactSha256: IMPACT,
      trace: selection,
    };
    const result = impact();
    const changes = comparison();
    result.comparison = {
      ...changes,
      eligibility: {
        ...changes.eligibility,
        policyComparisonCount: 101,
        policyChangeCount: 101,
        changeCount: 101,
        changeOffset: 100,
      },
    };
    result.trace = { selection, before: evaluatedTraceSide(), after: evaluatedTraceSide() };
    expect(BidImpactResponseSchema.parse(result)).toStrictEqual(result);
    const fetcher = serve(result);
    expect(
      await client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body }),
    ).toStrictEqual(result);
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(body));
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBeNull();
  });

  it('rejects a different returned page offset even when the requested impact hash matches', async () => {
    const result = impact();
    const changes = comparison();
    result.comparison = {
      ...changes,
      eligibility: {
        ...changes.eligibility,
        policyComparisonCount: 201,
        policyChangeCount: 201,
        changeCount: 201,
        changeOffset: 200,
      },
    };
    expect(BidImpactResponseSchema.safeParse(result).success).toBe(true);
    serve(result);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
        body: { ...request(), changeOffset: 100, expectedImpactSha256: IMPACT },
      }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });

  it('accepts a restore candidate without turning its preview into a restoration write', async () => {
    const body = {
      ...request(),
      intent: { operation: 'restore', versionId: 'synthetic-historical-version' },
    };
    const result = impact();
    result.source.kind = 'RESTORE_CANDIDATE';
    const fetcher = serve(result);
    expect(
      await client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body }),
    ).toStrictEqual(result);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/auth/csrf',
      '/api/admin/bid/2027/preview',
    ]);
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBeNull();
  });

  it('keeps the legacy source token distinct from the baseline content hash', async () => {
    const body = { ...request(), expected: { kind: 'legacy', sourceToken: SOURCE } };
    const result = impact();
    serve(result);
    expect(
      await client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body }),
    ).toStrictEqual(result);
  });

  it.each([
    ['mode', (value: ValidImpact) => ({ ...value, mode: 'live' })],
    ['year', (value: ValidImpact) => ({ ...value, bidYear: YEAR + 1 })],
    ['impact hash', (value: ValidImpact) => ({ ...value, impactSha256: DIFFERENT })],
    ['missing impact hash', (value: ValidImpact) => ({ ...value, impactSha256: null })],
    [
      'baseline hash',
      (value: ValidImpact) => ({
        ...value,
        source: { ...value.source, baselineContentSha256: DIFFERENT },
      }),
    ],
    [
      'source kind',
      (value: ValidImpact) => ({
        ...value,
        source: { ...value.source, kind: 'RESTORE_CANDIDATE' },
      }),
    ],
  ])('rejects a schema-valid response with a different requested %s', async (_label, alter) => {
    const result = alter(impact());
    expect(BidImpactResponseSchema.safeParse(result).success).toBe(true);
    serve(result);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
        body: { ...request(), expectedImpactSha256: IMPACT },
      }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });

  it('rejects an unsaved-draft result for a restore request', async () => {
    serve(impact());
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
        body: {
          ...request(),
          intent: { operation: 'restore', versionId: 'synthetic-historical-version' },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });

  it.each([
    ['member', { memberId: MEMBER + 2, positionId: POSITION, compareMemberId: MEMBER + 1 }],
    [
      'opportunity',
      { memberId: MEMBER, positionId: 'another-position', compareMemberId: MEMBER + 1 },
    ],
    ['comparison member', { memberId: MEMBER, positionId: POSITION, compareMemberId: MEMBER + 2 }],
    ['absent comparison member', { memberId: MEMBER, positionId: POSITION }],
  ])('rejects a trace for a different %s', async (_label, selection) => {
    const result = { ...impact(), trace: trace(selection) };
    expect(BidImpactResponseSchema.safeParse(result).success).toBe(true);
    serve(result);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
        body: {
          ...request(),
          trace: { memberId: MEMBER, positionId: POSITION, compareMemberId: MEMBER + 1 },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });

  it.each([true, false])(
    'rejects missing or unsolicited trace data (requested=%s)',
    async (wanted) => {
      const selection = { memberId: MEMBER, positionId: POSITION };
      serve({ ...impact(), trace: wanted ? null : trace(selection) });
      await expect(
        client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
          body: { ...request(), ...(wanted ? { trace: selection } : {}) },
        }),
      ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
    },
  );
});

describe('Current Bid strict impact result boundaries', () => {
  it.each([
    [
      'missing channels',
      (value: ReturnType<typeof evaluatedTraceSide>) => ({ ...value, channels: undefined }),
    ],
    [
      'missing SO channel',
      (value: ReturnType<typeof evaluatedTraceSide>) => ({
        ...value,
        channels: { ...value.channels, so: undefined },
      }),
    ],
    [
      'internal channel evidence',
      (value: ReturnType<typeof evaluatedTraceSide>) => ({
        ...value,
        channels: { ...value.channels, mo: { ...value.channels.mo, rawCredentialRows: [] } },
      }),
    ],
  ])('rejects evaluated trace data with %s', async (_label, alter) => {
    const selection = { memberId: MEMBER, positionId: POSITION };
    const malformed = {
      ...impact(),
      trace: { selection, before: evaluatedTraceSide(), after: alter(evaluatedTraceSide()) },
    };
    expect(BidImpactResponseSchema.safeParse(malformed).success).toBe(false);
    serve(malformed);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
        body: { ...request(), trace: selection },
      }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });

  it('preserves blocked sides and unavailable comparison without creating scores or context pins', async () => {
    const blocked = {
      ...impact(),
      impactSha256: null,
      before: {
        status: 'BLOCKED',
        code: 'bid_configuration_unconfigured',
        positionIds: [],
        tenureIssues: [],
      },
      after: {
        status: 'BLOCKED',
        code: 'synthetic_tenure_unresolved',
        positionIds: [POSITION],
        tenureIssues: [
          {
            staffingPositionId: 'synthetic-seat',
            code: 'missing_start',
            recordId: 'synthetic-tenure',
          },
        ],
      },
      comparison: { status: 'UNAVAILABLE', code: 'both_definitions_must_be_evaluable' },
    };
    expect(BidImpactResponseSchema.parse(blocked)).toStrictEqual(blocked);
    serve(blocked);
    const result = await client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
      body: request(),
    });
    expect(result).toStrictEqual(blocked);
    expect(result).not.toHaveProperty('before.members');
    expect(result).not.toHaveProperty('after.contextSha256');
    expect(result).not.toHaveProperty('comparison.eligibility');
    expect(result).not.toHaveProperty('comparison.affectedMemberIds');
  });

  it('preserves invalid-definition issues without inventing an evaluated impact', async () => {
    const invalid = {
      valid: false,
      issues: [{ path: ['rules', 0], code: 'invalid_rule', message: 'Synthetic invalid rule' }],
    };
    expect(BidImpactResponseSchema.parse(invalid)).toStrictEqual(invalid);
    serve(invalid);
    const result = await client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, {
      body: request(),
    });
    expect(result).toStrictEqual(invalid);
    expect(result).not.toHaveProperty('impactSha256');
    expect(result).not.toHaveProperty('before');
    expect(result).not.toHaveProperty('comparison');
    expect(result).not.toHaveProperty('mockReadiness');
  });

  it.each([
    [
      'transport',
      (value: ValidImpact) => ({ ...value, snapshotJson: 'synthetic internal material' }),
    ],
    ['source', (value: ValidImpact) => ({ ...value, source: { ...value.source, sourceRowId: 1 } })],
    ['side', (value: ValidImpact) => ({ ...value, before: { ...side(), rawEvidence: {} } })],
    [
      'member',
      (value: ValidImpact) => ({
        ...value,
        before: {
          ...side(),
          members: [{ ...side().members[0], employeeNumber: 'synthetic-private' }],
        },
      }),
    ],
    [
      'comparison',
      (value: ValidImpact) => ({ ...value, comparison: { ...comparison(), predictedAwards: [] } }),
    ],
    [
      'score',
      (value: ValidImpact) => {
        const changes = comparison();
        return {
          ...value,
          comparison: {
            ...changes,
            eligibility: {
              ...changes.eligibility,
              changes: changes.eligibility.changes.map((row) => ({
                ...row,
                after: { ...row.after, rawCredentialRows: [] },
              })),
            },
          },
        };
      },
    ],
    [
      'blocked side',
      (value: ValidImpact) => ({
        ...value,
        before: {
          status: 'BLOCKED',
          code: 'blocked',
          positionIds: [],
          tenureIssues: [],
          members: [],
        },
      }),
    ],
    ['invalid definition', () => ({ valid: false, issues: [], impactSha256: IMPACT })],
  ])('rejects unknown internal fields in the %s DTO', async (_label, alter) => {
    const malformed = alter(impact());
    expect(BidImpactResponseSchema.safeParse(malformed).success).toBe(false);
    serve(malformed);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body: request() }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });

  it.each([
    ['null', null],
    ['array', []],
    ['partial result', { valid: true, bidYear: YEAR }],
    ['invalid digest', { ...impact(), runtimeSourceToken: 'not-a-digest' }],
    ['negative count', { ...impact(), capturedAtMs: -1 }],
    ['omitted trace', { ...impact(), trace: undefined }],
    [
      'invalid calendar date',
      { ...impact(), before: { ...side(), credentialEvaluationOn: '2027-02-30' } },
    ],
    [
      'oversized change page',
      {
        ...impact(),
        comparison: {
          ...comparison(),
          eligibility: {
            ...comparison().eligibility,
            changes: Array.from({ length: 101 }, () => comparison().eligibility.changes[0]),
          },
        },
      },
    ],
  ])('rejects malformed successful responses: %s', async (_label, malformed) => {
    serve(malformed);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body: request() }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });

  it.each([409, 408, 500])(
    'keeps HTTP %s impact failures outside uncertain write handling',
    async (status) => {
      const fetcher = serve({ error: 'bid_impact_context_changed' }, status);
      await expect(
        client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body: request() }),
      ).rejects.toMatchObject({ code: 'bid_impact_context_changed', status, uncertain: false });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBeNull();
    },
  );

  it('reports a lost impact response as a read-only failure without an automatic mutation retry', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf') return response({ token: CSRF });
      throw new TypeError('Synthetic interrupted impact response');
    });
    browser.fetch = fetcher;
    vi.stubGlobal('fetch', fetcher);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body: request() }),
    ).rejects.toMatchObject({ code: 'connection_interrupted', status: null, uncertain: false });
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/auth/csrf',
      '/api/admin/bid/2027/preview',
    ]);
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBeNull();
  });

  it('rejects a non-JSON successful response without an uncertain write outcome', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input) === '/api/auth/csrf'
        ? response({ token: CSRF })
        : new Response('Synthetic non-JSON response', { status: 200 }),
    );
    browser.fetch = fetcher;
    vi.stubGlobal('fetch', fetcher);
    await expect(
      client.bidRequest(YEAR, 'preview', BidImpactResponseSchema, { body: request() }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });
});
