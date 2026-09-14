'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import type { BidDefinitionContent, BidImpactResponse } from '@mbfd/shared';
import { ArrowRight, BookOpen, GitBranch, History, Save } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BidBlueprint } from './BidBlueprint';
import { BidChangeReview } from './BidChangeReview';
import { FieldSection } from './BidFields';
import { BidImpactReview } from './BidImpactReview';
import { BidLiveReview } from './BidLiveReview';
import { BidMockReview } from './BidMockReview';
import { BidOpportunityFields } from './BidOpportunityFields';
import { BidPolicyFields, type PolicySection } from './BidPolicyFields';
import { BidVersionHistory } from './BidVersionHistory';
import { StageParticipantPreview } from './StageParticipantPreview';
import {
  type BidMockPreview,
  BidMockPreviewSchema,
  type BidMockResult,
  BidMockResultSchema,
  type BidPreview,
  BidPreviewSchema,
  BidRequestError,
  BidSaveResultSchema,
  type BidVersion,
  BidVersionsSchema,
  type CurrentBid,
  CurrentBidSchema,
  type HistoricalBid,
  HistoricalBidSchema,
  bidRequest,
} from './bid-client';
import {
  type BidDraft,
  type PendingBidWrite,
  bidDraftKey,
  bidSaveSummary,
  preserveBidDraft,
  readBidDraft,
} from './bid-draft';

const sections = [
  ['language', 'Policy & language'],
  ['flow', 'Participants & flow'],
  ['opportunities', 'Opportunities & rules'],
  ['specialties', 'Specialty rules'],
  ['contact', 'Contact & disposition'],
  ['a-day', 'A-Day'],
  ['timing', 'Timing & evidence dates'],
  ['authority', 'Authority & permissions'],
] as const;
type Section = (typeof sections)[number][0];
type View = 'edit' | 'blueprint' | 'mock' | 'live' | 'results' | 'versions';
const views: { id: View; label: string }[] = [
  { id: 'edit', label: 'Edit Bid' },
  { id: 'blueprint', label: 'Bid Blueprint' },
  { id: 'mock', label: 'Mock Bid' },
  { id: 'live', label: 'Live Bid' },
  { id: 'results', label: 'Results' },
];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const message = (error: unknown) =>
  error instanceof BidRequestError && error.issues.length
    ? [
        error.message,
        ...error.issues.map((issue) => `${issue.path.join(' › ')}: ${issue.message}`),
      ].join('\n')
    : error instanceof Error
      ? error.message
      : 'The request could not be completed.';

export function CurrentBidWorkspace({
  year,
  actorScope,
  initialView = 'edit',
}: { year: number; actorScope: string; initialView?: View }) {
  const router = useRouter();
  const [draft, setDraft] = useState<BidDraft | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [section, setSection] = useState<Section>('language');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [unreadableDraft, setUnreadableDraft] = useState(false);
  const [stale, setStale] = useState(false);
  const [preview, setPreview] = useState<BidPreview | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [blueprintImpact, setBlueprintImpact] = useState<BidImpactResponse | null>(null);
  const [blueprintImpactContent, setBlueprintImpactContent] = useState<string | null>(null);
  const [versions, setVersions] = useState<BidVersion[]>([]);
  const [nextVersion, setNextVersion] = useState<number | null>(null);
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  const [historical, setHistorical] = useState<HistoricalBid | null>(null);
  const [mockPreview, setMockPreview] = useState<BidMockPreview | null>(null);
  const [createdMock, setCreatedMock] = useState<BidMockResult | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const busyRef = useRef(false);
  const loadSequence = useRef(0);
  const dirty = draft !== null && !same(draft.content, draft.base.content);
  const contentStamp = draft ? JSON.stringify(draft.content) : null;
  const pending = draft?.pending ?? null;
  const locked = busy || pending !== null || unreadableDraft;
  const retainsDraft = useCallback(
    (url: URL) =>
      url.origin === window.location.origin &&
      url.pathname === '/admin/current-bid' &&
      url.searchParams.get('year') === String(year),
    [year],
  );
  useUnsavedChanges(
    dirty || pending !== null,
    pending ? 'Bid request; its outcome must be recovered' : 'Bid edits',
    retainsDraft,
  );
  const selectView = (next: View) => {
    setView(next);
    router.replace(`/admin/current-bid?year=${year}&view=${next}` as Route, { scroll: false });
  };

  const install = useCallback((value: BidDraft) => {
    draftRef.current = value;
    setDraft(value);
  }, []);
  const recordBlueprintImpact = useCallback(
    (result: BidImpactResponse | null) => {
      setBlueprintImpact(result);
      setBlueprintImpactContent(result && contentStamp ? contentStamp : null);
    },
    [contentStamp],
  );
  useEffect(() => {
    setView(initialView);
  }, [initialView]);
  const loadInitial = useCallback(async () => {
    const seq = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const current = await bidRequest(year, 'current', CurrentBidSchema);
      if (seq !== loadSequence.current) return;
      let saved: BidDraft | null = null;
      try {
        saved = readBidDraft(window.sessionStorage, actorScope, year);
      } catch (caught) {
        setStorageError(`The browser draft could not be opened: ${message(caught)}`);
        setUnreadableDraft(true);
      }
      if (saved && !saved.pending && !saved.reason && same(saved.content, saved.base.content))
        saved = null;
      install(
        saved ?? {
          v: 1,
          actorScope,
          year,
          base: current,
          content: current.content,
          reason: '',
          pending: null,
        },
      );
      setPreview(null);
      setPreviewContent(null);
      setBlueprintImpact(null);
      setBlueprintImpactContent(null);
      setStale(saved !== null && !same(saved.base.expected, current.expected));
      if (saved)
        setNotice(
          saved.pending
            ? 'An interrupted request was recovered. Retry that exact request before making more changes.'
            : 'Your unfinished Bid edits were restored from this browser tab.',
        );
    } catch (caught) {
      if (seq === loadSequence.current) setError(message(caught));
    } finally {
      if (seq === loadSequence.current) setLoading(false);
    }
  }, [actorScope, year, install]);
  useEffect(() => {
    void loadInitial();
    return () => {
      loadSequence.current++;
    };
  }, [loadInitial]);
  useEffect(() => {
    if (!draft || unreadableDraft) return;
    try {
      preserveBidDraft(window.sessionStorage, draft);
      setStorageError(null);
    } catch (caught) {
      setStorageError(`The browser could not preserve your draft: ${message(caught)}`);
    }
  }, [draft, unreadableDraft]);
  useEffect(() => {
    const preserve = (event: Event) => {
      const current = draftRef.current;
      if (!current) return;
      const work = Promise.resolve().then(() => {
        if (unreadableDraft)
          throw new Error(
            'The unreadable browser draft must be recovered or explicitly discarded before leaving.',
          );
        preserveBidDraft(window.sessionStorage, current);
      });
      (event as CustomEvent<Promise<unknown>[]>).detail.push(work);
    };
    window.addEventListener('mbfd-before-step-up', preserve);
    return () => window.removeEventListener('mbfd-before-step-up', preserve);
  }, [unreadableDraft]);

  const startWork = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    return true;
  };
  const finishWork = () => {
    busyRef.current = false;
    setBusy(false);
  };
  function edit(content: BidDefinitionContent) {
    if (!draftRef.current || busyRef.current || draftRef.current.pending || unreadableDraft) return;
    install({ ...draftRef.current, content });
    setPreview(null);
    setPreviewContent(null);
    setBlueprintImpact(null);
    setBlueprintImpactContent(null);
    setNotice(null);
  }
  async function execute(write: PendingBidWrite) {
    const current = draftRef.current;
    if (!current || !startWork()) return;
    let completed: string | null = null;
    try {
      const reserved = { ...current, pending: write };
      // Persist the exact request BEFORE dispatch. Reauthentication and a lost
      // response can then recover the original receipt, even after head changes.
      preserveBidDraft(window.sessionStorage, reserved);
      install(reserved);
      if (write.path === 'mock-sessions') {
        const result = await bidRequest(year, write.path, BidMockResultSchema, {
          body: write.body,
          key: write.key,
        });
        setCreatedMock(result);
        completed = `Mock Bid created from Version ${result.bidDefinition.versionNumber}.`;
      } else {
        const result = await bidRequest(year, write.path, BidSaveResultSchema, {
          body: write.body,
          key: write.key,
        });
        completed = result.changed
          ? `Version ${result.versionNumber} ${write.path === 'restore' ? 'restored as a new current version' : 'saved'}.`
          : `No policy changes. Version ${result.versionNumber} remains current.`;
      }
      const fresh = await bidRequest(year, 'current', CurrentBidSchema);
      const settled: BidDraft = {
        v: 1,
        actorScope,
        year,
        base: fresh,
        content: fresh.content,
        reason: '',
        pending: null,
      };
      preserveBidDraft(window.sessionStorage, settled);
      install(settled);
      setStale(false);
      setPreview(null);
      setPreviewContent(null);
      setBlueprintImpact(null);
      setBlueprintImpactContent(null);
      setHistorical(null);
      setMockPreview(null);
      setVersionsLoaded(false);
      setStorageError(null);
      setNotice(completed);
    } catch (caught) {
      if (completed)
        setError(
          `${completed} The refreshed Bid could not be loaded. Retry the original request to recover its receipt. ${message(caught)}`,
        );
      else {
        setError(message(caught));
        if (caught instanceof BidRequestError && !caught.uncertain && caught.status !== 401) {
          const state = draftRef.current;
          if (state) install({ ...state, pending: null });
          if (write.path === 'mock-sessions') setMockPreview(null);
          if (caught.code === 'bid_definition_or_source_changed') setStale(true);
        }
      }
    } finally {
      finishWork();
    }
  }
  async function evaluateDraft() {
    const current = draftRef.current;
    if (!current || !startWork()) return;
    try {
      const result = await bidRequest(year, 'preview', BidPreviewSchema, {
        body: {
          kind: 'definition',
          expected: current.base.expected,
          intent: { operation: 'save', content: current.content },
        },
      });
      setPreview(result);
      setPreviewContent(JSON.stringify(current.content));
    } catch (caught) {
      setError(message(caught));
      if (caught instanceof BidRequestError && caught.code === 'bid_definition_or_source_changed')
        setStale(true);
    } finally {
      finishWork();
    }
  }
  async function reviewMock() {
    const version = draftRef.current?.base.version;
    if (!version || !startWork()) return;
    try {
      const result = await bidRequest(year, 'preview', BidMockPreviewSchema, {
        body: { kind: 'mock', versionId: version.id, versionSha256: version.contentSha256 },
      });
      if (result.wouldAllowCreateMock && result.versionNumber !== version.versionNumber)
        throw new BidRequestError('invalid_server_response', 200, false);
      setMockPreview(result);
    } catch (caught) {
      setError(message(caught));
    } finally {
      finishWork();
    }
  }
  async function browseVersions(older = false) {
    if (!startWork()) return;
    try {
      const result = await bidRequest(
        year,
        `versions?limit=20${older && nextVersion !== null ? `&beforeVersionNumber=${nextVersion}` : ''}`,
        BidVersionsSchema,
      );
      setVersions((previous) =>
        older
          ? [
              ...previous,
              ...result.versions.filter((v) => !previous.some((old) => old.id === v.id)),
            ]
          : result.versions,
      );
      setNextVersion(result.nextBeforeVersionNumber);
      setVersionsLoaded(true);
    } catch (caught) {
      setError(message(caught));
    } finally {
      finishWork();
    }
  }
  async function selectVersion(version: BidVersion) {
    if (!startWork()) return;
    setHistorical(null);
    try {
      setHistorical(
        await bidRequest(year, `versions/${encodeURIComponent(version.id)}`, HistoricalBidSchema),
      );
    } catch (caught) {
      setError(message(caught));
    } finally {
      finishWork();
    }
  }
  async function refreshDiscard() {
    if (pending || !startWork()) return;
    if (
      dirty &&
      !window.confirm('Discard your unsaved Bid edits and load the current saved version?')
    ) {
      finishWork();
      return;
    }
    try {
      const current = await bidRequest(year, 'current', CurrentBidSchema);
      const next: BidDraft = {
        v: 1,
        actorScope,
        year,
        base: current,
        content: current.content,
        reason: '',
        pending: null,
      };
      preserveBidDraft(window.sessionStorage, next);
      install(next);
      setUnreadableDraft(false);
      setStorageError(null);
      setStale(false);
      setPreview(null);
      setPreviewContent(null);
      setBlueprintImpact(null);
      setBlueprintImpactContent(null);
      setNotice('Current saved Bid loaded.');
    } catch (caught) {
      setError(message(caught));
    } finally {
      finishWork();
    }
  }

  return (
    <div className="min-w-0 space-y-5" data-testid="current-bid-workspace">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bid workspace
          </p>
          <h1 className="mt-1 font-heading text-3xl">{year} Current Bid</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Edit the policy, understand its effects, rehearse, and run the Bid.
          </p>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (locked) return;
            const selected = Number(new FormData(event.currentTarget).get('year'));
            if (
              Number.isInteger(selected) &&
              selected >= 2024 &&
              selected <= 2100 &&
              (!dirty ||
                window.confirm('Leave this Bid and keep its unsaved draft in this browser tab?'))
            ) {
              try {
                if (draftRef.current) preserveBidDraft(window.sessionStorage, draftRef.current);
                router.push(`/admin/current-bid?year=${selected}` as Route);
              } catch (caught) {
                setStorageError(
                  `The draft could not be preserved, so this Bid remains open. ${message(caught)}`,
                );
              }
            }
          }}
        >
          <div>
            <Label htmlFor="current-bid-year">Bid year</Label>
            <Input
              id="current-bid-year"
              name="year"
              type="number"
              min={2024}
              max={2100}
              defaultValue={year}
              className="mt-1 w-28"
              disabled={locked}
            />
          </div>
          <Button type="submit" disabled={locked}>
            Open
          </Button>
        </form>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <GitBranch aria-hidden="true" className="size-5 text-primary" />
          <strong>
            {draft?.base.version
              ? `Version ${draft.base.version.versionNumber}`
              : draft
                ? 'First version ready to save'
                : 'Loading current version…'}
          </strong>
          <span className="text-sm text-muted-foreground">
            {pending
              ? 'Request recovery required'
              : dirty
                ? 'Unsaved changes'
                : draft
                  ? 'Saved content'
                  : ''}
          </span>
        </div>
        <Button
          type="button"
          onClick={() => {
            selectView('versions');
            if (!versionsLoaded) void browseVersions();
          }}
          disabled={busy}
        >
          <History aria-hidden="true" size={16} />
          Version history
        </Button>
      </div>
      <nav aria-label="Bid workspace" className="flex flex-wrap gap-2 border-b border-border pb-3">
        {views.map((item) => (
          <Button
            type="button"
            key={item.id}
            aria-pressed={view === item.id}
            variant={view === item.id ? 'primary' : 'ghost'}
            onClick={() => selectView(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </nav>
      {error && (
        <div
          role="alert"
          className="whitespace-pre-wrap break-words rounded border border-destructive p-4 text-sm"
        >
          {error}
        </div>
      )}
      {notice && (
        <output className="block rounded border border-border bg-card p-3 text-sm">{notice}</output>
      )}
      {storageError && (
        <div role="alert" className="space-y-3 rounded border border-warning p-4 text-sm">
          <p>{storageError}</p>
          <p>Keep this page open until the draft can be preserved.</p>
          {unreadableDraft && (
            <Button
              type="button"
              onClick={() => {
                if (window.confirm('Discard the unreadable Bid draft in this browser tab?')) {
                  window.sessionStorage.removeItem(bidDraftKey(actorScope, year));
                  setUnreadableDraft(false);
                  setStorageError(null);
                }
              }}
            >
              Discard unreadable browser draft
            </Button>
          )}
        </div>
      )}
      {stale && (
        <div role="alert" className="space-y-2 rounded border border-warning p-4 text-sm">
          <p>
            A newer saved Bid or source revision exists. Your edits are retained. Review them before
            discarding and loading the current version.
          </p>
          <Button
            type="button"
            disabled={busy || pending !== null}
            onClick={() => void refreshDiscard()}
          >
            Load current saved Bid
          </Button>
        </div>
      )}
      {pending && (
        <div className="space-y-3 rounded border border-warning bg-card p-4">
          <h2 className="font-semibold">Recover the interrupted request</h2>
          <p className="text-sm">
            The original request is retained. Retrying checks its receipt before the server
            considers another change.
          </p>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => void execute(pending)}
          >
            {busy ? 'Recovering…' : 'Retry original request'}
          </Button>
        </div>
      )}
      {loading && <output>Loading the current Bid…</output>}
      {!loading && !draft && (
        <Button type="button" onClick={() => void loadInitial()}>
          Retry loading Bid
        </Button>
      )}
      {draft && !loading && (
        <>
          {view === 'edit' && (
            <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[210px_minmax(0,1fr)]">
              <nav
                aria-label="Edit Bid sections"
                className="flex flex-wrap gap-2 xl:sticky xl:top-4 xl:flex-col"
              >
                {sections.map(([id, label]) => (
                  <Button
                    key={id}
                    type="button"
                    variant={section === id ? 'secondary' : 'ghost'}
                    aria-pressed={section === id}
                    className="justify-start text-left"
                    onClick={() => setSection(id)}
                  >
                    {label}
                  </Button>
                ))}
              </nav>
              <div className="min-w-0 space-y-4">
                <fieldset disabled={locked} className="min-w-0">
                  {section === 'opportunities' ? (
                    <BidOpportunityFields content={draft.content} onChange={edit} />
                  ) : (
                    <BidPolicyFields
                      content={draft.content}
                      section={section as PolicySection}
                      onChange={edit}
                    />
                  )}
                </fieldset>
                {section === 'flow' && (
                  <StageParticipantPreview
                    content={draft.content}
                    expected={draft.base.expected}
                    year={year}
                    locked={locked || stale}
                  />
                )}
                <form
                  className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const current = draftRef.current;
                    if (!current || locked || stale) return;
                    void execute({
                      path: 'versions',
                      key: crypto.randomUUID(),
                      body: {
                        expected: current.base.expected,
                        content: current.content,
                        reason: bidSaveSummary(current),
                      },
                    });
                  }}
                >
                  <div>
                    <Label htmlFor="bid-save-reason">Change summary</Label>
                    <Input
                      id="bid-save-reason"
                      value={draft.reason}
                      maxLength={1000}
                      disabled={locked}
                      className="mt-1"
                      onChange={(e) => install({ ...draft, reason: e.target.value })}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Optional. Save records what changed, who changed it and when. Earlier versions
                      stay in History and can be restored.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button type="submit" variant="primary" disabled={locked || stale}>
                      <Save aria-hidden="true" size={16} />
                      {busy ? 'Working…' : 'Save Bid'}
                    </Button>
                    <Button
                      type="button"
                      disabled={locked || stale}
                      onClick={() => {
                        selectView('blueprint');
                        void evaluateDraft();
                      }}
                    >
                      Preview changes (optional)
                      <ArrowRight aria-hidden="true" size={16} />
                    </Button>
                    <Button type="button" disabled={locked} onClick={() => void refreshDiscard()}>
                      {dirty ? 'Discard edits' : 'Refresh saved Bid'}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
          {view === 'blueprint' && (
            <div className="space-y-4">
              <FieldSection
                title="Bid Blueprint"
                description="Review the proposed configuration against the current saved Bid. Preview does not save a version or start a run."
              >
                <Button
                  type="button"
                  variant="primary"
                  disabled={locked || stale}
                  onClick={() => void evaluateDraft()}
                >
                  <BookOpen aria-hidden="true" size={16} />
                  {busy ? 'Evaluating…' : 'Review proposed changes'}
                </Button>
                {preview && previewContent === JSON.stringify(draft.content) && (
                  <BidChangeReview preview={preview} />
                )}
              </FieldSection>
              <BidBlueprint
                content={draft.content}
                preview={previewContent === JSON.stringify(draft.content) ? preview : null}
                impact={blueprintImpactContent === contentStamp ? blueprintImpact : null}
              />
              <BidImpactReview
                content={draft.content}
                expected={draft.base.expected}
                year={year}
                locked={locked || stale}
                begin={startWork}
                finish={finishWork}
                onImpact={recordBlueprintImpact}
              />
            </div>
          )}
          {view === 'versions' && (
            <BidVersionHistory
              base={draft.base}
              {...{
                versions,
                versionsLoaded,
                nextVersion,
                historical,
                busy,
                locked,
                dirty,
                stale,
                browseVersions,
                selectVersion,
                execute,
              }}
            />
          )}
          {view === 'mock' && (
            <BidMockReview
              base={draft.base}
              {...{ busy, locked, dirty, stale, mockPreview, createdMock, reviewMock, execute }}
            />
          )}
          {view === 'live' && (
            <BidLiveReview
              base={draft.base}
              year={year}
              {...{
                busy,
                locked,
                dirty,
                stale,
                begin: startWork,
                finish: finishWork,
              }}
            />
          )}
          {view === 'results' && (
            <FieldSection title="Results">
              <div className="flex flex-wrap gap-5">
                <Link
                  href="/admin/exports"
                  className="inline-flex min-h-11 items-center text-sm underline"
                >
                  Bid reports
                </Link>
                <Link
                  href="/admin/audit"
                  className="inline-flex min-h-11 items-center text-sm underline"
                >
                  Decision history
                </Link>
                <Link
                  href="/admin/award-transition"
                  className="inline-flex min-h-11 items-center text-sm underline"
                >
                  Reviewed final assignments
                </Link>
              </div>
            </FieldSection>
          )}
        </>
      )}
    </div>
  );
}
