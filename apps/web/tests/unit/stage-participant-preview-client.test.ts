import {
  type BidStageParticipantPreviewResponse,
  BidStageParticipantPreviewResponseSchema,
} from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const YEAR = 2027;
const BASELINE = 'a'.repeat(64);
const CANDIDATE = 'b'.repeat(64);
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function request() {
  return {
    kind: 'stage-participant-membership' as const,
    expected: {
      kind: 'version' as const,
      versionId: 'synthetic-preview-version',
      revision: 2,
      sha256: BASELINE,
    },
    intent: {
      operation: 'save' as const,
      content: { bidYear: YEAR, policy: { stageParticipantSources: [] } },
    },
  };
}

function preview(): Extract<BidStageParticipantPreviewResponse, { valid: true }> {
  const body = request();
  const value = BidStageParticipantPreviewResponseSchema.parse({
    valid: true,
    v: 1,
    bidYear: YEAR,
    definition: {
      kind: 'VERSION',
      versionId: body.expected.versionId,
      revision: body.expected.revision,
      contentSha256: body.expected.sha256,
    },
    source: {
      kind: 'UNSAVED_DRAFT',
      baselineContentSha256: BASELINE,
      candidateContentSha256: CANDIDATE,
    },
    capturedAtMs: 1_799_000_000_000,
    runtimeSourceToken: 'c'.repeat(64),
    contextSha256: 'd'.repeat(64),
    participantPreviewSha256: 'e'.repeat(64),
    orderingAuthority: {
      status: 'UNRESOLVED',
      request: null,
      code: 'ordering_authority_unconfigured',
    },
    membership: { status: 'RESOLVED_FOR_PREVIEW' },
    stages: [
      {
        stageId: 'synthetic-stage',
        label: 'Synthetic stage',
        order: 0,
        source: {
          sourceRef: 'Synthetic participant source',
          participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10001] },
          ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
        },
        matchedMemberIds: [10001],
        displayOrder: 'MEMBER_ID_ASC',
        matchedMembers: [
          {
            memberId: 10001,
            displayName: 'Synthetic First',
            rank: 'FF',
            rscSeniority: 1,
            rankSeniority: 1,
          },
        ],
      },
    ],
    executionReady: false,
    executionIssues: ['ordering_authority_unconfigured'],
  });
  if (!value.valid) throw new Error('Synthetic membership preview must be valid.');
  return value;
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

describe('stage participant membership preview client contract', () => {
  it('sends the server-only preview without a mutation key and accepts an exact identity-bound result', async () => {
    const result = preview();
    const fetcher = serve(result);
    const body = request();

    await expect(
      client.bidRequest(YEAR, 'preview', BidStageParticipantPreviewResponseSchema, { body }),
    ).resolves.toEqual(result);

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

  it('rejects a schema-valid response bound to a different saved definition', async () => {
    const result = preview();
    result.definition = {
      kind: 'VERSION',
      versionId: 'different-definition',
      revision: 3,
      contentSha256: 'f'.repeat(64),
    };
    serve(result);

    await expect(
      client.bidRequest(YEAR, 'preview', BidStageParticipantPreviewResponseSchema, {
        body: request(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_server_response', uncertain: false });
  });
});
