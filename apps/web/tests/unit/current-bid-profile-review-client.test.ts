import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  type BidProfileReviewResponse,
  BidProfileReviewResponseSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const YEAR = 2027;
const BASELINE = 'a'.repeat(64);
const CANDIDATE = 'b'.repeat(64);
const RUNTIME = 'c'.repeat(64);
const REVIEW = 'd'.repeat(64);
const POSITION = 'synthetic-profile-seat';
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function content(
  reconciliation: 'PROFILE_EDITS_PENDING_REVIEW' | 'MATERIALIZED_FOR_CURRENT_VERSION',
): BidDefinitionContent {
  return BidDefinitionContentSchema.parse({
    v: 1,
    bidYear: YEAR,
    settings: null,
    notes: { bid: null, positions: null },
    policy: null,
    planning: null,
    authoring: {
      profiles: [
        {
          id: 'synthetic-profile',
          name: 'Synthetic profile',
          sourceRef: 'Synthetic approved profile source',
          scope: { kind: 'position', positionId: POSITION },
          requirements: { credentials: [], custom: [] },
        },
      ],
      compiled: [],
      reconciliation,
    },
    positions: [
      {
        id: POSITION,
        positionName: 'Synthetic profile seat',
        shift: 'A',
        station: 'Synthetic station',
        unit: 'Synthetic unit',
        division: 'Synthetic division',
        rankRequired: 'FF',
        isFloating: false,
        isVacantByDesign: false,
        isExcludedFromCount: false,
      },
    ],
    rules: [],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  });
}

function request() {
  return {
    kind: 'profile-review' as const,
    expected: {
      kind: 'version' as const,
      versionId: 'synthetic-profile-version',
      revision: 2,
      sha256: BASELINE,
    },
    intent: { operation: 'save' as const, content: content('PROFILE_EDITS_PENDING_REVIEW') },
  };
}

function materialized(): Extract<BidProfileReviewResponse, { kind: 'MATERIALIZED' }> {
  const parsed = BidProfileReviewResponseSchema.parse({
    valid: true,
    kind: 'MATERIALIZED',
    v: 1,
    bidYear: YEAR,
    source: {
      kind: 'UNSAVED_DRAFT',
      baselineContentSha256: BASELINE,
      candidateContentSha256: CANDIDATE,
    },
    capturedAtMs: 1_799_000_000_000,
    runtimeSourceToken: RUNTIME,
    reviewSha256: REVIEW,
    profileMappings: [
      {
        id: 'synthetic-profile',
        name: 'Synthetic profile',
        sourceRef: 'Synthetic approved profile source',
        scope: { kind: 'position', positionId: POSITION },
        positionIds: [POSITION],
      },
    ],
    materialized: {
      content: content('MATERIALIZED_FOR_CURRENT_VERSION'),
      contentSha256: CANDIDATE,
      compiled: [],
    },
    summary: {
      affectedPositionIds: [POSITION],
      affectedPositionCount: 1,
      eligibilityChangeCount: 0,
      scoringChangeCount: 0,
      relativePriorityChangeCount: 0,
      impact: { status: 'UNAVAILABLE', code: 'selection_context_required' },
      selectionConsequences: {
        status: 'REQUIRES_SELECTION_CONTEXT',
        areas: ['A_DAY_CAPACITY', 'NEXT_BIDDER', 'SPECIALTY_INTERRUPTION', 'POSITION_AWARDS'],
      },
    },
  });
  if (parsed.kind !== 'MATERIALIZED') throw new Error('Expected materialized synthetic fixture');
  return parsed;
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

function serve(body: unknown) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    String(input) === '/api/auth/csrf' ? response({ token: CSRF }) : response(body),
  );
  browser.fetch = fetcher;
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

describe('Current Bid profile-review request identity', () => {
  it('uses the no-write preview request and accepts only a reviewed materialization', async () => {
    const result = materialized();
    const fetcher = serve(result);
    const body = request();

    await expect(
      client.bidRequest(YEAR, 'preview', BidProfileReviewResponseSchema, { body }),
    ).resolves.toEqual(result);

    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/auth/csrf',
      '/api/admin/bid/2027/preview',
    ]);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(body),
    });
    const headers = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(headers.get('X-MBFD-CSRF')).toBe(CSRF);
    expect(headers.get('Idempotency-Key')).toBeNull();
  });

  it.each([
    [
      'different baseline',
      (value: ReturnType<typeof materialized>) => ({
        ...value,
        source: { ...value.source, baselineContentSha256: 'f'.repeat(64) },
      }),
    ],
    [
      'unreviewed materialized content',
      (value: ReturnType<typeof materialized>) => ({
        ...value,
        materialized: {
          ...value.materialized,
          content: content('PROFILE_EDITS_PENDING_REVIEW'),
        },
      }),
    ],
  ])('rejects a schema-valid result with %s', async (_label, alter) => {
    const result = alter(materialized());
    expect(BidProfileReviewResponseSchema.safeParse(result).success).toBe(true);
    serve(result);

    await expect(
      client.bidRequest(YEAR, 'preview', BidProfileReviewResponseSchema, { body: request() }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', status: 200, uncertain: false });
  });
});
