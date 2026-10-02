// @vitest-environment jsdom
import type { BidDefinitionContent } from '@mbfd/shared';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidRetainedParticipation } from '../../app/admin/current-bid/BidRetainedParticipation';
import { CurrentBidWorkspace } from '../../app/admin/current-bid/CurrentBidWorkspace';
import { readBidDraft } from '../../app/admin/current-bid/bid-draft';
import { OPERATOR_AUTH_REFRESHED, OPERATOR_REAUTH_STARTED } from '../../lib/operator-step-up';
import { retainedParticipationFixture } from '../fixtures/retained-participation';

const navigation = vi.hoisted(() => ({ search: '', replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock('../../app/admin/current-bid/BidOperations', () => ({ BidOperations: () => null }));
vi.mock('../../app/admin/current-bid/BidPolicyFields', () => ({
  BidPolicyFields: ({
    content,
    onChange,
  }: { content: BidDefinitionContent; onChange(content: BidDefinitionContent): void }) => (
    <button
      type="button"
      onClick={() =>
        onChange({ ...content, notes: { ...content.notes, bid: 'Synthetic edited draft' } })
      }
    >
      Edit synthetic draft
    </button>
  ),
}));
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const ACTOR = 'synthetic-admin:950001:1';
const PREVIEW = 'retained-participation/preview';
const REVIEW = 'Review retained participation';
const LOAD = 'Load reviewed participation into draft';
type Entry = { path: string; method: string; body: unknown; key: string | null };
let fixture: ReturnType<typeof retainedParticipationFixture>;
let entries: Entry[];
let handler: (entry: Entry) => Response | Promise<Response> | undefined;
let root: Root;
let container: HTMLDivElement;
let originalFetch: typeof fetch;
const onApply = vi.fn();
const onReviewSources = vi.fn();
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function render({
  actor = ACTOR,
  base = fixture.base,
  disabled = false,
  draftStamp = JSON.stringify(base.content),
} = {}) {
  await settle(() =>
    root.render(
      <BidRetainedParticipation
        actorScope={actor}
        base={base}
        disabled={disabled}
        draftStamp={draftStamp}
        onApply={onApply}
        onReviewSources={onReviewSources}
      />,
    ),
  );
}
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === name);
async function click(name: string) {
  const target = button(name);
  if (!target) throw new Error(`Missing public control: ${name}`);
  await settle(() => target.click());
}
const previewCalls = () => entries.filter((entry) => entry.path === PREVIEW);
beforeEach(() => {
  fixture = retainedParticipationFixture();
  entries = [];
  handler = () => undefined;
  onApply.mockReset();
  onReviewSources.mockReset();
  originalFetch = window.fetch;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/auth/csrf')
      return response({ token: 'csrf_11111111-1111-4111-8111-111111111111' });
    const entry: Entry = {
      path: url.pathname.replace('/api/admin/bid/2026/', ''),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      key: new Headers(init?.headers).get('Idempotency-Key'),
    };
    entries.push(entry);
    const custom = await handler(entry);
    if (custom) return custom;
    if (entry.path === PREVIEW) return response(fixture.proposal);
    if (entry.path === 'current') return response(fixture.base);
    throw new Error(`Unexpected API request: ${entry.method} ${entry.path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  navigation.search = '';
  navigation.replace.mockImplementation((url: string) => {
    navigation.search = new URL(url, window.location.origin).search;
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.fetch = originalFetch;
  window.sessionStorage.clear();
  document.body.replaceChildren();
});

describe('retained participation proposal', () => {
  it('starts collapsed and makes no automatic requests', async () => {
    await render();
    expect(container.querySelector('details')?.open).toBe(false);
    expect(entries).toEqual([]);
    expect(onApply).not.toHaveBeenCalled();
  });
  it.each(['OPEN', 'absent', 'duplicate'] as const)(
    'requires the unique saved resolved LT decision: %s',
    async (kind) => {
      if (kind === 'absent') fixture.base.content.sourceDecisions = [];
      else {
        const decision = fixture.base.content.sourceDecisions[0];
        if (!decision) throw new Error('Synthetic LT source decision required');
        if (kind === 'OPEN') decision.status = 'OPEN';
        else fixture.base.content.sourceDecisions.push(structuredClone(decision));
      }
      await render();
      await click(REVIEW);
      expect(entries).toEqual([]);
      expect(container.textContent).toContain('then Save Bid');
      await click('Review source decisions');
      expect(onReviewSources).toHaveBeenCalledOnce();
      expect(onApply).not.toHaveBeenCalled();
    },
  );
  it('shows exact server counts, retained people, closed positions and source proof', async () => {
    await render();
    await click(REVIEW);
    expect(previewCalls()).toEqual([
      { path: PREVIEW, method: 'POST', body: { expected: fixture.base.expected }, key: null },
    ]);
    expect(container.textContent).toContain('222 → 218');
    expect(container.textContent).toContain('284 → 276');
    expect(container.textContent).toContain('Lieutenants: 41 → 38');
    expect(container.textContent).toContain(fixture.proposal.retained[0]?.displayName);
    expect(container.textContent).toContain('SYN-CPT-RETAINED · retained, closed to bidding');
    expect(container.textContent).toContain(fixture.proposal.source.evaluationSha256);
    expect(onApply).not.toHaveBeenCalled();
  });
  it('refreshes the saved head before explicitly loading the complete server content, with zero writes', async () => {
    await render();
    await click(REVIEW);
    await click(LOAD);
    expect(entries.map((entry) => [entry.method, entry.path])).toEqual([
      ['POST', PREVIEW],
      ['GET', 'current'],
    ]);
    expect(onApply).toHaveBeenCalledExactlyOnceWith(fixture.proposal);
    expect(button(LOAD)).toBeUndefined();
  });
  it('does not hardcode participant counts', async () => {
    fixture.proposal.beforeCounts.ordinaryParticipants = 12;
    fixture.proposal.beforeCounts.ranks = { CPT: 3, LT: 5, FF: 4 };
    fixture.proposal.counts.ordinaryParticipants = 8;
    fixture.proposal.counts.ranks = { CPT: 2, LT: 2, FF: 4 };
    await render();
    await click(REVIEW);
    expect(container.textContent).toContain('12 → 8');
    expect(container.textContent).not.toContain('222 → 218');
  });
  it('blocks a dirty or pending draft and invalidates a reviewed proposal when it changes', async () => {
    await render({ disabled: true });
    await click(REVIEW);
    expect(entries).toEqual([]);
    await render();
    await click(REVIEW);
    await render({ disabled: true, draftStamp: 'Synthetic dirty draft' });
    expect(button(LOAD)).toBeUndefined();
    expect(onApply).not.toHaveBeenCalled();
  });
  it.each(['actor', 'head', 'draft'] as const)(
    'discards a late preview after %s changes',
    async (change) => {
      let resolve!: (value: Response) => void;
      handler = (entry) =>
        entry.path === PREVIEW
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : undefined;
      await render();
      await click(REVIEW);
      if (change === 'actor') await render({ actor: 'synthetic-other:950999:2' });
      else if (change === 'draft')
        await render({ draftStamp: 'Synthetic changed reason or draft' });
      else {
        const next = structuredClone(fixture.base);
        if (!fixture.base.version) throw new Error('Synthetic saved version required');
        next.expected = {
          kind: 'version',
          versionId: 'synthetic-new-head',
          revision: 13,
          sha256: '9'.repeat(64),
        };
        next.version = {
          ...fixture.base.version,
          id: 'synthetic-new-head',
          versionNumber: 13,
          contentSha256: '9'.repeat(64),
        };
        await render({ base: next });
      }
      await settle(() => resolve(response(fixture.proposal)));
      expect(button(LOAD)).toBeUndefined();
      expect(onApply).not.toHaveBeenCalled();
    },
  );
  it.each([OPERATOR_REAUTH_STARTED, OPERATOR_AUTH_REFRESHED])(
    'discards a late preview after %s',
    async (event) => {
      let resolve!: (value: Response) => void;
      handler = (entry) =>
        entry.path === PREVIEW
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : undefined;
      await render();
      await click(REVIEW);
      await settle(() => window.dispatchEvent(new Event(event)));
      await settle(() => resolve(response(fixture.proposal)));
      expect(button(LOAD)).toBeUndefined();
      expect(onApply).not.toHaveBeenCalled();
    },
  );
  it.each(['unknown-field', 'bad-count', 'missing-derivation', 'wrong-year'] as const)(
    'rejects an unverified server response: %s',
    async (kind) => {
      const result = structuredClone(fixture.proposal);
      if (kind === 'unknown-field') Object.assign(result, { rawSnapshot: 'forbidden' });
      if (kind === 'bad-count') result.counts.ordinaryParticipants--;
      if (kind === 'wrong-year') result.content.bidYear = 2027;
      if (
        kind === 'missing-derivation' &&
        result.content.settings?.v === 3 &&
        result.content.settings.evidenceFreeze
      )
        result.content.settings.evidenceFreeze.derivation = undefined;
      handler = (entry) => (entry.path === PREVIEW ? response(result) : undefined);
      await render();
      await click(REVIEW);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'could not be verified',
      );
      expect(button(LOAD)).toBeUndefined();
    },
  );
  it('rejects a schema-valid proposal bound to another original source', async () => {
    const result = structuredClone(fixture.proposal);
    result.source.freezeId = 'synthetic-wrong-original';
    if (result.content.settings?.v !== 3 || !result.content.settings.evidenceFreeze?.derivation)
      throw new Error('Synthetic proof required');
    result.content.settings.evidenceFreeze.derivation.sourceFreezeId = result.source.freezeId;
    result.content.settings.evidenceFreeze.freezeId = result.source.freezeId;
    handler = (entry) => (entry.path === PREVIEW ? response(result) : undefined);
    await render();
    await click(REVIEW);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match');
    expect(button(LOAD)).toBeUndefined();
  });
  it('shows a normal source rejection and allows an explicit fresh review', async () => {
    handler = (entry) =>
      entry.path === PREVIEW
        ? response({ error: 'retained_participation_source_decision_required' }, 409)
        : undefined;
    await render();
    await click(REVIEW);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Save Bid before');
    expect(button(LOAD)).toBeUndefined();
    handler = () => undefined;
    await click(REVIEW);
    expect(button(LOAD)).toBeDefined();
    expect(previewCalls()).toHaveLength(2);
  });
  it('blocks Load when the refreshed remote head differs', async () => {
    const next = structuredClone(fixture.base);
    if (!fixture.base.version) throw new Error('Synthetic saved version required');
    next.expected = {
      kind: 'version',
      versionId: 'synthetic-new-head',
      revision: 13,
      sha256: '9'.repeat(64),
    };
    next.version = {
      ...fixture.base.version,
      id: 'synthetic-new-head',
      versionNumber: 13,
      contentSha256: '9'.repeat(64),
    };
    handler = (entry) => (entry.path === 'current' ? response(next) : undefined);
    await render();
    await click(REVIEW);
    await click(LOAD);
    expect(onApply).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('saved Bid changed');
  });
  it('does not load a draft when fresh readback fails', async () => {
    handler = (entry) =>
      entry.path === 'current'
        ? response({ error: 'synthetic_readback_unavailable' }, 503)
        : undefined;
    await render();
    await click(REVIEW);
    await click(LOAD);
    expect(onApply).not.toHaveBeenCalled();
    expect(button(LOAD)).toBeUndefined();
  });
  it('discards late Load readback when actor or draft changes', async () => {
    let resolve!: (value: Response) => void;
    handler = (entry) =>
      entry.path === 'current'
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : undefined;
    await render();
    await click(REVIEW);
    await click(LOAD);
    await render({ actor: 'synthetic-other:950999:2', draftStamp: 'Synthetic different draft' });
    await settle(() => resolve(response(fixture.base)));
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('retained proposal in the existing Current Bid workspace', () => {
  it('preserves the full server-produced draft and requires the ordinary explicit Save', async () => {
    await settle(() => root.render(<CurrentBidWorkspace year={2026} actorScope={ACTOR} />));
    await click(REVIEW);
    await click(LOAD);
    const draft = readBidDraft(window.sessionStorage, ACTOR, 2026);
    expect(draft?.content).toEqual(fixture.proposal.content);
    expect(draft?.base.content).toEqual(fixture.base.content);
    expect(draft?.pending).toBeNull();
    expect(draft?.content.sourceDecisions).toEqual(fixture.base.content.sourceDecisions);
    expect(container.textContent).toContain('Unsaved changes');
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/admin/current-bid?year=2026&view=edit&section=flow',
      { scroll: false },
    );
    expect(entries.filter((entry) => entry.method === 'POST').map((entry) => entry.path)).toEqual([
      PREVIEW,
    ]);
    handler = (entry) =>
      entry.path === 'versions' ? response({ error: 'synthetic_save_rejected' }, 409) : undefined;
    await click('Save Bid');
    const save = entries.find((entry) => entry.path === 'versions');
    expect(save?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(save?.body).toMatchObject({
      expected: fixture.base.expected,
      content: fixture.proposal.content,
    });
    expect(
      entries.some((entry) => /mock-sessions|live-sessions|commands|start/.test(entry.path)),
    ).toBe(false);
  });
  it('keeps an edited workspace draft and sends no retained request', async () => {
    await settle(() => root.render(<CurrentBidWorkspace year={2026} actorScope={ACTOR} />));
    await click('Edit synthetic draft');
    await click(REVIEW);
    expect(previewCalls()).toEqual([]);
    expect(readBidDraft(window.sessionStorage, ACTOR, 2026)?.content.notes.bid).toBe(
      'Synthetic edited draft',
    );
  });
});
