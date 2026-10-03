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
let begin: ReturnType<typeof vi.fn<() => boolean>>;
let finish: ReturnType<typeof vi.fn<() => void>>;
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
  await render(current, props);
}

async function render(
  current = base(),
  props: Partial<React.ComponentProps<typeof BidLiveReview>> = {},
) {
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
        onOpenAuthority={vi.fn()}
        onOpenAssignmentTerms={vi.fn()}
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
  it('offers one explicit Real creation acknowledgement for 27 source questions and 2 held credentials', async () => {
    const launchReview = {
      advisorySha256: 'f'.repeat(64),
      requiresAcknowledgement: true,
      advisories: [
        {
          id: 'source_decisions',
          code: 'unresolved_source_decisions',
          affectedCount: 27,
          detail: '27 source questions remain unresolved. Starting does not resolve them.',
        },
        {
          id: 'qualification_holds',
          code: 'credential_import_dispute_requires_review',
          affectedCount: 2,
          detail: '2 held credentials remain excluded from eligibility and points.',
        },
      ],
    };
    result = { ...allowedReadiness(), launchReview };
    const execute = vi.fn(async () => {});
    await mount(base(), { execute });
    await click('Check Real Bid');
    const details = [...container.querySelectorAll('details')].find(
      (node) => node.querySelector('summary')?.textContent === 'Launch advisories (2)',
    );
    expect(details?.open).toBe(false);
    expect(details?.querySelectorAll('li')).toHaveLength(2);
    expect(execute).not.toHaveBeenCalled();
    expect(container.querySelector('input')).toBeNull();
    await click('Create Real with advisories');
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      path: 'live-sessions',
      key: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      body: {
        versionId: base().version?.id,
        versionSha256: DIGEST,
        expectedContextSha256: 'b'.repeat(64),
        expectedSourceToken: 'c'.repeat(64),
        launchAcknowledgement: { advisorySha256: launchReview.advisorySha256 },
      },
    });
    expect(requests.every(({ url }) => url.endsWith('/csrf') || url.endsWith('/preview'))).toBe(
      true,
    );
  });
  it('requires separate creation confirmation and sends exactly the reviewed pins without starting', async () => {
    result = allowedReadiness();
    const execute = vi.fn(async () => {});
    await mount(base(), { execute });
    await click('Check Real Bid');
    expect(execute).not.toHaveBeenCalled();
    await click('Confirm Real Bid creation');
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      path: 'live-sessions',
      key: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      body: {
        versionId: base().version?.id,
        versionSha256: DIGEST,
        expectedContextSha256: 'b'.repeat(64),
        expectedSourceToken: 'c'.repeat(64),
      },
    });
    expect(requests.every(({ url }) => url.endsWith('/csrf') || url.endsWith('/preview'))).toBe(
      true,
    );
  });

  it.each(['dirty', 'stale', 'locked', 'busy'] as const)(
    'denies readiness and explicit creation when %s becomes true',
    async (flag) => {
      result = allowedReadiness();
      const execute = vi.fn(async () => {});
      await mount(base(), { execute });
      await click('Check Real Bid');
      await render(base(), { execute, [flag]: true });
      expect(button(flag === 'busy' ? 'Checking…' : 'Check Real Bid').disabled).toBe(true);
      expect(button('Confirm Real Bid creation').disabled).toBe(true);
      await click('Confirm Real Bid creation');
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('invalidates an open confirmation when the saved source version changes', async () => {
    result = allowedReadiness();
    const execute = vi.fn(async () => {});
    await mount(base(), { execute });
    await click('Check Real Bid');
    const previous = base();
    const next = CurrentBidSchema.parse({
      ...previous,
      version: {
        ...previous.version,
        id: 'synthetic-next-version',
        versionNumber: 3,
        contentSha256: 'd'.repeat(64),
      },
      expected: {
        kind: 'version',
        versionId: 'synthetic-next-version',
        revision: 3,
        sha256: 'd'.repeat(64),
      },
    });
    await render(next, { execute });
    expect(() => button('Confirm Real Bid creation')).toThrow('Missing public button');
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses the step-up-aware read-only Live preview for the exact immutable current version', async () => {
    await mount();
    await click('Check Real Bid');

    // The CSRF token may already be cached by another review in this tab.
    expect(
      requests.every(
        ({ url }) => url.endsWith('/csrf') || url === `/api/admin/bid/${YEAR}/preview`,
      ),
    ).toBe(true);
    const previews = requests.filter(({ url }) => url === `/api/admin/bid/${YEAR}/preview`);
    expect(previews).toHaveLength(1);
    const preview = previews[0];
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
    expect(container.textContent).toContain('These checks must pass before launch.');
    expect(container.textContent).toContain(
      'annual operations policy: Annual operations cannot start: stages_required.',
    );
    expect(container.textContent).toContain(
      'operator authorization: A fresh, server-verified administrator authorization is required.',
    );
    expect(container.textContent).toContain('Checking does not start or create a session.');
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
    await click('Check Real Bid');

    expect(container.textContent).toContain(
      'Real Bid needs review: bid configuration annual policy document invalid.',
    );
    expect(container.textContent).toContain('Opportunities requiring review: synthetic-live-seat');
    expect(container.textContent).toContain('synthetic-live-seat: missing start');
    expect(container.textContent).not.toContain('Server Live readiness:');
    expect(requests.map((request) => request.url)).toEqual([`/api/admin/bid/${YEAR}/preview`]);
  });

  it('explains an assignment-term block and opens the exact editing section', async () => {
    const onOpenAssignmentTerms = vi.fn();
    result = {
      wouldAllowCreateLive: false,
      policyError: 'assignment_term_evidence_requires_review',
      positionIds: ['D102'],
      termIssues: [
        {
          positionId: 'D102',
          code: 'term_evidence_required',
          sourceRef: 'PDF p1 Procedure1 and footnote1',
        },
      ],
    };
    await mount(base(), { onOpenAssignmentTerms });
    await click('Check Real Bid');
    expect(container.textContent).toContain('Assignment terms need review.');
    expect(container.textContent).toContain('Mock training remains available.');
    expect(container.querySelector('a[href="/admin/source-review"]')?.textContent).toContain(
      'Review source decisions and evidence',
    );
    expect(container.textContent).toContain('D102: Record the reviewed assignment term.');
    await click('Edit assignment terms');
    expect(onOpenAssignmentTerms).toHaveBeenCalledOnce();
  });

  it('requires a saved immutable version before a Managed Live preflight', async () => {
    await mount(withoutSavedVersion());

    expect(container.textContent).toContain(
      'Save the first Bid version before preparing the Real Bid.',
    );
    expect(button('Check Real Bid').disabled).toBe(true);
    await click('Check Real Bid');
    expect(requests).toEqual([]);
  });

  it('does not review a saved version while the browser still has unsaved Bid edits', async () => {
    await mount(base(), { dirty: true });

    expect(container.textContent).toContain(
      'Save or discard your changes before preparing the Real Bid.',
    );
    expect(button('Check Real Bid').disabled).toBe(true);
    await click('Check Real Bid');
    expect(requests).toEqual([]);
  });

  it('reports a server-ready preflight while still offering no Live-session action', async () => {
    result = allowedReadiness();
    await mount();
    await click('Check Real Bid');

    expect(container.textContent).toContain('Ready to prepare the Real Bid.');
    expect(container.textContent).toContain(
      'annual operations policy: Annual operations are frozen and complete.',
    );
    expect(container.textContent).toContain('Checking does not start or create a session.');
    expect(
      [...container.querySelectorAll('button')].map((node) => node.textContent?.trim()),
    ).toEqual(['Edit permissions', 'Check Real Bid']);
  });

  it('rejects an unrecognized Live preflight field instead of trusting an ambiguous server response', async () => {
    result = { ...blockedReadiness(), unreviewedLiveSessionId: 'forbidden' };
    await mount();
    await click('Check Real Bid');

    expect(container.textContent).toContain('invalid server response');
    expect(container.textContent).not.toContain('Resolve these items before the Real Bid.');
  });
});
