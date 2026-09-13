// @vitest-environment jsdom
import type { BidDefinitionContent } from '@mbfd/shared';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidLiveReview } from '../../app/admin/current-bid/BidLiveReview';
import { type CurrentBid, CurrentBidSchema } from '../../app/admin/current-bid/bid-client';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const YEAR = 2027;
const DIGEST = 'a'.repeat(64);
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';

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
    notes: { bid: 'Synthetic saved Bid', positions: null },
    policy: null,
    planning: null,
    authoring: null,
    positions: [],
    rules: [],
    participation: [],
    staffingBindings: [],
    sourceDecisions: [],
  };
}

function base(): CurrentBid {
  return CurrentBidSchema.parse({
    bidYear: YEAR,
    state: 'VERSIONED',
    version: {
      id: 'synthetic-live-version',
      versionNumber: 2,
      contentSha256: DIGEST,
      createdAtMs: 1_799_000_000_000,
      actorSubject: 'synthetic-admin-10001',
      reason: 'Synthetic saved version',
      predecessorId: 'synthetic-live-version-1',
      restoredFromId: null,
    },
    expected: {
      kind: 'version',
      versionId: 'synthetic-live-version',
      revision: 2,
      sha256: DIGEST,
    },
    content: content(),
    coverage: {
      valid: true,
      ruleCount: 0,
      missingBiddablePositionIds: [],
      invalidPositionIds: [],
      duplicatePositionIds: [],
      nonBiddablePositionIds: [],
      unexpectedPositionIds: [],
    },
    stats: {
      opportunityCount: 0,
      ruleCount: 0,
      biddableCount: 0,
      administrativelyAssignedCount: 0,
      reservedCount: 0,
      excludedCount: 0,
      missingRuleCount: 0,
    },
  });
}

function withoutSavedVersion(): CurrentBid {
  return CurrentBidSchema.parse({
    ...base(),
    state: 'LEGACY_UNADOPTED',
    version: null,
    expected: { kind: 'legacy', sourceToken: DIGEST },
  });
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pool() {
  return {
    officerPoolCount: 2,
    firefighterPoolCount: 11,
    excludedCount: 3,
    administrativeAssignmentExcludedCount: 1,
  };
}

function blockedReadiness() {
  return {
    wouldAllowCreateLive: false,
    versionId: base().version?.id,
    versionSha256: DIGEST,
    versionNumber: 2,
    contextSha256: 'b'.repeat(64),
    runtimeSourceToken: 'c'.repeat(64),
    pool: pool(),
    readiness: {
      checks: [
        {
          id: 'annual_operations_policy',
          status: 'BLOCKING',
          detail: 'Annual operations cannot start: stages_required.',
        },
        {
          id: 'operator_authorization',
          status: 'NOT_CONFIGURED',
          detail: 'A fresh, server-verified administrator authorization is required.',
        },
        {
          id: 'writeback_safety',
          status: 'READY',
          detail: 'Writeback is disabled.',
        },
      ],
      overallStatus: 'BLOCKING',
      canStartLiveBid: false,
      blockingCheckIds: ['annual_operations_policy', 'operator_authorization'],
    },
  };
}

function allowedReadiness() {
  return {
    ...blockedReadiness(),
    wouldAllowCreateLive: true,
    readiness: {
      checks: [
        {
          id: 'annual_operations_policy',
          status: 'READY',
          detail: 'Annual operations are frozen and complete.',
        },
      ],
      overallStatus: 'READY',
      canStartLiveBid: true,
      blockingCheckIds: [],
    },
  };
}

type RequestEntry = { url: string; init: RequestInit | undefined };
let root: Root | undefined;
let container: HTMLDivElement;
let requests: RequestEntry[];
let result: unknown;
let begin: ReturnType<typeof vi.fn>;
let finish: ReturnType<typeof vi.fn>;
let originalWindowFetch: typeof fetch;

beforeEach(() => {
  requests = [];
  result = blockedReadiness();
  begin = vi.fn(() => true);
  finish = vi.fn();
  originalWindowFetch = window.fetch;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    requests.push({ url: url.pathname, init });
    if (url.pathname === '/api/auth/csrf') return response({ token: CSRF });
    if (url.pathname === `/api/admin/bid/${YEAR}/preview`) return response(result);
    throw new Error(`Unexpected request: ${url.pathname}`);
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

async function mount(
  current = base(),
  props: Partial<React.ComponentProps<typeof BidLiveReview>> = {},
) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() =>
    root?.render(
      <BidLiveReview
        base={current}
        year={YEAR}
        busy={false}
        locked={false}
        dirty={false}
        stale={false}
        begin={begin}
        finish={finish}
        {...props}
      />,
    ),
  );
}

function button(name: string | RegExp): HTMLButtonElement {
  const candidate = [...container.querySelectorAll<HTMLButtonElement>('button')].find((node) => {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return typeof name === 'string' ? text === name : name.test(text);
  });
  if (!candidate) throw new Error(`Missing public button: ${name}`);
  return candidate;
}

async function click(name: string | RegExp) {
  await settle(() => button(name).click());
}

describe('BidLiveReview', () => {
  it('uses the step-up-aware read-only Live preview for the exact immutable current version', async () => {
    await mount();
    await click('Check Managed Live readiness');

    expect(requests.map((request) => request.url)).toEqual([
      '/api/auth/csrf',
      `/api/admin/bid/${YEAR}/preview`,
    ]);
    const preview = requests[1];
    expect(preview?.init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        kind: 'live',
        versionId: base().version?.id,
        versionSha256: DIGEST,
      }),
    });
    expect(new Headers(preview?.init?.headers).get('X-MBFD-CSRF')).toBe(CSRF);
    expect(new Headers(preview?.init?.headers).get('Idempotency-Key')).toBeNull();
    expect(finish).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Live readiness is blocked by the server.');
    expect(container.textContent).toContain(
      'annual operations policy (annual_operations_policy): Annual operations cannot start: stages_required.',
    );
    expect(container.textContent).toContain(
      'operator authorization (operator_authorization): A fresh, server-verified administrator authorization is required.',
    );
    expect(container.textContent).toContain('No Live run is created by this check.');
    expect([...container.querySelectorAll('button')].map((node) => node.textContent)).not.toContain(
      'Create Live Bid',
    );
  });

  it('shows explicit server policy preparation blocks without inventing readiness or a Live action', async () => {
    result = {
      wouldAllowCreateLive: false,
      policyError: 'bid_configuration_annual_policy_document_invalid',
      positionIds: ['synthetic-live-seat'],
      tenureIssues: [
        {
          staffingPositionId: 'synthetic-live-seat',
          code: 'missing_start',
          recordId: 'synthetic-live-tenure',
        },
      ],
    };
    await mount();
    await click('Check Managed Live readiness');

    expect(container.textContent).toContain(
      'Live policy preparation is blocked: bid_configuration_annual_policy_document_invalid.',
    );
    expect(container.textContent).toContain('Opportunities requiring review: synthetic-live-seat');
    expect(container.textContent).toContain('synthetic-live-seat: missing start');
    expect(container.textContent).not.toContain('Server Live readiness:');
    expect(requests.map((request) => request.url)).toEqual([`/api/admin/bid/${YEAR}/preview`]);
  });

  it('requires a saved immutable version before a Managed Live preflight', async () => {
    await mount(withoutSavedVersion());

    expect(container.textContent).toContain(
      'No saved Bid version exists. Save the first Bid version before checking Managed Live readiness.',
    );
    expect(button('Check Managed Live readiness').disabled).toBe(true);
    await click('Check Managed Live readiness');
    expect(requests).toEqual([]);
  });

  it('does not review a saved version while the browser still has unsaved Bid edits', async () => {
    await mount(base(), { dirty: true });

    expect(container.textContent).toContain(
      'The current draft has unsaved changes. Save or discard them before checking Managed Live readiness.',
    );
    expect(button('Check Managed Live readiness').disabled).toBe(true);
    await click('Check Managed Live readiness');
    expect(requests).toEqual([]);
  });

  it('reports a server-ready preflight while still offering no Live-session action', async () => {
    result = allowedReadiness();
    await mount();
    await click('Check Managed Live readiness');

    expect(container.textContent).toContain('Server Live readiness: ready.');
    expect(container.textContent).toContain(
      'The server reports that this saved version currently meets its Live readiness checks.',
    );
    expect(container.textContent).toContain(
      'annual operations policy (annual_operations_policy): Annual operations are frozen and complete.',
    );
    expect(container.textContent).toContain('No Live run is created by this check.');
    expect(
      [...container.querySelectorAll('button')].map((node) => node.textContent?.trim()),
    ).toEqual(['Check Managed Live readiness']);
  });

  it('rejects an unrecognized Live preflight field instead of trusting an ambiguous server response', async () => {
    result = { ...blockedReadiness(), unreviewedLiveSessionId: 'forbidden' };
    await mount();
    await click('Check Managed Live readiness');

    expect(container.textContent).toContain('invalid server response');
    expect(container.textContent).not.toContain('Live readiness is blocked by the server.');
  });
});
