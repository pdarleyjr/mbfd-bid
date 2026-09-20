// @vitest-environment jsdom
import {
  type BidDefinitionContent,
  type BidStageParticipantPreviewResponse,
  BidStageParticipantPreviewResponseSchema,
} from '@mbfd/shared';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StageParticipantPreview } from '../../app/admin/current-bid/StageParticipantPreview';
import type { BidExpected } from '../../app/admin/current-bid/bid-client';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const YEAR = 2027;
const BASELINE = 'a'.repeat(64);
const CANDIDATE = 'b'.repeat(64);
const CONTEXT = 'c'.repeat(64);
const SOURCE = 'd'.repeat(64);
const PREVIEW = 'e'.repeat(64);
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';
const expected: Extract<BidExpected, { kind: 'version' }> = {
  kind: 'version',
  versionId: 'synthetic-membership-version',
  revision: 2,
  sha256: BASELINE,
};

function content(note = 'Synthetic source') {
  return {
    bidYear: YEAR,
    notes: { bid: note },
    policy: {
      stageParticipantSources: [
        {
          stageId: 'synthetic-stage',
          sourceRef: 'Synthetic participant authority',
          participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10002, 10001] },
          ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
        },
      ],
    },
  } as unknown as BidDefinitionContent;
}

function preview(): Extract<BidStageParticipantPreviewResponse, { valid: true }> {
  const value = BidStageParticipantPreviewResponseSchema.parse({
    valid: true,
    v: 1,
    bidYear: YEAR,
    definition: {
      kind: 'VERSION',
      versionId: expected.versionId,
      revision: expected.revision,
      contentSha256: expected.sha256,
    },
    source: {
      kind: 'UNSAVED_DRAFT',
      baselineContentSha256: BASELINE,
      candidateContentSha256: CANDIDATE,
    },
    capturedAtMs: 1_799_000_000_000,
    runtimeSourceToken: SOURCE,
    contextSha256: CONTEXT,
    participantPreviewSha256: PREVIEW,
    orderingAuthority: {
      status: 'UNRESOLVED',
      request: {
        v: 1,
        sourceDecisionId: 'synthetic-annual-policy-decision',
        comparator: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
      },
      code: 'ordering_authority_source_decision_unresolved',
    },
    membership: { status: 'RESOLVED_FOR_PREVIEW' },
    stages: [
      {
        stageId: 'synthetic-stage',
        label: 'Synthetic stage',
        order: 0,
        source: {
          sourceRef: 'Synthetic participant authority',
          participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [10002, 10001] },
          ordering: [{ key: 'RSC_SENIORITY', direction: 'ASC' }],
        },
        matchedMemberIds: [10001, 10002],
        displayOrder: 'MEMBER_ID_ASC',
        matchedMembers: [
          {
            memberId: 10001,
            displayName: 'Synthetic First',
            rank: 'FF',
            rscSeniority: 3,
            rankSeniority: 7,
          },
          {
            memberId: 10002,
            displayName: 'Synthetic Second',
            rank: 'LT',
            rscSeniority: 4,
            rankSeniority: null,
          },
        ],
      },
    ],
    executionReady: false,
    executionIssues: ['ordering_authority_source_decision_unresolved'],
  });
  if (!value.valid) throw new Error('Synthetic membership preview must be valid.');
  return value;
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;
let requests: unknown[];
let props: Parameters<typeof StageParticipantPreview>[0];

beforeEach(() => {
  requests = [];
  originalWindowFetch = window.fetch;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === '/api/auth/csrf') return response({ token: CSRF });
    if (path !== `/api/admin/bid/${YEAR}/preview`) throw new Error(`Unexpected request ${path}`);
    requests.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    return response(preview());
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.fetch = originalWindowFetch;
  document.body.replaceChildren();
});

async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(value = content()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = { content: value, expected, year: YEAR, locked: false };
  await rerender();
}

async function rerender(next: Partial<typeof props> = {}) {
  props = { ...props, ...next };
  await settle(() => root?.render(<StageParticipantPreview {...props} />));
}

function button(text: string) {
  const matches = [...container.querySelectorAll('button')].filter(
    (node) => node.textContent?.trim() === text,
  );
  if (matches.length !== 1)
    throw new Error(`Expected one button '${text}', found ${matches.length}`);
  const match = matches[0];
  if (!match) throw new Error(`Missing button '${text}'`);
  return match;
}

describe('StageParticipantPreview', () => {
  it('uses one server-only all-stage request, shows the captured display sequence, and clears it after edits', async () => {
    await mount();
    await settle(() => button('Preview participant membership').click());

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      body: {
        kind: 'stage-participant-membership',
        expected,
        intent: { operation: 'save', content: props.content },
      },
    });
    expect((requests[0] as { headers: Headers }).headers.get('Idempotency-Key')).toBeNull();
    expect((requests[0] as { headers: Headers }).headers.get('X-MBFD-CSRF')).toBe(CSRF);
    expect(container.textContent).toContain('Preview-resolved members · Synthetic stage');
    expect(container.textContent).toContain('Synthetic participant authority');
    expect(container.textContent).toContain('Matched participant IDs: 10001, 10002');
    expect(container.textContent).toContain('Display-only member-ID order');
    expect(container.textContent).toContain('Synthetic First · ID 10001 · FF');
    expect(container.textContent).toContain('Synthetic Second · ID 10002 · LT');
    expect(container.textContent).toContain('Governing comparator decision is awaiting resolution');
    expect(container.textContent).toContain('does not create, approve, or authorize a Bid run');
    expect(container.textContent?.toLowerCase()).not.toContain('frozen');

    await rerender({ content: content('Edited after preview') });
    expect(container.textContent).not.toContain('Synthetic First · ID 10001 · FF');
    expect(requests).toHaveLength(1);
  });

  it('does not offer a membership request for legacy content without typed sources', async () => {
    await mount({ bidYear: YEAR, policy: {} } as unknown as BidDefinitionContent);
    expect(container.querySelector('button')).toBeNull();
    expect(requests).toEqual([]);
  });
});
