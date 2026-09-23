import type { BidDefinitionContent } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentBid } from '../../app/admin/current-bid/bid-client';

const YEAR = 2027;
const DIGEST = 'a'.repeat(64);
const KEY = 'b8ef4ea0-c22d-46c3-a71a-f724b690eaf2';
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';

// Synthetic shape from the real-FK bid-definition-facade integration fixture.
function content(): BidDefinitionContent {
  return {
    v: 1,
    bidYear: YEAR,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
    },
    notes: { bid: 'Synthetic rule notes', positions: 'Synthetic topology notes' },
    policy: null,
    planning: null,
    authoring: null,
    positions: [
      {
        id: 'synthetic-facade-biddable',
        shift: 'A',
        station: '7',
        division: 'Combat',
        unit: 'Synthetic Engine',
        rankRequired: 'FF',
        positionName: 'Synthetic firefighter',
        isExcludedFromCount: false,
        isFloating: false,
        isVacantByDesign: false,
      },
      {
        id: 'synthetic-facade-reserved',
        shift: 'D',
        station: '7',
        division: 'Administration',
        unit: 'Synthetic Office',
        rankRequired: 'FF',
        positionName: 'Synthetic reserved position',
        isExcludedFromCount: false,
        isFloating: false,
        isVacantByDesign: false,
      },
    ],
    rules: [
      {
        positionId: 'synthetic-facade-biddable',
        requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
        pointsPreferenceJson: '{"max":0,"items":[]}',
        tieBreakChainJson: '["rsc_seniority"]',
        notes: null,
      },
    ],
    participation: [
      {
        positionId: 'synthetic-facade-reserved',
        bidParticipation: 'RESERVED_NON_BIDDABLE',
        authoritativeSourceRef: 'Synthetic reserved source',
      },
    ],
    staffingBindings: [],
    sourceDecisions: [],
  };
}

function current(): CurrentBid {
  return {
    bidYear: YEAR,
    state: 'VERSIONED',
    version: {
      id: 'synthetic-version-2',
      versionNumber: 2,
      contentSha256: DIGEST,
      createdAtMs: 1_799_000_000_000,
      actorSubject: 'synthetic-admin-10001',
      reason: 'Synthetic Bid editing receipt',
      predecessorId: 'synthetic-version-1',
      restoredFromId: null,
    },
    expected: { kind: 'version', versionId: 'synthetic-version-2', revision: 2, sha256: DIGEST },
    content: content(),
    coverage: {
      valid: true,
      ruleCount: 1,
      missingBiddablePositionIds: [],
      invalidPositionIds: [],
      duplicatePositionIds: [],
      nonBiddablePositionIds: ['synthetic-facade-reserved'],
      unexpectedPositionIds: [],
    },
    stats: {
      opportunityCount: 2,
      ruleCount: 1,
      biddableCount: 1,
      administrativelyAssignedCount: 0,
      reservedCount: 1,
      excludedCount: 0,
      missingRuleCount: 0,
    },
  };
}

function receipt() {
  return {
    changed: true,
    replayed: false,
    versionId: 'synthetic-version-3',
    versionNumber: 3,
    contentSha256: 'b'.repeat(64),
    predecessorId: 'synthetic-version-2',
    restoredFromId: null,
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

function historical() {
  const { bidYear, version, content: material, coverage, stats } = current();
  return { bidYear, version, content: material, coverage, stats };
}

function validPreview() {
  const value = current();
  const keyed = { addedIds: [], removedIds: [], changedIds: [] };
  return {
    valid: true,
    content: value.content,
    contentSha256: DIGEST,
    diff: {
      positions: keyed,
      rules: keyed,
      participation: keyed,
      staffingBindings: keyed,
      sourceDecisions: keyed,
      changedSections: [],
    },
    wouldCreateVersion: false,
    coverage: value.coverage,
    stats: value.stats,
    mockReadiness: {
      status: 'NOT_EVALUATED',
      code: 'saved_version_required_for_mock_preview',
    },
  };
}

function mockRequest() {
  return {
    versionId: 'synthetic-version-2',
    versionSha256: DIGEST,
    expectedContextSha256: 'c'.repeat(64),
    expectedSourceToken: 'd'.repeat(64),
  };
}

function mockPreview() {
  return {
    wouldAllowCreateMock: true as const,
    versionId: mockRequest().versionId,
    versionSha256: mockRequest().versionSha256,
    versionNumber: 2,
    contextSha256: mockRequest().expectedContextSha256,
    runtimeSourceToken: mockRequest().expectedSourceToken,
    sourceDecisionBlockers: [],
    pool: {
      officerPoolCount: 2,
      firefighterPoolCount: 11,
      excludedCount: 3,
      administrativeAssignmentExcludedCount: 1,
    },
  };
}

function mockReceipt(replayed = false) {
  return {
    id: 'synthetic-mock-session',
    current_phase: 'config' as const,
    is_mock: true as const,
    rule_book_version: 'synthetic-rule-book',
    rule_book_revision: 4,
    position_template_version: 'synthetic-position-template',
    configuration_revision: 2,
    settings: { expected_duration_days: 2, turn_timer_seconds: 180 },
    pool: mockPreview().pool,
    bidDefinition: {
      versionId: mockRequest().versionId,
      versionNumber: 2,
      versionSha256: mockRequest().versionSha256,
      snapshotSha256: 'e'.repeat(64),
      contextSha256: mockRequest().expectedContextSha256,
    },
    replayed,
  };
}

describe('Current Bid managed Mock request contracts', () => {
  it('checks readiness using a CSRF-protected preview without a creation key or Live request', async () => {
    const fetcher = serve(mockPreview());
    const body = { kind: 'mock', versionId: mockRequest().versionId, versionSha256: DIGEST };
    expect(await client.bidRequest(YEAR, 'preview', client.BidMockPreviewSchema, { body })).toEqual(
      mockPreview(),
    );
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/auth/csrf',
      '/api/admin/bid/2027/preview',
    ]);
    const init = fetcher.mock.calls[1]?.[1];
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(body) });
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBeNull();
    expect(new Headers(init?.headers).get('X-MBFD-CSRF')).toBe(CSRF);
  });

  it('preserves an actual blocked readiness result without manufacturing allowed pins or counts', async () => {
    const blocked = {
      wouldAllowCreateMock: false,
      policyError: 'synthetic_pending_dispute',
      positionIds: ['synthetic-facade-biddable'],
      tenureIssues: [
        {
          staffingPositionId: 'synthetic-seat',
          code: 'missing_start',
          recordId: 'synthetic-tenure',
        },
      ],
    };
    serve(blocked);
    expect(
      await client.bidRequest(YEAR, 'preview', client.BidMockPreviewSchema, {
        body: { kind: 'mock', versionId: mockRequest().versionId, versionSha256: DIGEST },
      }),
    ).toStrictEqual(blocked);
  });

  it.each(['versionId', 'versionSha256'] as const)(
    'rejects readiness belonging to a different requested %s',
    async (field) => {
      serve({
        ...mockPreview(),
        [field]: field === 'versionId' ? 'other-version' : 'f'.repeat(64),
      });
      await expect(
        client.bidRequest(YEAR, 'preview', client.BidMockPreviewSchema, {
          body: { kind: 'mock', versionId: mockRequest().versionId, versionSha256: DIGEST },
        }),
      ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
    },
  );

  it.each([false, true])(
    'accepts an established Mock receipt (replayed=%s) with the exact four-pin request and key',
    async (replayed) => {
      const fetcher = serve(mockReceipt(replayed), replayed ? 200 : 201);
      const body = mockRequest();
      expect(
        await client.bidRequest(YEAR, 'mock-sessions', client.BidMockResultSchema, {
          body,
          key: KEY,
        }),
      ).toEqual(mockReceipt(replayed));
      expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
        '/api/auth/csrf',
        '/api/admin/bid/2027/mock-sessions',
      ]);
      const init = fetcher.mock.calls[1]?.[1];
      expect(init).toMatchObject({
        method: 'POST',
        body: JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(KEY);
      expect(new Headers(init?.headers).get('X-MBFD-CSRF')).toBe(CSRF);
    },
  );

  it.each([
    [
      'version ID',
      (result: ReturnType<typeof mockReceipt>) => ({
        ...result,
        bidDefinition: { ...result.bidDefinition, versionId: 'other-version' },
      }),
    ],
    [
      'version hash',
      (result: ReturnType<typeof mockReceipt>) => ({
        ...result,
        bidDefinition: { ...result.bidDefinition, versionSha256: 'f'.repeat(64) },
      }),
    ],
    [
      'context hash',
      (result: ReturnType<typeof mockReceipt>) => ({
        ...result,
        bidDefinition: { ...result.bidDefinition, contextSha256: 'f'.repeat(64) },
      }),
    ],
    [
      'missing snapshot pin',
      (result: ReturnType<typeof mockReceipt>) => ({
        ...result,
        bidDefinition: { ...result.bidDefinition, snapshotSha256: undefined },
      }),
    ],
    [
      'inconsistent version number',
      (result: ReturnType<typeof mockReceipt>) => ({ ...result, configuration_revision: 3 }),
    ],
    ['Live receipt', (result: ReturnType<typeof mockReceipt>) => ({ ...result, is_mock: false })],
    [
      'advanced run phase',
      (result: ReturnType<typeof mockReceipt>) => ({ ...result, current_phase: 'officer' }),
    ],
    [
      'unknown receipt material',
      (result: ReturnType<typeof mockReceipt>) => ({ ...result, liveAuthorization: true }),
    ],
  ])('does not establish a Mock receipt with %s', async (_label, alter) => {
    serve(alter(mockReceipt()), 201);
    await expect(
      client.bidRequest(YEAR, 'mock-sessions', client.BidMockResultSchema, {
        body: mockRequest(),
        key: KEY,
      }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 201, uncertain: true });
  });

  it('reports changed Department context as a definitive conflict requiring another preview', async () => {
    serve({ error: 'bid_run_context_changed' }, 409);
    await expect(
      client.bidRequest(YEAR, 'mock-sessions', client.BidMockResultSchema, {
        body: mockRequest(),
        key: KEY,
      }),
    ).rejects.toMatchObject({ code: 'bid_run_context_changed', status: 409, uncertain: false });
  });

  it('reuses the original Mock request and creation key after a lost response', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf') return response({ token: CSRF });
      if (++attempts === 1) throw new TypeError('Synthetic lost Mock receipt');
      return response(mockReceipt(true));
    });
    browser.fetch = fetcher;
    const body = mockRequest();
    await expect(
      client.bidRequest(YEAR, 'mock-sessions', client.BidMockResultSchema, { body, key: KEY }),
    ).rejects.toMatchObject({ code: 'connection_interrupted', uncertain: true });
    expect(
      await client.bidRequest(YEAR, 'mock-sessions', client.BidMockResultSchema, {
        body,
        key: KEY,
      }),
    ).toEqual(mockReceipt(true));
    const sent = fetcher.mock.calls.filter(([input]) => String(input).endsWith('/mock-sessions'));
    expect(sent).toHaveLength(2);
    expect(sent.map(([, init]) => init?.body)).toEqual([
      JSON.stringify(body),
      JSON.stringify(body),
    ]);
    expect(sent.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'))).toEqual([
      KEY,
      KEY,
    ]);
  });
});

describe('Current Bid managed Live request contracts', () => {
  function liveReceipt(replayed = false) {
    return { ...mockReceipt(replayed), id: 'synthetic-live-session', is_mock: false as const };
  }

  it.each([false, true])(
    'accepts only a config-phase Live receipt with exact pins and key (replayed=%s)',
    async (replayed) => {
      const fetcher = serve(liveReceipt(replayed), replayed ? 200 : 201);
      const body = mockRequest();
      expect(
        await client.bidRequest(YEAR, 'live-sessions', client.BidLiveResultSchema, {
          body,
          key: KEY,
        }),
      ).toStrictEqual(liveReceipt(replayed));
      expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
        '/api/auth/csrf',
        '/api/admin/bid/2027/live-sessions',
      ]);
      const init = fetcher.mock.calls[1]?.[1];
      expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(body) });
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(KEY);
      expect(new Headers(init?.headers).get('X-MBFD-CSRF')).toBe(CSRF);
    },
  );

  it.each([
    [
      'foreign version ID',
      (r: ReturnType<typeof liveReceipt>) => ({
        ...r,
        bidDefinition: { ...r.bidDefinition, versionId: 'synthetic-foreign-version' },
      }),
    ],
    [
      'foreign version hash',
      (r: ReturnType<typeof liveReceipt>) => ({
        ...r,
        bidDefinition: { ...r.bidDefinition, versionSha256: 'f'.repeat(64) },
      }),
    ],
    [
      'foreign context hash',
      (r: ReturnType<typeof liveReceipt>) => ({
        ...r,
        bidDefinition: { ...r.bidDefinition, contextSha256: 'f'.repeat(64) },
      }),
    ],
    [
      'missing snapshot hash',
      (r: ReturnType<typeof liveReceipt>) => ({
        ...r,
        bidDefinition: { ...r.bidDefinition, snapshotSha256: undefined },
      }),
    ],
    [
      'inconsistent version number',
      (r: ReturnType<typeof liveReceipt>) => ({ ...r, configuration_revision: 3 }),
    ],
    ['Mock receipt', (r: ReturnType<typeof liveReceipt>) => ({ ...r, is_mock: true })],
    [
      'started session',
      (r: ReturnType<typeof liveReceipt>) => ({ ...r, current_phase: 'officer' }),
    ],
    [
      'unknown response material',
      (r: ReturnType<typeof liveReceipt>) => ({ ...r, unreviewedAuthorization: true }),
    ],
  ])(
    'retains an uncertain outcome for %s rather than accepting the receipt',
    async (_label, alter) => {
      const fetcher = serve(alter(liveReceipt()), 201);
      await expect(
        client.bidRequest(YEAR, 'live-sessions', client.BidLiveResultSchema, {
          body: mockRequest(),
          key: KEY,
        }),
      ).rejects.toMatchObject({ code: 'invalid_server_response', status: 201, uncertain: true });
      expect(
        fetcher.mock.calls.every(([input]) =>
          ['/api/auth/csrf', '/api/admin/bid/2027/live-sessions'].includes(String(input)),
        ),
      ).toBe(true);
    },
  );
});

describe('Current Bid client identity and strict response contracts', () => {
  it('reads a valid versioned and legacy Bid without issuing a CSRF bootstrap or a mutation', async () => {
    const versioned = current();
    const fetcher = serve(versioned);
    expect(await client.bidRequest(YEAR, 'current', client.CurrentBidSchema)).toEqual(versioned);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/bid/2027/current', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const legacy = {
      ...versioned,
      state: 'LEGACY_UNADOPTED',
      version: null,
      expected: { kind: 'legacy', sourceToken: DIGEST },
    };
    serve(legacy);
    expect(await client.bidRequest(YEAR, 'current', client.CurrentBidSchema)).toEqual(legacy);
  });

  it.each([
    ['content year', (v: CurrentBid) => ({ ...v, content: { ...v.content, bidYear: 2028 } })],
    [
      'version identity',
      (v: CurrentBid) => ({ ...v, version: { ...v.version, id: 'another-version' } }),
    ],
    [
      'version revision',
      (v: CurrentBid) => ({ ...v, version: { ...v.version, versionNumber: 3 } }),
    ],
    [
      'version digest',
      (v: CurrentBid) => ({ ...v, version: { ...v.version, contentSha256: 'b'.repeat(64) } }),
    ],
    ['version missing', (v: CurrentBid) => ({ ...v, version: null })],
    ['legacy state with a version', (v: CurrentBid) => ({ ...v, state: 'LEGACY_UNADOPTED' })],
    [
      'wrong concurrency token kind',
      (v: CurrentBid) => ({ ...v, expected: { kind: 'legacy', sourceToken: DIGEST } }),
    ],
    [
      'unknown transport field',
      (v: CurrentBid) => ({ ...v, snapshotJson: 'forbidden internal state' }),
    ],
    [
      'unknown content field',
      (v: CurrentBid) => ({ ...v, content: { ...v.content, sql: 'forbidden internal state' } }),
    ],
    [
      'invalid coverage count',
      (v: CurrentBid) => ({ ...v, coverage: { ...v.coverage, ruleCount: -1 } }),
    ],
  ])('rejects a successful current response with %s mismatch', async (_name, corrupt) => {
    serve(corrupt(current()));
    await expect(client.bidRequest(YEAR, 'current', client.CurrentBidSchema)).rejects.toMatchObject(
      {
        code: 'invalid_server_response',
        status: 200,
        uncertain: false,
      },
    );
  });

  it('rejects a historical DTO whose material belongs to another year', () => {
    const value = historical();
    expect(client.HistoricalBidSchema.safeParse(value).success).toBe(true);
    expect(
      client.HistoricalBidSchema.safeParse({
        ...value,
        content: { ...value.content, bidYear: 2028 },
      }).success,
    ).toBe(false);
  });

  it('accepts historical, paginated history and valid preview data bound to the requested Bid', async () => {
    const history = historical();
    serve(history);
    expect(
      await client.bidRequest(YEAR, 'versions/synthetic-version-2', client.HistoricalBidSchema),
    ).toEqual(history);
    const versions = {
      bidYear: YEAR,
      versions: [current().version],
      nextBeforeVersionNumber: 2,
    };
    serve(versions);
    expect(await client.bidRequest(YEAR, 'versions?limit=1', client.BidVersionsSchema)).toEqual(
      versions,
    );
    const preview = validPreview();
    serve(preview);
    expect(
      await client.bidRequest(YEAR, 'preview', client.BidPreviewSchema, {
        body: {
          kind: 'definition',
          expected: current().expected,
          intent: { operation: 'save', content: content() },
        },
      }),
    ).toEqual(preview);
  });

  it.each(['current', 'versions', 'history'] as const)(
    'rejects internally valid %s data returned for another requested Bid year',
    async (kind) => {
      if (kind === 'current') {
        const value = current();
        serve({ ...value, bidYear: 2028, content: { ...value.content, bidYear: 2028 } });
        await expect(
          client.bidRequest(YEAR, 'current', client.CurrentBidSchema),
        ).rejects.toMatchObject({ status: 200, uncertain: false });
      } else if (kind === 'versions') {
        serve({ bidYear: 2028, versions: [current().version], nextBeforeVersionNumber: null });
        await expect(
          client.bidRequest(YEAR, 'versions', client.BidVersionsSchema),
        ).rejects.toMatchObject({ status: 200, uncertain: false });
      } else {
        const value = historical();
        serve({ ...value, bidYear: 2028, content: { ...value.content, bidYear: 2028 } });
        await expect(
          client.bidRequest(YEAR, 'versions/synthetic-version-2', client.HistoricalBidSchema),
        ).rejects.toMatchObject({ status: 200, uncertain: false });
      }
    },
  );

  it('validates receipt and preview unions without inventing a successful receipt from partial data', () => {
    expect(client.BidSaveResultSchema.parse(receipt())).toEqual(receipt());
    expect(
      client.BidSaveResultSchema.safeParse({ ...receipt(), replayed: undefined }).success,
    ).toBe(false);
    expect(
      client.BidSaveResultSchema.safeParse({ ...receipt(), contentSha256: 'not-a-hash' }).success,
    ).toBe(false);
    const invalidPreview = {
      valid: false,
      issues: [
        {
          path: ['rules', 0],
          code: 'invalid_rule',
          message: 'Synthetic invalid rule',
          token: 'Synthetic token',
        },
      ],
      mockReadiness: { status: 'NOT_EVALUATED', code: 'saved_version_required_for_mock_preview' },
    };
    expect(client.BidPreviewSchema.parse(invalidPreview)).toEqual(invalidPreview);
    expect(client.BidPreviewSchema.safeParse({ ...invalidPreview, valid: true }).success).toBe(
      false,
    );
    expect(
      client.BidPreviewSchema.safeParse({ ...invalidPreview, mockReadiness: { status: 'READY' } })
        .success,
    ).toBe(false);
  });

  it('rejects a valid historical version returned for a different requested version identity', async () => {
    serve(historical());
    await expect(
      client.bidRequest(YEAR, 'versions/synthetic-version-1', client.HistoricalBidSchema),
    ).rejects.toMatchObject({ status: 200, uncertain: false });
  });

  it('rejects a valid definition preview carrying content for another requested year', async () => {
    const value = current();
    serve({
      ...validPreview(),
      content: { ...value.content, bidYear: 2028 },
    });
    await expect(
      client.bidRequest(YEAR, 'preview', client.BidPreviewSchema, {
        body: {
          kind: 'definition',
          expected: value.expected,
          intent: { operation: 'save', content: value.content },
        },
      }),
    ).rejects.toMatchObject({ status: 200, uncertain: false });
  });

  it.each([2023, 2101, 2027.5, Number.NaN])(
    'rejects invalid requested year %s before any network request',
    async (year) => {
      const fetcher = serve(current());
      await expect(
        client.bidRequest(year, 'current', client.CurrentBidSchema),
      ).rejects.toMatchObject({ code: 'invalid_bid_year', status: 400, uncertain: false });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

describe('Current Bid writes and receipt uncertainty', () => {
  it('reuses CSRF while resolving the current step-up wrapper and retaining exact retry body/key', async () => {
    const first = serve(receipt(), 201);
    const body = {
      expected: current().expected,
      content: content(),
      reason: '  Synthetic reviewed change\n',
    };
    const signal = new AbortController().signal;
    await client.bidRequest(YEAR, 'versions', client.BidSaveResultSchema, {
      body,
      key: KEY,
      signal,
    });
    const remountedStepUp = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      response({ ...receipt(), replayed: true }),
    );
    browser.fetch = remountedStepUp;
    expect(
      await client.bidRequest(YEAR, 'versions', client.BidSaveResultSchema, {
        body,
        key: KEY,
        signal,
      }),
    ).toMatchObject({ replayed: true });
    expect(first).toHaveBeenCalledTimes(2);
    expect(first.mock.calls[0]?.[0]).toBe('/api/auth/csrf');
    expect(remountedStepUp).toHaveBeenCalledTimes(1);
    const requests = [first.mock.calls[1], remountedStepUp.mock.calls[0]];
    for (const request of requests) {
      expect(request?.[0]).toBe('/api/admin/bid/2027/versions');
      expect(request?.[1]).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(body),
        signal,
      });
      const headers = new Headers(request?.[1]?.headers);
      expect(headers.get('Idempotency-Key')).toBe(KEY);
      expect(headers.get('X-MBFD-CSRF')).toBe(CSRF);
      expect(headers.get('Content-Type')).toBe('application/json');
    }
    expect(first.mock.calls[1]?.[1]?.body).toBe(remountedStepUp.mock.calls[0]?.[1]?.body);
  });

  it('sends definition preview as CSRF-protected POST without a mutation identity', async () => {
    const result = {
      valid: false,
      issues: [
        { path: ['settings'], code: 'invalid_settings', message: 'Synthetic incomplete draft' },
      ],
      mockReadiness: { status: 'NOT_EVALUATED', code: 'saved_version_required_for_mock_preview' },
    };
    const fetcher = serve(result);
    const body = {
      kind: 'definition',
      expected: current().expected,
      intent: { operation: 'save', content: content() },
    };
    expect(await client.bidRequest(YEAR, 'preview', client.BidPreviewSchema, { body })).toEqual(
      result,
    );
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(body));
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBeNull();
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('X-MBFD-CSRF')).toBe(CSRF);
  });

  it.each([400, 401, 403, 404, 409, 422, 429, 408, 500, 502, 503])(
    'classifies keyed HTTP %s without losing structured server issues',
    async (status) => {
      const issues = [
        {
          path: ['rules', 0, 'positionId'],
          code: 'source_changed',
          message: 'Synthetic source changed',
          positionId: 'synthetic-facade-biddable',
        },
      ];
      serve({ error: 'bid_definition_or_source_changed', issues }, status);
      await expect(
        client.bidRequest(YEAR, 'versions', client.BidSaveResultSchema, { body: {}, key: KEY }),
      ).rejects.toMatchObject({
        name: 'BidRequestError',
        code: 'bid_definition_or_source_changed',
        status,
        uncertain: status >= 500 || status === 408,
        issues,
      });
    },
  );

  it.each(['read', 'preview', 'write'] as const)(
    'classifies interrupted %s by whether it could establish a mutation receipt',
    async (mode) => {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/auth/csrf') return response({ token: CSRF });
        throw new DOMException('Synthetic connection aborted', 'AbortError');
      });
      browser.fetch = fetcher;
      vi.stubGlobal('fetch', fetcher);
      const options =
        mode === 'read' ? undefined : { body: {}, ...(mode === 'write' ? { key: KEY } : {}) };
      await expect(
        client.bidRequest(
          YEAR,
          mode === 'read' ? 'current' : mode === 'preview' ? 'preview' : 'versions',
          client.CurrentBidSchema,
          options,
        ),
      ).rejects.toMatchObject({
        code: 'connection_interrupted',
        status: null,
        uncertain: mode === 'write',
      });
    },
  );

  it.each([false, true])(
    'treats malformed successful JSON as uncertain only for a keyed write (%s)',
    async (keyed) => {
      const fetcher = vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/auth/csrf'
          ? response({ token: CSRF })
          : new Response('{truncated', { status: 200 }),
      );
      browser.fetch = fetcher;
      vi.stubGlobal('fetch', fetcher);
      await expect(
        client.bidRequest(
          YEAR,
          keyed ? 'versions' : 'current',
          client.BidSaveResultSchema,
          keyed ? { body: {}, key: KEY } : undefined,
        ),
      ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: keyed });
    },
  );

  it('retains the exact save request after a lost response and accepts an established replay receipt', async () => {
    const body = {
      expected: current().expected,
      content: content(),
      reason: 'Synthetic retained exact save',
    };
    let writes = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/auth/csrf') return response({ token: CSRF });
      if (++writes === 1) throw new TypeError('Synthetic dropped receipt');
      return response({ ...receipt(), replayed: true });
    });
    browser.fetch = fetcher;
    await expect(
      client.bidRequest(YEAR, 'versions', client.BidSaveResultSchema, { body, key: KEY }),
    ).rejects.toMatchObject({ uncertain: true });
    expect(
      await client.bidRequest(YEAR, 'versions', client.BidSaveResultSchema, { body, key: KEY }),
    ).toMatchObject({ versionId: 'synthetic-version-3', replayed: true });
    const requests = fetcher.mock.calls.filter(([input]) => String(input).endsWith('/versions'));
    expect(requests).toHaveLength(2);
    expect(requests[0]?.[1]?.body).toBe(requests[1]?.[1]?.body);
    expect(requests.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'))).toEqual([
      KEY,
      KEY,
    ]);
  });

  it('never forwards a protected write after failed CSRF bootstrap and can retry bootstrap', async () => {
    let bootstraps = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/csrf')
        return response({ token: ++bootstraps === 1 ? 'invalid' : CSRF });
      return response(receipt());
    });
    browser.fetch = fetcher;
    await expect(
      client.bidRequest(YEAR, 'versions', client.BidSaveResultSchema, { body: {}, key: KEY }),
    ).rejects.toBeInstanceOf(client.BidRequestError);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual(['/api/auth/csrf']);
    await client.bidRequest(YEAR, 'versions', client.BidSaveResultSchema, { body: {}, key: KEY });
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/auth/csrf',
      '/api/auth/csrf',
      '/api/admin/bid/2027/versions',
    ]);
  });
});
