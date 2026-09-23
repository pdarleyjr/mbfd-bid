// @vitest-environment jsdom
import type { BidDefinitionContent, BidImpactResponse } from '@mbfd/shared';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
// Only the expensive field/catalog children are replaced. Request parsing,
// draft storage, the workspace controls and its step-up listener remain real.
vi.mock('../../app/admin/current-bid/BidPolicyFields', () => ({
  BidPolicyFields: ({
    content,
    onChange,
  }: {
    content: BidDefinitionContent;
    onChange(content: BidDefinitionContent): void;
  }) => (
    <label>
      Bid notes
      <textarea
        value={content.notes.bid ?? ''}
        onChange={(event) =>
          onChange({ ...content, notes: { ...content.notes, bid: event.target.value } })
        }
      />
    </label>
  ),
}));
vi.mock('../../app/admin/current-bid/BidOpportunityFields', () => ({
  BidOpportunityFields: () => <p>Opportunity field adapter</p>,
}));
vi.mock('../../app/admin/current-bid/BidBlueprint', () => ({
  BidBlueprint: ({ impact }: { impact: BidImpactResponse | null }) => (
    <p>{impact ? 'Synthetic visual impact is present' : 'No synthetic visual impact'}</p>
  ),
}));
vi.mock('../../app/admin/current-bid/BidImpactReview', () => ({
  BidImpactReview: ({ onImpact }: { onImpact?(result: BidImpactResponse | null): void }) => (
    <button type="button" onClick={() => onImpact?.({ valid: true } as BidImpactResponse)}>
      Inject synthetic Blueprint impact
    </button>
  ),
}));

import { CurrentBidWorkspace } from '../../app/admin/current-bid/CurrentBidWorkspace';
import { type CurrentBid, CurrentBidSchema } from '../../app/admin/current-bid/bid-client';
import { BidDraftSchema, bidDraftKey, readBidDraft } from '../../app/admin/current-bid/bid-draft';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const YEAR = 2027;
const ACTOR = 'synthetic-admin:10001:1';
const STORAGE_KEY = bidDraftKey(ACTOR, YEAR);
const CSRF = 'csrf_11111111-1111-4111-8111-111111111111';
const SAVED_NOTES = 'Synthetic saved Bid notes';
const EDITED_NOTES = 'Synthetic reviewed Bid edits\nsecond line';
const REASON = 'Synthetic reviewed change';

function metadata(number: number) {
  return {
    id: `synthetic-version-${number}`,
    versionNumber: number,
    contentSha256: number.toString(16).padStart(64, '0'),
    createdAtMs: 1_799_000_000_000 + number,
    actorSubject: 'synthetic-admin-10001',
    reason: `Synthetic version ${number}`,
    predecessorId: number === 1 ? null : `synthetic-version-${number - 1}`,
    restoredFromId: null,
  };
}

// Explicit synthetic material shaped like the real-FK facade integration fixture.
function current(number = 2, notes = SAVED_NOTES): CurrentBid {
  const version = metadata(number);
  return CurrentBidSchema.parse({
    bidYear: YEAR,
    state: 'VERSIONED',
    version,
    expected: {
      kind: 'version',
      versionId: version.id,
      revision: number,
      sha256: version.contentSha256,
    },
    content: {
      v: 1,
      bidYear: YEAR,
      settings: {
        v: 2,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2027-01-01',
      },
      notes: { bid: notes, positions: null },
      policy: null,
      planning: null,
      authoring: null,
      positions: [
        {
          id: 'synthetic-seat',
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
      ],
      rules: [
        {
          positionId: 'synthetic-seat',
          requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["rsc_seniority"]',
          notes: null,
        },
      ],
      participation: [],
      staffingBindings: [],
      sourceDecisions: [],
    },
    coverage: {
      valid: true,
      ruleCount: 1,
      missingBiddablePositionIds: [],
      invalidPositionIds: [],
      duplicatePositionIds: [],
      nonBiddablePositionIds: [],
      unexpectedPositionIds: [],
    },
    stats: {
      opportunityCount: 1,
      ruleCount: 1,
      biddableCount: 1,
      administrativelyAssignedCount: 0,
      reservedCount: 0,
      excludedCount: 0,
      missingRuleCount: 0,
    },
  });
}

function receipt(
  number = 3,
  changed = true,
  replayed = false,
  restoredFromId: string | null = null,
) {
  const version = metadata(number);
  return {
    changed,
    replayed,
    versionId: version.id,
    versionNumber: number,
    contentSha256: version.contentSha256,
    predecessorId: version.predecessorId,
    restoredFromId,
  };
}

function historical(number = 1) {
  const { bidYear, version, content, coverage, stats } = current(
    number,
    'Synthetic original historical notes',
  );
  return { bidYear, version, content, coverage, stats };
}

function preview(material: BidDefinitionContent, wouldCreateVersion = true) {
  const summary = current();
  const empty = { addedIds: [], removedIds: [], changedIds: [] };
  return {
    valid: true,
    content: material,
    contentSha256: metadata(3).contentSha256,
    diff: {
      positions: empty,
      rules: empty,
      participation: empty,
      staffingBindings: empty,
      sourceDecisions: empty,
      changedSections: wouldCreateVersion ? ['notes'] : [],
    },
    wouldCreateVersion,
    coverage: summary.coverage,
    stats: summary.stats,
    mockReadiness: { status: 'NOT_EVALUATED', code: 'saved_version_required_for_mock_preview' },
  };
}

function mockPreview(number = 2, context = 'c'.repeat(64), source = 'd'.repeat(64)) {
  const version = metadata(number);
  return {
    wouldAllowCreateMock: true as const,
    versionId: version.id,
    versionSha256: version.contentSha256,
    versionNumber: number,
    contextSha256: context,
    runtimeSourceToken: source,
    sourceDecisionBlockers: [],
    pool: {
      officerPoolCount: 2,
      firefighterPoolCount: 11,
      excludedCount: 3,
      administrativeAssignmentExcludedCount: 1,
    },
  };
}

function mockBody(checked = mockPreview()) {
  return {
    versionId: checked.versionId,
    versionSha256: checked.versionSha256,
    expectedContextSha256: checked.contextSha256,
    expectedSourceToken: checked.runtimeSourceToken,
  };
}

function mockReceipt(replayed = false, checked = mockPreview()) {
  return {
    id: 'synthetic-mock-session',
    current_phase: 'config',
    is_mock: true,
    rule_book_version: 'synthetic-rule-book',
    rule_book_revision: 4,
    position_template_version: 'synthetic-position-template',
    configuration_revision: checked.versionNumber,
    settings: { expected_duration_days: 2, turn_timer_seconds: 180 },
    pool: checked.pool,
    bidDefinition: {
      versionId: checked.versionId,
      versionNumber: checked.versionNumber,
      versionSha256: checked.versionSha256,
      snapshotSha256: 'e'.repeat(64),
      contextSha256: checked.contextSha256,
    },
    replayed,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type RequestEntry = {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
  serializedBody: string | null;
  key: string | null;
};
let requests: RequestEntry[];
let head: CurrentBid;
let handle: (request: RequestEntry) => Response | undefined | Promise<Response | undefined>;
let root: Root | undefined;
let container: HTMLDivElement;
let originalWindowFetch: typeof fetch;

beforeEach(() => {
  window.sessionStorage.clear();
  requests = [];
  head = current();
  handle = () => undefined;
  originalWindowFetch = window.fetch;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/auth/csrf') return response({ token: CSRF });
    const entry: RequestEntry = {
      path: url.pathname.replace(`/api/admin/bid/${YEAR}/`, '') + url.search,
      method: init?.method ?? 'GET',
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      serializedBody: typeof init?.body === 'string' ? init.body : null,
      key: new Headers(init?.headers).get('Idempotency-Key'),
    };
    requests.push(entry);
    const result = await handle(entry);
    if (result) return result;
    if (entry.path === 'current' && entry.method === 'GET') return response(head);
    throw new Error(`Unexpected synthetic API request: ${entry.method} ${entry.path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  navigation.push.mockReset();
  navigation.replace.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.fetch = originalWindowFetch;
  window.sessionStorage.clear();
  document.body.replaceChildren();
});

async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await settle(() => root?.render(<CurrentBidWorkspace year={YEAR} actorScope={ACTOR} />));
}

async function remount() {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  await mount();
}

function button(name: string | RegExp): HTMLButtonElement {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
  const result = buttons.find((node) => {
    const text =
      (node.querySelector('strong')?.textContent ?? node.textContent)
        ?.replace(/\s+/g, ' ')
        .trim() ?? '';
    return typeof name === 'string' ? text === name : name.test(text);
  });
  if (!result) throw new Error(`Missing public button: ${name}`);
  return result;
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  const labelNode = [...container.querySelectorAll('label')].find((node) =>
    node.textContent?.trim().startsWith(label),
  );
  const node = labelNode?.htmlFor
    ? document.getElementById(labelNode.htmlFor)
    : labelNode?.querySelector('input,textarea');
  if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement))
    throw new Error(`Missing public field: ${label}`);
  return node;
}

async function change(label: string, value: string) {
  await settle(() => {
    const node = field(label);
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(name: string | RegExp) {
  await settle(() => button(name).click());
}

function stored() {
  return readBidDraft(window.sessionStorage, ACTOR, YEAR);
}

function writes() {
  return requests.filter(
    (request) =>
      request.method === 'POST' &&
      ['versions', 'restore', 'mock-sessions', 'live-sessions'].includes(request.path),
  );
}

async function editAndDescribe() {
  await change('Bid notes', EDITED_NOTES);
  await change('Change summary', REASON);
}

async function stepUpPreservation() {
  const work: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent('mbfd-before-step-up', { detail: work }));
  return Promise.allSettled(work);
}

describe('Current Bid workspace save and recovery protocol', () => {
  it('initially reads the current Bid without saving or previewing any policy change', async () => {
    await mount();
    expect(container.textContent).toContain('2027 Current Bid');
    expect(field('Bid notes').value).toBe(SAVED_NOTES);
    expect(requests).toMatchObject([{ path: 'current', method: 'GET' }]);
    expect(button('Save Bid').disabled).toBe(false);
    expect(stored()?.content).toEqual(head.content);
    expect(stored()?.pending).toBeNull();
  });

  it('keeps edits local until explicit Save and persists the complete request before dispatch', async () => {
    let observedBeforeDispatch = false;
    handle = (request) => {
      if (request.path !== 'versions') return;
      const pending = stored()?.pending;
      expect(pending?.path).toBe('versions');
      expect(pending?.key).toBe(request.key);
      expect(pending?.body).toEqual(request.body);
      observedBeforeDispatch = true;
      head = current(3, EDITED_NOTES);
      return response(receipt(), 201);
    };
    await mount();
    await editAndDescribe();
    expect(writes()).toHaveLength(0);
    expect(requests).toHaveLength(1);
    expect(stored()?.content.notes.bid).toBe(EDITED_NOTES);
    await click('Save Bid');
    expect(observedBeforeDispatch).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(writes()[0]?.body).toEqual({
      expected: current().expected,
      content: { ...current().content, notes: { ...current().content.notes, bid: EDITED_NOTES } },
      reason: `Updated Bid: notes. Note: ${REASON}`,
    });
    expect(container.textContent).toContain('Version 3 saved.');
    expect(stored()?.pending).toBeNull();
    expect(stored()?.reason).toBe('');
    expect(field('Change summary').value).toBe('');
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('acknowledges a server semantic no-op without claiming a new version', async () => {
    handle = (request) => (request.path === 'versions' ? response(receipt(2, false)) : undefined);
    await mount();
    await change('Change summary', 'Synthetic verify unchanged policy');
    await click('Save Bid');
    expect(writes()).toHaveLength(1);
    expect(container.textContent).toContain('No policy changes. Version 2 remains current.');
    expect(container.textContent).not.toContain('Version 3 saved');
    expect(field('Bid notes').value).toBe(SAVED_NOTES);
    expect(stored()?.pending).toBeNull();
  });

  it('saves an edit without a mandatory note or preview and automatically describes the change', async () => {
    handle = (request) => {
      if (request.path !== 'versions') return;
      head = current(3, EDITED_NOTES);
      return response(receipt(), 201);
    };
    await mount();
    await change('Bid notes', EDITED_NOTES);
    expect(field('Change summary').value).toBe('');
    expect(button('Save Bid').disabled).toBe(false);
    await click('Save Bid');
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.body).toMatchObject({ reason: 'Updated Bid: notes.' });
    expect(requests.some((request) => request.path === 'preview')).toBe(false);
    expect(container.textContent).toContain('Version 3 saved.');
  });

  it('keeps the automatic change summary when the administrator adds an optional note', async () => {
    handle = (request) => {
      if (request.path !== 'versions') return;
      head = current(3, EDITED_NOTES);
      return response(receipt(), 201);
    };
    await mount();
    await change('Bid notes', EDITED_NOTES);
    await change('Change summary', 'Synthetic operational context');
    await click('Save Bid');
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.body).toMatchObject({
      reason: 'Updated Bid: notes. Note: Synthetic operational context',
    });
  });

  it('retains an uncertain request across remount and retries the same key/body despite a newer head', async () => {
    let attempts = 0;
    handle = (request) => {
      if (request.path !== 'versions') return;
      if (++attempts === 1) {
        head = current(3, EDITED_NOTES);
        throw new TypeError('Synthetic lost save response');
      }
      return response(receipt(3, true, true));
    };
    await mount();
    await editAndDescribe();
    await click('Save Bid');
    const original = writes()[0];
    expect(container.textContent).toContain('Recover the interrupted request');
    expect(field('Bid notes').matches(':disabled')).toBe(true);
    expect(stored()?.pending?.key).toBe(original?.key);
    await remount();
    expect(container.textContent).toContain('A newer saved Bid or source revision exists');
    expect(button('Load current saved Bid').disabled).toBe(true);
    expect(button('Retry original request').disabled).toBe(false);
    await click('Retry original request');
    expect(writes()).toHaveLength(2);
    expect(writes()[1]?.serializedBody).toBe(original?.serializedBody);
    expect(writes()[1]?.key).toBe(original?.key);
    expect(writes()[1]?.body?.expected).toEqual(current(2).expected);
    expect(stored()?.pending).toBeNull();
    expect(container.textContent).toContain('Version 3 saved.');
  });

  it('retains editable content and reason after definitive validation failure', async () => {
    handle = (request) =>
      request.path === 'versions'
        ? response(
            {
              error: 'invalid_bid_definition',
              issues: [
                {
                  path: ['notes', 'bid'],
                  code: 'invalid_source',
                  message: 'Synthetic source review required',
                },
              ],
            },
            400,
          )
        : undefined;
    await mount();
    await editAndDescribe();
    await click('Save Bid');
    expect(container.textContent).toContain('invalid bid definition');
    expect(field('Bid notes').value).toBe(EDITED_NOTES);
    expect(field('Change summary').value).toBe(REASON);
    expect(field('Bid notes').matches(':disabled')).toBe(false);
    expect(button('Save Bid').disabled).toBe(false);
    expect(stored()?.pending).toBeNull();
    expect(stored()?.content.notes.bid).toBe(EDITED_NOTES);
    expect(container.textContent).not.toContain('Version 3 saved');
  });

  it('preserves the request after an established receipt followed by failed current-Bid refresh', async () => {
    let saveCount = 0;
    let failRefresh = false;
    handle = (request) => {
      if (request.path === 'versions') {
        saveCount++;
        head = current(3, EDITED_NOTES);
        failRefresh = saveCount === 1;
        return response(receipt(3, true, saveCount > 1));
      }
      if (request.path === 'current' && failRefresh)
        return response({ error: 'synthetic_refresh_unavailable' }, 503);
      return undefined;
    };
    await mount();
    await editAndDescribe();
    await click('Save Bid');
    expect(container.textContent).toMatch(
      /Version 3 saved\. The refreshed Bid could not be loaded/,
    );
    expect(stored()?.pending?.key).toBe(writes()[0]?.key);
    expect(field('Bid notes').matches(':disabled')).toBe(true);
    await click('Retry original request');
    expect(writes()[1]?.serializedBody).toBe(writes()[0]?.serializedBody);
    expect(writes()[1]?.key).toBe(writes()[0]?.key);
    expect(stored()?.pending).toBeNull();
    expect(container.textContent).toContain('Version 3 saved.');
  });

  it('preserves the exact pending request through a step-up event and 401 response', async () => {
    let preserved: Awaited<ReturnType<typeof stepUpPreservation>> = [];
    handle = async (request) => {
      if (request.path !== 'versions') return;
      preserved = await stepUpPreservation();
      expect(stored()?.pending?.body).toEqual(request.body);
      expect(stored()?.pending?.key).toBe(request.key);
      return response({ error: 'step_up_required' }, 401);
    };
    await mount();
    await editAndDescribe();
    await click('Save Bid');
    expect(preserved).toEqual([{ status: 'fulfilled', value: undefined }]);
    expect(container.textContent).toContain('step up required');
    expect(button('Retry original request').disabled).toBe(false);
    expect(field('Change summary').matches(':disabled')).toBe(true);
    expect(stored()?.pending?.key).toBe(writes()[0]?.key);
  });

  it('does not dispatch a save when the exact request cannot be preserved', async () => {
    await mount();
    await editAndDescribe();
    const prior = window.sessionStorage.getItem(STORAGE_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Synthetic browser storage full');
    });
    await click('Save Bid');
    expect(writes()).toHaveLength(0);
    expect(container.textContent).toContain('Synthetic browser storage full');
    expect(field('Bid notes').value).toBe(EDITED_NOTES);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(prior);
  });

  it('rejects the step-up preservation promise if storage becomes unavailable', async () => {
    await mount();
    await editAndDescribe();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Synthetic step-up storage unavailable');
    });
    const result = await stepUpPreservation();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: 'rejected',
      reason: new Error('Synthetic step-up storage unavailable'),
    });
    expect(writes()).toHaveLength(0);
    expect(field('Bid notes').value).toBe(EDITED_NOTES);
  });

  it('never resurrects reverted edits or a cleared summary from the previous browser draft', async () => {
    await mount();
    await editAndDescribe();
    expect(stored()?.content.notes.bid).toBe(EDITED_NOTES);
    await change('Bid notes', SAVED_NOTES);
    await change('Change summary', '');
    expect(container.textContent).not.toContain('Unsaved changes');
    await remount();
    expect(field('Bid notes').value).toBe(SAVED_NOTES);
    expect(field('Change summary').value).toBe('');
    expect(writes()).toHaveLength(0);
  });

  it('does not overwrite an unreadable browser draft during step-up without explicit discard', async () => {
    const unreadable = '{"v":1,"content":"Synthetic unrecoverable incomplete bytes';
    window.sessionStorage.setItem(STORAGE_KEY, unreadable);
    await mount();
    expect(container.textContent).toContain('The browser draft could not be opened');
    expect(field('Bid notes').matches(':disabled')).toBe(true);
    const result = await stepUpPreservation();
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('rejected');
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(unreadable);
    expect(writes()).toHaveLength(0);
  });

  it('shows a loading identity error and recovers through the public retry control', async () => {
    let wrongYear = true;
    handle = (request) =>
      request.path === 'current' && wrongYear
        ? response({ ...head, content: { ...head.content, bidYear: 2028 } })
        : undefined;
    await mount();
    expect(container.textContent).toContain('invalid server response');
    expect(container.querySelector('textarea')).toBeNull();
    wrongYear = false;
    await click('Retry loading Bid');
    expect(field('Bid notes').value).toBe(SAVED_NOTES);
    expect(writes()).toHaveLength(0);
  });
});

describe('Current Bid version history and restore', () => {
  it('restores an inspected historical version directly, with an automatic history note and no preview hurdle', async () => {
    const source = historical(1);
    const originalBytes = JSON.stringify(source);
    handle = (request) => {
      if (request.path === 'versions?limit=20')
        return response({
          bidYear: YEAR,
          versions: [metadata(2), metadata(1)],
          nextBeforeVersionNumber: null,
        });
      if (request.path === 'versions/synthetic-version-1') return response(source);
      if (request.path === 'preview') return response(preview(source.content));
      if (request.path === 'restore') {
        expect(stored()?.pending?.body).toEqual(request.body);
        head = current(3, 'Synthetic original historical notes');
        return response(receipt(3, true, false, 'synthetic-version-1'), 201);
      }
      return undefined;
    };
    await mount();
    await click('Version history');
    await click(/^Version 1\b/);
    expect(container.textContent).toContain(
      'Earlier versions stay in History and can be restored.',
    );
    expect(container.querySelector('textarea')).toBeNull();
    expect(writes()).toHaveLength(0);
    expect(button('Restore this version').disabled).toBe(false);
    expect(writes()).toHaveLength(0);
    await click('Restore this version');
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.path).toBe('restore');
    expect(writes()[0]?.body).toEqual({
      expected: current().expected,
      versionId: 'synthetic-version-1',
      reason: 'Restored Bid version 1.',
    });
    expect(writes()[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(source)).toBe(originalBytes);
    expect(container.textContent).toContain('Version 3 restored as a new current version.');
    expect(stored()?.pending).toBeNull();
    expect(requests.some((request) => request.path === 'preview')).toBe(false);
  });

  it('shows the selected current version as current instead of offering a duplicate restore', async () => {
    handle = (request) => {
      if (request.path === 'versions?limit=20')
        return response({
          bidYear: YEAR,
          versions: [metadata(2), metadata(1)],
          nextBeforeVersionNumber: null,
        });
      if (request.path === 'versions/synthetic-version-2') return response(historical(2));
      return undefined;
    };
    await mount();
    await click('Version history');
    await click(/^Version 2\b/);
    expect(container.textContent).toContain('This is the current saved Bid version.');
    expect(
      [...container.querySelectorAll('button')].some(
        (node) => node.textContent?.replace(/\s+/g, ' ').trim() === 'Restore this version',
      ),
    ).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it('pages version history using the server cursor and retains previously loaded versions without duplicates', async () => {
    handle = (request) => {
      if (request.path === 'versions?limit=20')
        return response({
          bidYear: YEAR,
          versions: [metadata(26), metadata(25)],
          nextBeforeVersionNumber: 25,
        });
      if (request.path === 'versions?limit=20&beforeVersionNumber=25')
        return response({
          bidYear: YEAR,
          versions: [metadata(25), metadata(24)],
          nextBeforeVersionNumber: null,
        });
      return undefined;
    };
    await mount();
    await click('Version history');
    expect(button(/^Version 26\b/)).toBeDefined();
    await click('Load older versions');
    expect(button(/^Version 24\b/)).toBeDefined();
    expect(
      [...container.querySelectorAll('button')].filter((node) =>
        /^Version 25\b/.test(node.querySelector('strong')?.textContent ?? node.textContent ?? ''),
      ),
    ).toHaveLength(1);
    expect(container.textContent).not.toContain('Load older versions');
    expect(writes()).toHaveLength(0);
  });

  it('invalidates a draft preview after an edit and never dispatches preview as a version write', async () => {
    handle = (request) =>
      request.path === 'preview' ? response(preview(stored()?.content ?? head.content)) : undefined;
    await mount();
    await editAndDescribe();
    await click('Preview changes (optional)');
    expect(container.textContent).toContain('This proposal would create a new Bid version.');
    expect(writes()).toHaveLength(0);
    await click('Edit Bid');
    await change('Bid notes', 'Synthetic changed again after preview');
    await click('Bid Blueprint');
    expect(container.textContent).not.toContain('This proposal would create a new Bid version.');
    expect(requests.filter((request) => request.path === 'preview')).toHaveLength(1);
    expect(BidDraftSchema.safeParse(stored()).success).toBe(true);
  });
});

describe('Current Bid managed Live workflow', () => {
  function livePreview() {
    const {
      wouldAllowCreateMock: _mock,
      sourceDecisionBlockers: _sourceDecisionBlockers,
      ...pins
    } = mockPreview();
    return {
      ...pins,
      wouldAllowCreateLive: true,
      readiness: {
        checks: [
          { id: 'annual_operations_policy', status: 'READY', detail: 'Synthetic policy is ready.' },
        ],
        overallStatus: 'READY',
        canStartLiveBid: true,
        blockingCheckIds: [],
      },
    };
  }

  function liveReceipt(replayed = false) {
    return { ...mockReceipt(replayed), id: 'synthetic-live-session', is_mock: false };
  }

  afterEach(() => {
    // Synthetic request allowlist: creation never dispatches a start or legacy mutation.
    expect(
      requests.every(
        (request) =>
          (request.path === 'current' && request.method === 'GET') ||
          (['preview', 'live-sessions'].includes(request.path) && request.method === 'POST'),
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    'requires confirmation and durably pins creation without starting (replayed=%s)',
    async (replayed) => {
      let persistedBeforeDispatch = false;
      handle = (request) => {
        if (request.path === 'preview') return response(livePreview());
        if (request.path === 'live-sessions') {
          expect(stored()?.pending).toStrictEqual({
            path: 'live-sessions',
            key: request.key,
            body: mockBody(),
          });
          expect(request.body).toStrictEqual(mockBody());
          persistedBeforeDispatch = true;
          return response(liveReceipt(replayed), replayed ? 200 : 201);
        }
        return undefined;
      };
      await mount();
      await click('Live Bid');
      await click('Check Managed Live readiness');
      expect(requests.filter((request) => request.path === 'preview')).toMatchObject([
        {
          key: null,
          body: {
            kind: 'live',
            versionId: metadata(2).id,
            versionSha256: metadata(2).contentSha256,
          },
        },
      ]);
      expect(writes()).toHaveLength(0);
      expect(stored()?.pending).toBeNull();
      await click('Create Live session…');
      expect(writes()).toHaveLength(0);
      await click('Confirm Live session creation');
      expect(persistedBeforeDispatch).toBe(true);
      expect(writes()).toHaveLength(1);
      expect(writes()[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
      expect(stored()?.pending).toBeNull();
      expect(container.textContent).toContain('Live session created; it has not started.');
      expect(container.querySelector('a[href="/admin/bid"]')?.textContent).toContain(
        'Open Live console',
      );
      expect(() => button('Create Live session…')).toThrow('Missing public button');
    },
  );

  it.each(['bid_run_context_changed', 'bid_definition_or_source_changed'] as const)(
    'invalidates Live review and confirmation after definitive %s before allowing a new request',
    async (code) => {
      let previews = 0;
      let creations = 0;
      const fresh = mockPreview(2, 'f'.repeat(64), 'a'.repeat(64));
      handle = (request) => {
        if (request.path === 'preview') {
          const checked = livePreview();
          return response(
            ++previews === 1
              ? checked
              : {
                  ...checked,
                  contextSha256: fresh.contextSha256,
                  runtimeSourceToken: fresh.runtimeSourceToken,
                },
          );
        }
        if (request.path === 'live-sessions') {
          return ++creations === 1
            ? response({ error: code }, 409)
            : response(
                { ...mockReceipt(false, fresh), id: 'synthetic-live-session', is_mock: false },
                201,
              );
        }
        return undefined;
      };
      await mount();
      await click('Live Bid');
      await click('Check Managed Live readiness');
      await click('Create Live session…');
      await click('Confirm Live session creation');
      expect(stored()?.pending).toBeNull();
      expect(container.textContent).not.toContain('Server Live readiness: ready.');
      expect(() => button('Create Live session…')).toThrow('Missing public button');
      expect(() => button('Confirm Live session creation')).toThrow('Missing public button');
      expect(writes()).toHaveLength(1);
      if (code === 'bid_definition_or_source_changed') {
        expect(button('Check Managed Live readiness').disabled).toBe(true);
        await click('Load current saved Bid');
      }
      expect(button('Check Managed Live readiness').disabled).toBe(false);
      await click('Check Managed Live readiness');
      expect(() => button('Confirm Live session creation')).toThrow('Missing public button');
      await click('Create Live session…');
      expect(writes()).toHaveLength(1);
      await click('Confirm Live session creation');
      expect(writes().map((request) => request.body)).toStrictEqual([mockBody(), mockBody(fresh)]);
      expect(writes()[1]?.key).not.toBe(writes()[0]?.key);
      expect(stored()?.pending).toBeNull();
      expect(container.textContent).toContain('Live session created; it has not started.');
    },
  );

  it('recovers a lost Live receipt after refresh and head advance with the same key and exact original pins', async () => {
    let attempts = 0;
    handle = (request) => {
      if (request.path === 'preview') return response(livePreview());
      if (request.path === 'live-sessions') {
        if (++attempts === 1) throw new TypeError('Synthetic lost Live receipt');
        return response(liveReceipt(true));
      }
      return undefined;
    };
    await mount();
    await click('Live Bid');
    await click('Check Managed Live readiness');
    await click('Create Live session…');
    await click('Confirm Live session creation');
    const pending = stored()?.pending;
    expect(pending).toMatchObject({ path: 'live-sessions', body: mockBody() });
    expect(button('Check Managed Live readiness').disabled).toBe(true);
    expect(await stepUpPreservation()).toMatchObject([{ status: 'fulfilled' }]);
    head = current(3, 'Synthetic newer Bid');
    await remount();
    await click('Live Bid');
    expect(stored()?.pending).toStrictEqual(pending);
    expect(button('Check Managed Live readiness').disabled).toBe(true);
    await click('Retry original request');
    expect(writes()).toHaveLength(2);
    expect(writes()[1]?.serializedBody).toBe(writes()[0]?.serializedBody);
    expect(writes()[1]?.key).toBe(writes()[0]?.key);
    expect(writes()[1]?.body).toStrictEqual(mockBody());
    expect(requests.filter((request) => request.path === 'preview')).toHaveLength(1);
    expect(stored()?.pending).toBeNull();
    expect(stored()?.base.version?.versionNumber).toBe(3);
    expect(container.textContent).toContain('Live session created; it has not started.');
  });

  it.each(['mock', 'foreign-context'] as const)(
    'preserves the original recovery request when the Live response is %s',
    async (invalid) => {
      handle = (request) => {
        if (request.path === 'preview') return response(livePreview());
        if (request.path === 'live-sessions') {
          const receipt = liveReceipt();
          return response(
            invalid === 'mock'
              ? { ...receipt, is_mock: true }
              : {
                  ...receipt,
                  bidDefinition: { ...receipt.bidDefinition, contextSha256: 'f'.repeat(64) },
                },
            201,
          );
        }
        return undefined;
      };
      await mount();
      await click('Live Bid');
      await click('Check Managed Live readiness');
      await click('Create Live session…');
      await click('Confirm Live session creation');
      expect(stored()?.pending).toMatchObject({ path: 'live-sessions', body: mockBody() });
      expect(container.textContent).toContain('invalid server response');
      expect(container.textContent).not.toContain('Live session created; it has not started.');
      expect(button('Check Managed Live readiness').disabled).toBe(true);
      expect(button('Retry original request').disabled).toBe(false);
      expect(writes()).toHaveLength(1);
    },
  );
});

describe('Current Bid managed Mock workflow', () => {
  afterEach(() => {
    // All requests are intercepted: no creation, preview or navigation in this
    // workflow may dispatch a Live action or any legacy session mutation.
    expect(
      requests.every(
        (request) =>
          (request.path === 'current' && request.method === 'GET') ||
          (['preview', 'mock-sessions'].includes(request.path) && request.method === 'POST'),
      ),
    ).toBe(true);
  });

  it('keeps readiness read-only until the administrator explicitly creates the reviewed Mock', async () => {
    handle = (request) => (request.path === 'preview' ? response(mockPreview()) : undefined);
    await mount();
    await click('Mock Bid');
    expect(requests).toHaveLength(1);
    await click('Check Mock readiness');
    expect(requests.filter((request) => request.path === 'preview')).toMatchObject([
      {
        method: 'POST',
        key: null,
        body: { kind: 'mock', versionId: metadata(2).id, versionSha256: metadata(2).contentSha256 },
      },
    ]);
    expect(container.textContent).toContain('2 officers · 11 firefighters · 3 excluded');
    expect(button('Create Mock Bid from Version 2').disabled).toBe(false);
    expect(stored()?.pending).toBeNull();
    expect(writes()).toHaveLength(0);
    await click('Live Bid');
    expect(writes()).toHaveLength(0);
    expect(requests).toHaveLength(2);
    await click('Mock Bid');
    expect(button('Create Mock Bid from Version 2').disabled).toBe(false);
  });

  it('shows server readiness blocks without inventing a creation action or pool', async () => {
    handle = (request) =>
      request.path === 'preview'
        ? response({
            wouldAllowCreateMock: false,
            policyError: 'pending_credential_dispute',
            positionIds: ['synthetic-seat'],
            tenureIssues: [
              {
                staffingPositionId: 'synthetic-seat',
                code: 'missing_start',
                recordId: 'synthetic-tenure',
              },
            ],
          })
        : undefined;
    await mount();
    await click('Mock Bid');
    await click('Check Mock readiness');
    expect(container.textContent).toContain(
      'Mock creation is blocked: pending credential dispute.',
    );
    expect(container.textContent).toContain('Opportunities requiring review: synthetic-seat');
    expect(container.textContent).toContain('synthetic-seat: missing start');
    expect(container.textContent).not.toContain('officers ·');
    expect(() => button(/Create Mock Bid/)).toThrow('Missing public button');
    expect(writes()).toHaveLength(0);
  });

  it.each(['unsaved edits', 'unadopted legacy Bid'] as const)(
    'requires a saved version before checking Mock readiness with %s',
    async (mode) => {
      if (mode === 'unadopted legacy Bid')
        head = CurrentBidSchema.parse({
          ...head,
          state: 'LEGACY_UNADOPTED',
          version: null,
          expected: { kind: 'legacy', sourceToken: 'a'.repeat(64) },
        });
      await mount();
      if (mode === 'unsaved edits') await change('Bid notes', EDITED_NOTES);
      await click('Mock Bid');
      expect(button('Check Mock readiness').disabled).toBe(true);
      await click('Check Mock readiness');
      expect(requests).toHaveLength(1);
      expect(writes()).toHaveLength(0);
    },
  );

  it.each([false, true])(
    'persists all reviewed pins before Create and opens only the established Mock receipt (replayed=%s)',
    async (replayed) => {
      let checkedBeforeDispatch = false;
      handle = (request) => {
        if (request.path === 'preview') return response(mockPreview());
        if (request.path === 'mock-sessions') {
          expect(stored()?.pending).toStrictEqual({
            path: 'mock-sessions',
            key: request.key,
            body: mockBody(),
          });
          expect(request.body).toStrictEqual(mockBody());
          expect(request.key).toMatch(/^[0-9a-f-]{36}$/);
          checkedBeforeDispatch = true;
          return response(mockReceipt(replayed), replayed ? 200 : 201);
        }
        return undefined;
      };
      await mount();
      await click('Mock Bid');
      await click('Check Mock readiness');
      expect(writes()).toHaveLength(0);
      await click('Create Mock Bid from Version 2');
      expect(checkedBeforeDispatch).toBe(true);
      expect(writes()).toHaveLength(1);
      expect(stored()?.pending).toBeNull();
      expect(container.textContent).toContain('Mock Bid created from Version 2.');
      const link = [...container.querySelectorAll('a')].find((node) =>
        node.textContent?.includes('Open created Mock Bid'),
      );
      expect(link?.getAttribute('href')).toBe('/admin/sessions/synthetic-mock-session');
      expect(link?.textContent).toContain('Version 2');
      expect(() => button(/Create Mock Bid/)).toThrow('Missing public button');
    },
  );

  it('requires a new readiness review after a definitive context conflict and uses new pins and a new key', async () => {
    const old = mockPreview();
    const fresh = mockPreview(2, 'f'.repeat(64), 'a'.repeat(64));
    let previews = 0;
    let creations = 0;
    handle = (request) => {
      if (request.path === 'preview') return response(++previews === 1 ? old : fresh);
      if (request.path === 'mock-sessions') {
        return ++creations === 1
          ? response({ error: 'bid_run_context_changed' }, 409)
          : response(mockReceipt(false, fresh), 201);
      }
      return undefined;
    };
    await mount();
    await click('Mock Bid');
    await click('Check Mock readiness');
    await click('Create Mock Bid from Version 2');
    expect(container.textContent).toContain('bid run context changed');
    expect(stored()?.pending).toBeNull();
    expect(() => button(/Create Mock Bid/)).toThrow('Missing public button');
    expect(button('Check Mock readiness').disabled).toBe(false);
    expect(writes()).toHaveLength(1);
    await click('Check Mock readiness');
    expect(writes()).toHaveLength(1);
    await click('Create Mock Bid from Version 2');
    expect(writes().map((request) => request.body)).toStrictEqual([mockBody(old), mockBody(fresh)]);
    expect(writes()[1]?.key).not.toBe(writes()[0]?.key);
    expect(stored()?.pending).toBeNull();
    expect(container.textContent).toContain('Mock Bid created from Version 2.');
  });

  it('recovers a lost Mock receipt after remount and head advance using the original request, key and context', async () => {
    let attempts = 0;
    handle = (request) => {
      if (request.path === 'preview') return response(mockPreview());
      if (request.path === 'mock-sessions') {
        if (++attempts === 1) throw new TypeError('Synthetic dropped Mock receipt');
        return response(mockReceipt(true));
      }
      return undefined;
    };
    await mount();
    await click('Mock Bid');
    await click('Check Mock readiness');
    await click('Create Mock Bid from Version 2');
    const pending = stored()?.pending;
    expect(pending).toMatchObject({ path: 'mock-sessions', body: mockBody() });
    expect(container.textContent).not.toContain('Open created Mock Bid');
    expect(button('Check Mock readiness').disabled).toBe(true);
    expect(await stepUpPreservation()).toMatchObject([{ status: 'fulfilled' }]);
    head = current(3, 'Synthetic newer saved Bid');
    await remount();
    await click('Mock Bid');
    expect(container.textContent).toContain('A newer saved Bid or source revision exists');
    expect(stored()?.pending).toStrictEqual(pending);
    expect(button('Check Mock readiness').disabled).toBe(true);
    expect(button('Retry original request').disabled).toBe(false);
    await click('Retry original request');
    expect(writes()).toHaveLength(2);
    expect(writes()[1]?.serializedBody).toBe(writes()[0]?.serializedBody);
    expect(writes()[1]?.key).toBe(writes()[0]?.key);
    expect(writes()[1]?.body).toStrictEqual(mockBody());
    expect(requests.filter((request) => request.path === 'preview')).toHaveLength(1);
    expect(stored()?.base.version?.versionNumber).toBe(3);
    expect(stored()?.pending).toBeNull();
    expect(container.textContent).toContain('Open created Mock Bid · Version 2');
  });

  it.each(['versionId', 'versionSha256', 'versionNumber'] as const)(
    'does not offer creation for a mismatched readiness %s',
    async (field) => {
      handle = (request) =>
        request.path === 'preview'
          ? response({
              ...mockPreview(),
              [field]:
                field === 'versionId'
                  ? 'synthetic-other-version'
                  : field === 'versionSha256'
                    ? 'f'.repeat(64)
                    : 9,
            })
          : undefined;
      await mount();
      await click('Mock Bid');
      await click('Check Mock readiness');
      expect(container.textContent).toContain('invalid server response');
      expect(() => button(/Create Mock Bid/)).toThrow('Missing public button');
      expect(writes()).toHaveLength(0);
    },
  );

  it('keeps a mismatched creation receipt uncertain and retries its exact request before exposing a run link', async () => {
    let attempts = 0;
    handle = (request) => {
      if (request.path === 'preview') return response(mockPreview());
      if (request.path === 'mock-sessions') {
        const result = mockReceipt(++attempts > 1);
        if (attempts === 1) result.bidDefinition.contextSha256 = 'f'.repeat(64);
        return response(result);
      }
      return undefined;
    };
    await mount();
    await click('Mock Bid');
    await click('Check Mock readiness');
    await click('Create Mock Bid from Version 2');
    expect(container.textContent).toContain('invalid server response');
    expect(container.textContent).not.toContain('Open created Mock Bid');
    expect(stored()?.pending).toMatchObject({ path: 'mock-sessions', body: mockBody() });
    expect(button('Check Mock readiness').disabled).toBe(true);
    await click('Retry original request');
    expect(writes()[1]).toStrictEqual(writes()[0]);
    expect(stored()?.pending).toBeNull();
    expect(container.textContent).toContain('Open created Mock Bid · Version 2');
  });

  it('preserves an established Mock receipt when the refresh fails and recovers using the same creation request', async () => {
    let received = false;
    let failRefresh = true;
    handle = (request) => {
      if (request.path === 'preview') return response(mockPreview());
      if (request.path === 'mock-sessions') {
        const replayed = received;
        received = true;
        return response(mockReceipt(replayed));
      }
      if (request.path === 'current' && received && failRefresh)
        return response({ error: 'synthetic_refresh_failed' }, 503);
      return undefined;
    };
    await mount();
    await click('Mock Bid');
    await click('Check Mock readiness');
    await click('Create Mock Bid from Version 2');
    expect(container.textContent).toContain(
      'Mock Bid created from Version 2. The refreshed Bid could not be loaded.',
    );
    expect(stored()?.pending?.path).toBe('mock-sessions');
    expect(container.textContent).toContain('Open created Mock Bid · Version 2');
    failRefresh = false;
    await click('Retry original request');
    expect(writes()[1]).toStrictEqual(writes()[0]);
    expect(stored()?.pending).toBeNull();
  });

  it('does not dispatch Mock creation when the exact request cannot be retained in browser storage', async () => {
    handle = (request) => (request.path === 'preview' ? response(mockPreview()) : undefined);
    await mount();
    await click('Mock Bid');
    await click('Check Mock readiness');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Synthetic storage blocked');
    });
    await click('Create Mock Bid from Version 2');
    expect(container.textContent).toContain('Synthetic storage blocked');
    expect(writes()).toHaveLength(0);
    expect(stored()?.pending).toBeNull();
  });
});

describe('Current Bid Managed Live preflight', () => {
  afterEach(() => {
    expect(
      requests.every(
        (request) =>
          (request.path === 'current' && request.method === 'GET') ||
          (request.path === 'preview' && request.method === 'POST'),
      ),
    ).toBe(true);
  });

  it('reviews the exact saved version without exposing a Live creation action', async () => {
    handle = (request) =>
      request.path === 'preview'
        ? response({
            wouldAllowCreateLive: false,
            policyError: 'bid_configuration_annual_policy_document_invalid',
          })
        : undefined;
    await mount();
    await click('Live Bid');
    expect(container.textContent).toContain('Managed Live preflight');
    expect(container.textContent).toContain('No Live run is created by this check.');
    expect(container.textContent).not.toContain('Open Live Bid console');
    await click('Check Managed Live readiness');
    expect(requests.filter((request) => request.path === 'preview')).toMatchObject([
      {
        method: 'POST',
        key: null,
        body: { kind: 'live', versionId: metadata(2).id, versionSha256: metadata(2).contentSha256 },
      },
    ]);
    expect(container.textContent).toContain(
      'Live policy preparation is blocked: bid_configuration_annual_policy_document_invalid.',
    );
    expect(writes()).toHaveLength(0);
    expect(container.textContent).not.toContain('Create Live');
  });
});

describe('Current Bid Blueprint impact binding', () => {
  it('clears a prior same-year server impact when the draft changes away from Blueprint', async () => {
    await mount();
    await click('Bid Blueprint');
    await click('Inject synthetic Blueprint impact');
    expect(container.textContent).toContain('Synthetic visual impact is present');
    await click('Edit Bid');
    await change('Bid notes', 'Synthetic edit invalidates the prior server impact');
    await click('Bid Blueprint');
    expect(container.textContent).toContain('No synthetic visual impact');
  });
});
