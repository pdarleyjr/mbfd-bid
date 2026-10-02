// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BidReviewedSourceUpdate } from '../../app/admin/current-bid/BidReviewedSourceUpdate';
import { ReviewedUpdateReceiptSchema } from '../../app/admin/current-bid/reviewed-source-update-client';
import { OPERATOR_AUTH_REFRESHED } from '../../lib/operator-step-up';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const actor = 'synthetic-admin:92000:1';
const version = { id: 'synthetic-version', revision: 12, sha256: 'a'.repeat(64) };
const capturedAt = '2026-10-01T20:00:00.000Z';
const cutoff = '2026-09-30T17:00:00-04:00';
const imports = [
  {
    source: 'Qualification workbook',
    importId: 'synthetic-v5-import',
    revision: 'Version 5',
    sha256: 'b'.repeat(64),
    acceptedAt: capturedAt,
  },
];
const expected = {
  versionId: version.id,
  revision: version.revision,
  sha256: version.sha256,
  sourceToken: 'c'.repeat(64),
  originalFreezeId: 'synthetic-original',
};
const counts = { members: 230, approvedQualificationEvents: 3882, pendingQualificationHolds: 2 };
const eligibilityDates = {
  credentialEvaluationOn: '2026-09-30',
  personnelEvaluationOn: '2026-09-30',
};
function preview(ready = true) {
  return {
    ok: true,
    ready,
    blockers: ready ? [] : ['latest_2026_credential_revision_review_required'],
    expected,
    original: {
      freezeId: expected.originalFreezeId,
      evaluationSha256: 'd'.repeat(64),
      personnelSha256: 'e'.repeat(64),
      credentialSha256: 'f'.repeat(64),
    },
    counts,
    eligibilityDates,
    sourceImports: imports,
    capturedAt,
  };
}
function receipt(reason: string) {
  return {
    freezeId: 'synthetic-reviewed-update',
    evidenceCutoffAt: cutoff,
    capturedAt,
    sourceVersionId: version.id,
    sourceVersionSha256: version.sha256,
    evaluationSha256: '1'.repeat(64),
    personnelSha256: '2'.repeat(64),
    credentialSha256: '3'.repeat(64),
    sourceImports: imports,
    counts,
    eligibilityDates,
    reason,
    actorSubject: 'synthetic-admin-92000',
    sourceDecisions: [],
    freezePin: {
      freezeId: 'synthetic-reviewed-update',
      evaluationSha256: '1'.repeat(64),
      sourceVersionId: version.id,
      sourceVersionSha256: version.sha256,
      evidenceCutoffAt: cutoff,
      timeZone: 'America/New_York',
      approvedAt: capturedAt,
      sourceImports: imports,
      personnelSnapshot: { sha256: '2'.repeat(64), asOfAt: capturedAt, capturedAt },
      credentialSnapshot: { sha256: '3'.repeat(64), asOfAt: capturedAt, capturedAt },
      reviewedUpdate: {
        v: 1,
        kind: 'APPROVED_LEDGER_UPDATE',
        originalFreezeId: 'synthetic-original',
        originalEvaluationSha256: 'd'.repeat(64),
        originalPersonnelSha256: 'e'.repeat(64),
        originalCredentialSha256: 'f'.repeat(64),
        sourceToken: 'c'.repeat(64),
        observedAsOfAt: capturedAt,
        reasonSha256: '4'.repeat(64),
        sourceDecisionsSha256: '5'.repeat(64),
      },
    },
  };
}
type RequestEntry = { path: string; method: string; body: unknown; key: string | null };
const captureReason = (entry: RequestEntry) => {
  if (
    !entry.body ||
    typeof entry.body !== 'object' ||
    !('reason' in entry.body) ||
    typeof entry.body.reason !== 'string'
  )
    throw new Error('The capture must carry its exact review note.');
  return entry.body.reason;
};
let entries: RequestEntry[];
let handler: (entry: RequestEntry) => Response | Promise<Response> | undefined;
let root: Root;
let container: HTMLDivElement;
let saved: ReturnType<typeof receipt> | null;
const onApply = vi.fn();
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function render(currentVersion = version, disabled = false, actorScope = actor) {
  await act(async () =>
    root.render(
      <BidReviewedSourceUpdate
        key={actorScope}
        actorScope={actorScope}
        version={currentVersion}
        disabled={disabled}
        onApply={onApply}
      />,
    ),
  );
  await settle();
}
const button = (label: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label,
  );
async function click(label: string) {
  const target = button(label);
  if (!target) throw new Error(`Missing rendered control: ${label}`);
  await act(async () => target.click());
  await settle();
}
const captures = () =>
  entries.filter((entry) => entry.method === 'POST' && entry.path === 'evidence-updates');
beforeEach(() => {
  window.sessionStorage.clear();
  entries = [];
  saved = null;
  handler = () => undefined;
  onApply.mockReset();
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname === '/api/auth/csrf')
      return response({ token: 'csrf_11111111-1111-4111-8111-111111111111' });
    const entry = {
      path: url.pathname.replace('/api/admin/bid/2026/', ''),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      key: new Headers(init?.headers).get('Idempotency-Key'),
    };
    entries.push(entry);
    const custom = await handler(entry);
    if (custom) return custom;
    if (entry.path === 'evidence-updates/preview') return response(preview());
    if (entry.path === 'evidence-updates' && entry.method === 'POST') {
      saved = receipt(captureReason(entry));
      return response({ ok: true, replayed: false, update: saved });
    }
    if (entry.path === 'evidence-updates/synthetic-reviewed-update' && saved)
      return response({ ok: true, update: saved });
    throw new Error(`Unexpected request ${entry.method} ${entry.path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  window.fetch = fetcher;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('reviewed source update operator workflow', () => {
  it('reviews without mutation and requires explicit capture, readback and draft loading', async () => {
    await render();
    await click('Review latest source');
    expect(container.textContent).toContain('2 credential exceptions retained');
    expect(captures()).toEqual([]);
    await click('Capture reviewed update');
    expect(captures()).toHaveLength(1);
    expect(captures()[0]?.body).toMatchObject({ expected });
    expect(
      entries.some(
        (entry) =>
          entry.method === 'GET' && entry.path === 'evidence-updates/synthetic-reviewed-update',
      ),
    ).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    await click('Load reviewed update into draft');
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0]?.[0]).toEqual(saved);
    expect(
      entries.some(
        (entry) =>
          entry.path === 'versions' ||
          entry.path === 'mock-sessions' ||
          entry.path === 'live-sessions',
      ),
    ).toBe(false);
  });
  it('shows source blockers and prevents capture when row review is unfinished', async () => {
    handler = (entry) =>
      entry.path === 'evidence-updates/preview' ? response(preview(false)) : undefined;
    await render();
    await click('Review latest source');
    expect(container.textContent).toContain('Finish reviewing the Version 5 credential import');
    expect(button('Capture reviewed update')?.disabled).toBe(true);
    await click('Capture reviewed update');
    expect(captures()).toEqual([]);
  });
  it('preserves the exact lost-response request across remount and never retries automatically', async () => {
    let lost = true;
    handler = (entry) => {
      if (entry.path === 'evidence-updates' && lost) {
        saved = receipt(captureReason(entry));
        lost = false;
        throw new Error('Lost response');
      }
      return undefined;
    };
    await render();
    await click('Review latest source');
    await click('Capture reviewed update');
    const first = captures()[0];
    expect(first?.key).toMatch(/^[a-f0-9-]{36}$/);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(captures()).toHaveLength(1);
    await click('Retry retained capture');
    expect(captures()).toHaveLength(2);
    expect(captures()[1]).toEqual(first);
    expect(button('Load reviewed update into draft')).toBeDefined();
  });
  it('recovers failed readback through GET only after an accepted capture', async () => {
    let unavailable = true;
    handler = (entry) =>
      entry.path === 'evidence-updates/synthetic-reviewed-update' && unavailable
        ? response({ error: 'temporarily_unavailable' }, 503)
        : undefined;
    await render();
    await click('Review latest source');
    await click('Capture reviewed update');
    expect(captures()).toHaveLength(1);
    expect(onApply).not.toHaveBeenCalled();
    unavailable = false;
    await click('Verify recorded update');
    expect(captures()).toHaveLength(1);
    expect(button('Load reviewed update into draft')).toBeDefined();
  });
  it('retains a definitively rejected request before allowing a fresh source review', async () => {
    handler = (entry) =>
      entry.path === 'evidence-updates' && entry.method === 'POST'
        ? response({ error: 'evidence_update_source_changed', recorded: false }, 409)
        : undefined;
    await render();
    await click('Review latest source');
    await click('Capture reviewed update');
    const rejected = captures()[0];
    expect(container.textContent).toContain('server confirmed this request was not recorded');
    expect(window.sessionStorage.getItem(`mbfd-reviewed-source-update:${actor}:2026`)).toBeNull();
    const history = JSON.parse(
      window.sessionStorage.getItem(
        `mbfd-reviewed-source-update:${actor}:2026:history:${rejected?.key}`,
      ) ?? 'null',
    );
    expect(history.status).toBe('NOT_RECORDED');
    expect(history.retained.request).toEqual(rejected?.body);
    expect(history.retained.key).toEqual(rejected?.key);
    expect(button('Review latest source')?.disabled).toBe(false);
    expect(captures()).toHaveLength(1);
    await click('Review latest source');
    expect(button('Capture reviewed update')?.disabled).toBe(false);
    expect(captures()).toHaveLength(1);
  });
  it('keeps the exact request when a source error does not prove that it was unrecorded', async () => {
    handler = (entry) =>
      entry.path === 'evidence-updates' && entry.method === 'POST'
        ? response({ error: 'evidence_update_source_changed' }, 409)
        : undefined;
    await render();
    await click('Review latest source');
    await click('Capture reviewed update');
    const first = captures()[0];
    expect(button('Review latest source')).toBeUndefined();
    expect(button('Retry retained capture')).toBeDefined();
    await click('Retry retained capture');
    expect(captures()).toHaveLength(2);
    expect(captures()[1]).toEqual(first);
    expect(onApply).not.toHaveBeenCalled();
  });
  it('keeps a verified recorded receipt when a newer saved Bid makes it inapplicable', async () => {
    await render();
    await click('Review latest source');
    await click('Capture reviewed update');
    const accepted = saved;
    const first = captures()[0];
    await render({ ...version, id: 'new-synthetic-version', revision: 13 });
    await click('Verify recorded update');
    expect(button('Load reviewed update into draft')).toBeUndefined();
    expect(onApply).not.toHaveBeenCalled();
    await click('Keep recorded update and return to source review');
    const history = JSON.parse(
      window.sessionStorage.getItem(
        `mbfd-reviewed-source-update:${actor}:2026:history:${first?.key}`,
      ) ?? 'null',
    );
    expect(history.status).toBe('VERIFIED_RECORDED');
    expect(history.retained.receipt).toEqual(accepted);
    expect(button('Review latest source')?.disabled).toBe(false);
    expect(captures()).toHaveLength(1);
  });
  it('rejects a receipt that changed between POST and readback', async () => {
    handler = (entry) =>
      entry.path === 'evidence-updates/synthetic-reviewed-update' && saved
        ? response({ ok: true, update: { ...saved, reason: 'Different reviewed note' } })
        : undefined;
    await render();
    await click('Review latest source');
    await click('Capture reviewed update');
    expect(container.textContent).toContain('did not match');
    expect(button('Load reviewed update into draft')).toBeUndefined();
    expect(onApply).not.toHaveBeenCalled();
  });
  it.each(['sourceToken', 'originalFreezeId'] as const)(
    'rejects an otherwise valid capture for a different %s and retains the original request',
    async (field) => {
      handler = (entry) => {
        if (entry.path !== 'evidence-updates' || entry.method !== 'POST') return undefined;
        const changed = receipt(captureReason(entry));
        changed.freezePin.reviewedUpdate[field] =
          field === 'sourceToken' ? '9'.repeat(64) : 'different-original-freeze';
        expect(ReviewedUpdateReceiptSchema.safeParse(changed).success).toBe(true);
        return response({ ok: true, replayed: false, update: changed });
      };
      await render();
      await click('Review latest source');
      await click('Capture reviewed update');
      expect(container.textContent).toContain('does not match the retained request');
      expect(button('Load reviewed update into draft')).toBeUndefined();
      expect(onApply).not.toHaveBeenCalled();
      const retained = JSON.parse(
        window.sessionStorage.getItem(`mbfd-reviewed-source-update:${actor}:2026`) ?? 'null',
      );
      expect(retained.request.expected).toEqual(expected);
      expect(retained.key).toEqual(captures()[0]?.key);
      expect(retained.receipt).toBeUndefined();
    },
  );
  it('rejects a restored accepted receipt from a different reviewed source', async () => {
    const changed = receipt('Synthetic reviewed update');
    changed.freezePin.reviewedUpdate.sourceToken = '9'.repeat(64);
    window.sessionStorage.setItem(
      `mbfd-reviewed-source-update:${actor}:2026`,
      JSON.stringify({
        v: 1,
        actorScope: actor,
        year: 2026,
        key: '11111111-1111-4111-8111-111111111111',
        request: { expected, reason: changed.reason },
        receipt: changed,
      }),
    );
    await render();
    expect(container.textContent).toContain('retained source request could not be read');
    expect(button('Review latest source')?.disabled).toBe(true);
    expect(button('Load reviewed update into draft')).toBeUndefined();
    expect(entries).toEqual([]);
    expect(onApply).not.toHaveBeenCalled();
  });
  it('keeps a late capture with its original operator after identity changes in flight', async () => {
    let release: (value: Response) => void = () => {
      throw new Error('Capture not started');
    };
    let accepted: ReturnType<typeof receipt> | null = null;
    handler = (entry) => {
      if (entry.path !== 'evidence-updates' || entry.method !== 'POST') return undefined;
      accepted = receipt(captureReason(entry));
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    await render();
    await click('Review latest source');
    await act(async () => button('Capture reviewed update')?.click());
    await settle();
    const nextActor = 'synthetic-admin:92001:2';
    await render(version, false, nextActor);
    await act(async () => release(response({ ok: true, replayed: false, update: accepted })));
    await settle();
    expect(button('Capture reviewed update')).toBeUndefined();
    expect(button('Load reviewed update into draft')).toBeUndefined();
    expect(button('Review latest source')?.disabled).toBe(false);
    expect(onApply).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(`mbfd-reviewed-source-update:${nextActor}:2026`),
    ).toBeNull();
    const retained = JSON.parse(
      window.sessionStorage.getItem(`mbfd-reviewed-source-update:${actor}:2026`) ?? 'null',
    );
    expect(retained.actorScope).toBe(actor);
    expect(retained.receipt).toEqual(accepted);
  });
  it('invalidates a preview after operator authentication refresh without submitting', async () => {
    await render();
    await click('Review latest source');
    await act(async () => window.dispatchEvent(new Event(OPERATOR_AUTH_REFRESHED)));
    expect(button('Capture reviewed update')).toBeUndefined();
    expect(captures()).toEqual([]);
  });
  it('ignores an old preview after the saved version changes in flight', async () => {
    let release: (value: Response) => void = () => {
      throw new Error('Preview not started');
    };
    handler = (entry) =>
      entry.path === 'evidence-updates/preview'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : undefined;
    await render();
    const target = button('Review latest source');
    await act(async () => target?.click());
    await render({ ...version, id: 'new-synthetic-version', revision: 13 });
    await act(async () => release(response(preview())));
    await settle();
    expect(button('Capture reviewed update')).toBeUndefined();
    expect(captures()).toEqual([]);
  });
  it('blocks capture and loading while the parent has unfinished edits', async () => {
    await render(version, true);
    expect(button('Review latest source')?.disabled).toBe(true);
    await click('Review latest source');
    expect(entries).toEqual([]);
  });
  it('refuses inconsistent returned snapshot identities', () => {
    const candidate = receipt('Synthetic reviewed update');
    expect(ReviewedUpdateReceiptSchema.safeParse(candidate).success).toBe(true);
    candidate.freezePin.personnelSnapshot.sha256 = '9'.repeat(64);
    expect(ReviewedUpdateReceiptSchema.safeParse(candidate).success).toBe(false);
  });
});
