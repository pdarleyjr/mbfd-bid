'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import type {
  BidDefinitionContent,
  BidImpactResponse,
  RetainedParticipationPreviewResponse,
} from '@mbfd/shared';
import { ArrowRight, BookOpen, GitBranch, History, Save } from 'lucide-react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BidBlueprint } from './BidBlueprint';
import { BidChangeReview } from './BidChangeReview';
import { FieldSection } from './BidFields';
import { BidImpactReview } from './BidImpactReview';
import { BidLiveReview } from './BidLiveReview';
import { BidMarineReview } from './BidMarineReview';
import { BidMockReview } from './BidMockReview';
import { BidOperations } from './BidOperations';
import { BidOpportunityFields } from './BidOpportunityFields';
import { BidPolicyFields, type PolicySection } from './BidPolicyFields';
import { BidProfileReview } from './BidProfileReview';
import { BidReadinessSummary } from './BidReadinessSummary';
import { BidResults } from './BidResults';
import { BidRetainedParticipation } from './BidRetainedParticipation';
import { BidReviewedSourceUpdate } from './BidReviewedSourceUpdate';
import { BidRuleProfiles } from './BidRuleProfiles';
import { BidVersionHistory } from './BidVersionHistory';
import { NewAnnualBidFromStructure } from './NewAnnualBidFromStructure';
import { StageParticipantPreview } from './StageParticipantPreview';
import {
  BidEvidenceFreezeResponseSchema,
  type BidLiveResult,
  BidLiveResultSchema,
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
  Reviewed2026CandidateSchema,
  bidRequest,
} from './bid-client';
import {
  type BidDraft,
  type PendingBidWrite,
  bidDraftKey,
  bidSaveSummary,
  preserveBidDraft,
  readBidDraft,
  reconcileProfileDraftEdit,
} from './bid-draft';
import type { ReviewedUpdateReceipt } from './reviewed-source-update-client';
import { useBidNavigation } from './use-bid-navigation';

const sections = [
  ['language', 'Policy & language'],
  ['flow', 'Participants & flow'],
  ['opportunities', 'Opportunities & rules'],
  ['profiles', 'Shared requirements & points'],
  ['specialties', 'Specialty rules'],
  ['contact', 'Contact & disposition'],
  ['a-day', 'A-Day'],
  ['timing', 'Timing & evidence dates'],
  ['authority', 'Authority & permissions'],
] as const;
export type Section = (typeof sections)[number][0];
type View = 'edit' | 'blueprint' | 'marine' | 'mock' | 'live' | 'results' | 'versions';
const views: { id: View; label: string }[] = [
  { id: 'edit', label: 'Edit Bid' },
  { id: 'blueprint', label: 'Bid Blueprint' },
  { id: 'marine', label: 'Marine evidence' },
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
  initialSection = 'language',
}: { year: number; actorScope: string; initialView?: View; initialSection?: Section }) {
  const router = useRouter();
  const search = useSearchParams();
  const [draft, setDraft] = useState<BidDraft | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [section, setSection] = useState<Section>(initialSection);
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
  const [createdLive, setCreatedLive] = useState<BidLiveResult | null>(null);
  const [liveReviewGeneration, setLiveReviewGeneration] = useState(0);
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
  const openDestination = useCallback(
    (next: string, nextSection?: string) => {
      setView(next as View);
      if (nextSection) setSection(nextSection as Section);
      router.replace(
        `/admin/current-bid?year=${year}&view=${next}${nextSection ? `&section=${nextSection}` : ''}` as Route,
        { scroll: false },
      );
    },
    [router, year],
  );
  const destination = view === 'edit' ? `${view}:${section}` : view;
  const committedView = search.get('view') ?? 'edit';
  const committedDestination =
    committedView === 'edit' ? `edit:${search.get('section') ?? 'language'}` : committedView;
  const navigation = useBidNavigation(
    destination,
    loading || destination !== committedDestination,
    openDestination,
    initialView !== 'edit'
      ? initialView
      : initialSection !== 'language'
        ? `edit:${initialSection}`
        : undefined,
  );
  const selectView = (next: View, nextSection?: Section) =>
    navigation.navigate(next, next === 'edit' ? (nextSection ?? section) : undefined);
  const destinationTitle =
    view === 'edit'
      ? (sections.find(([id]) => id === section)?.[1] ?? 'Edit Bid')
      : view === 'versions'
        ? 'Version history'
        : view === 'marine'
          ? 'Marine evidence'
          : (views.find((item) => item.id === view)?.label ?? view);

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
    install({
      ...draftRef.current,
      content: reconcileProfileDraftEdit(draftRef.current.content, content),
    });
    setPreview(null);
    setPreviewContent(null);
    setBlueprintImpact(null);
    setBlueprintImpactContent(null);
    setNotice(null);
  }
  function applyReviewedSourceUpdate(update: ReviewedUpdateReceipt) {
    const current = draftRef.current;
    if (
      !current ||
      current.content.settings?.v !== 3 ||
      current.pending ||
      unreadableDraft ||
      busyRef.current ||
      stale ||
      !same(current.content, current.base.content) ||
      current.base.version?.id !== update.sourceVersionId ||
      current.base.version.contentSha256 !== update.sourceVersionSha256
    )
      throw new Error(
        'The saved Bid changed. Refresh and review the source before loading this update.',
      );
    const next: BidDraft = {
      ...current,
      content: {
        ...current.content,
        settings: { ...current.content.settings, evidenceFreeze: update.freezePin },
        sourceDecisions: update.sourceDecisions,
      },
      reason: update.reason,
    };
    preserveBidDraft(window.sessionStorage, next);
    install(next);
    setPreview(null);
    setPreviewContent(null);
    setBlueprintImpact(null);
    setBlueprintImpactContent(null);
    setNotice(
      'The reviewed source update is in your draft. Review the changes and Save Bid to create a new version. Existing sessions retain their source.',
    );
    selectView('edit');
  }
  function applyRetainedParticipation(proposal: RetainedParticipationPreviewResponse) {
    const current = draftRef.current;
    const pin = current?.content.settings?.v === 3 ? current.content.settings.evidenceFreeze : null;
    if (
      !current ||
      current.actorScope !== actorScope ||
      year !== 2026 ||
      current.pending ||
      unreadableDraft ||
      busyRef.current ||
      stale ||
      !same(current.content, current.base.content) ||
      !same(current.base.expected, proposal.expected) ||
      !pin ||
      pin.derivation ||
      pin.reviewedUpdate ||
      pin.freezeId !== proposal.source.freezeId ||
      pin.evaluationSha256 !== proposal.source.evaluationSha256 ||
      pin.personnelSnapshot.sha256 !== proposal.source.personnelSha256 ||
      pin.credentialSnapshot.sha256 !== proposal.source.credentialSha256 ||
      pin.sourceVersionId !== proposal.source.sourceVersionId ||
      pin.sourceVersionSha256 !== proposal.source.sourceVersionSha256
    )
      throw new Error(
        'The saved Bid or draft changed. Refresh and review retained participation again.',
      );
    const next: BidDraft = {
      ...current,
      content: proposal.content,
      reason: `Reconcile ${proposal.retainedCount} retained members: ${proposal.beforeCounts.ordinaryParticipants} to ${proposal.counts.ordinaryParticipants} ordinary participants.`,
    };
    preserveBidDraft(window.sessionStorage, next);
    install(next);
    setPreview(null);
    setPreviewContent(null);
    setBlueprintImpact(null);
    setBlueprintImpactContent(null);
    setNotice(
      'Reviewed retained participation is in your draft. Review the changes and Save Bid to create a new version.',
    );
    selectView('edit', 'flow');
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
      } else if (write.path === 'live-sessions') {
        const result = await bidRequest(year, write.path, BidLiveResultSchema, {
          body: write.body,
          key: write.key,
        });
        setCreatedLive(result);
        completed = `Live session created from Version ${result.bidDefinition.versionNumber}. It has not started.`;
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
          // A definitive rejection requires a new preflight and confirmation.
          // An uncertain outcome keeps the original review and durable request
          // locked for recovery with the same idempotency key instead.
          if (write.path === 'live-sessions') setLiveReviewGeneration((value) => value + 1);
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
  async function prepareReviewed2026Candidate() {
    const current = draftRef.current;
    const version = current?.base.version;
    if (
      year !== 2026 ||
      !current ||
      !version ||
      version.versionNumber !== 8 ||
      version.contentSha256 !==
        '74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666' ||
      !same(current.content, current.base.content) ||
      current.pending ||
      stale ||
      !startWork()
    )
      return;
    try {
      const candidate = await bidRequest(
        year,
        'reviewed-2026-candidate',
        Reviewed2026CandidateSchema,
        { body: {} },
      );
      if (
        candidate.sourceVersionId !== version.id ||
        candidate.sourceSha256 !== version.contentSha256 ||
        candidate.content.bidYear !== year
      )
        throw new BidRequestError('reviewed_2026_predecessor_changed', 409, false);
      const next: BidDraft = {
        ...current,
        content: candidate.content,
        reason:
          'Reviewed 2026 source reconciliation for pre-cutoff rehearsal; final evidence certification remains pending.',
      };
      preserveBidDraft(window.sessionStorage, next);
      install(next);
      setPreview(null);
      setPreviewContent(null);
      setBlueprintImpact(null);
      setBlueprintImpactContent(null);
      setNotice(
        `${candidate.label}. Review the changes and save a new version before creating a Mock.`,
      );
      selectView('edit');
    } catch (caught) {
      setError(message(caught));
    } finally {
      finishWork();
    }
  }
  async function prepareFinalEvidenceDraft() {
    const current = draftRef.current;
    const version = current?.base.version;
    if (
      year !== 2026 ||
      !current ||
      !version ||
      version.versionNumber <= 8 ||
      !same(current.content, current.base.content) ||
      current.pending ||
      stale ||
      !startWork()
    )
      return;
    try {
      const { freeze } = await bidRequest(year, 'evidence-freeze', BidEvidenceFreezeResponseSchema);
      if (!freeze) throw new BidRequestError('final_evidence_freeze_pending', 409, false);
      if (
        freeze.sourceVersionId !== version.id ||
        freeze.sourceVersionSha256 !== version.contentSha256
      )
        throw new BidRequestError('final_evidence_source_version_changed', 409, false);
      if (current.content.settings?.v !== 3)
        throw new BidRequestError('final_evidence_settings_required', 409, false);
      const decision = current.content.sourceDecisions.find(
        (item) => item.issueId === '2026-eligibility-cutoff-evidence',
      );
      if (!decision || decision.status !== 'OPEN')
        throw new BidRequestError('final_evidence_decision_unavailable', 409, false);
      const approvedAt = new Date().toISOString();
      const next: BidDraft = {
        ...current,
        content: {
          ...current.content,
          settings: {
            ...current.content.settings,
            evidenceFreeze: {
              freezeId: freeze.freezeId,
              evaluationSha256: freeze.evaluationSha256,
              sourceVersionId: freeze.sourceVersionId,
              sourceVersionSha256: freeze.sourceVersionSha256,
              evidenceCutoffAt: freeze.evidenceCutoffAt,
              timeZone: freeze.timeZone,
              approvedAt,
              sourceImports: freeze.sourceImports,
              personnelSnapshot: {
                sha256: freeze.personnelSha256,
                asOfAt: freeze.evidenceCutoffAt,
                capturedAt: freeze.capturedAt,
              },
              credentialSnapshot: {
                sha256: freeze.credentialSha256,
                asOfAt: freeze.evidenceCutoffAt,
                capturedAt: freeze.capturedAt,
              },
            },
          },
          sourceDecisions: current.content.sourceDecisions.map((item) =>
            item.issueId === decision.issueId
              ? {
                  ...item,
                  status: 'RESOLVED' as const,
                  decision: `Approved the immutable 2026-09-30 17:00 Eastern evidence capture ${freeze.freezeId}; personnel ${freeze.personnelSha256}; credentials ${freeze.credentialSha256}; evaluation ${freeze.evaluationSha256}.`,
                  sourceRef: `bid_evidence_freezes:${freeze.freezeId}`,
                  effectiveOn: '2026-09-30',
                }
              : item,
          ),
        },
        reason: `Approve immutable 2026-09-30 17:00 Eastern eligibility evidence ${freeze.freezeId}; final 2026 Bid configuration.`,
      };
      preserveBidDraft(window.sessionStorage, next);
      install(next);
      setPreview(null);
      setPreviewContent(null);
      setNotice(
        'Final 5:00 PM personnel and credential snapshot loaded into this draft. Review the hashes, changes, and final readiness before saving a new saved Bid version.',
      );
      selectView('edit');
    } catch (caught) {
      setError(message(caught));
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
            Prepare, run or practice your annual Bid.
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
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {navigation.announcement}
      </div>
      {draft && !loading && (
        <BidOperations
          year={year}
          content={draft.content}
          versionId={draft.base.version?.id ?? null}
          createdMockId={
            createdMock && createdMock.bidDefinition.versionId === draft.base.version?.id
              ? createdMock.id
              : null
          }
          disabled={locked || dirty || stale}
          ready={mockPreview?.wouldAllowCreateMock ?? null}
          onCheckMock={() => {
            selectView('mock');
            void reviewMock();
          }}
          onOpen={selectView}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <GitBranch aria-hidden="true" className="size-5 text-primary" />
          <strong>
            {draft?.base.version
              ? `Saved Bid Version ${draft.base.version.versionNumber}`
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
        <div className="flex flex-wrap gap-2">
          {year === 2026 &&
            draft?.base.version?.versionNumber === 8 &&
            draft.base.version.contentSha256 ===
              '74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666' && (
              <Button
                type="button"
                disabled={locked || dirty || stale}
                onClick={() => void prepareReviewed2026Candidate()}
              >
                Prepare reviewed 2026 rehearsal
              </Button>
            )}
          {year === 2026 &&
            (draft?.base.version?.versionNumber ?? 0) > 8 &&
            draft?.content.settings?.v === 3 &&
            !draft.content.settings.evidenceFreeze && (
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  disabled={locked || dirty || stale}
                  onClick={() => void prepareFinalEvidenceDraft()}
                >
                  Load final 5:00 PM snapshot
                </Button>
                <span className="max-w-56 text-xs text-muted-foreground">
                  Requires the September 30, 17:00 Eastern server capture. Loading does not save a
                  final version.
                </span>
              </div>
            )}
          <NewAnnualBidFromStructure
            sourceYear={year}
            sourceVersion={draft?.base.version ?? null}
            content={draft?.base.content ?? null}
            disabled={locked || dirty || stale}
            onCreated={(targetYear) =>
              router.push(`/admin/current-bid?year=${targetYear}` as Route)
            }
          />
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
      </div>
      {year === 2026 &&
        draft?.base.version &&
        !loading &&
        draft.base.content.settings?.v === 3 &&
        draft.base.content.settings.evidenceFreeze &&
        !draft.base.content.settings.evidenceFreeze.derivation &&
        !draft.base.content.settings.evidenceFreeze.reviewedUpdate && (
          <BidRetainedParticipation
            key={actorScope}
            actorScope={actorScope}
            base={draft.base}
            draftStamp={JSON.stringify(draft)}
            disabled={locked || dirty || stale}
            onApply={applyRetainedParticipation}
            onReviewSources={() => selectView('edit', 'language')}
          />
        )}
      {year === 2026 &&
        draft?.base.version &&
        draft.content.settings?.v === 3 &&
        draft.content.settings.evidenceFreeze && (
          <BidReviewedSourceUpdate
            key={actorScope}
            actorScope={actorScope}
            version={{
              id: draft.base.version.id,
              revision: draft.base.version.versionNumber,
              sha256: draft.base.version.contentSha256,
            }}
            disabled={locked || dirty || stale}
            onApply={applyReviewedSourceUpdate}
          />
        )}
      <details>
        <summary className="min-h-11 cursor-pointer content-center font-semibold">
          Advanced Bid configuration
        </summary>
        <nav
          aria-label="Bid workspace"
          className="flex flex-wrap gap-2 border-b border-border pb-3"
        >
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
      </details>
      {draft && !loading && year === 2026 && (
        <BidReadinessSummary
          year={year}
          content={draft.content}
          policyReady={draft.content.policy !== null}
          realActivationReviewCount={
            draft.content.sourceDecisions.filter((decision) => decision.status === 'OPEN').length
          }
          positionsReady={draft.base.coverage.valid}
          participantStagesConfigured={
            (draft.content.policy?.stageParticipantSources?.length ?? 0) > 0
          }
          aDayConfigured={
            draft.content.settings?.v === 3 &&
            draft.content.settings.livePolicy.annualOperations?.aDay.execution !== undefined
          }
          onOpenEdit={(nextSection) => {
            selectView('edit', nextSection);
          }}
          onOpenMock={() => selectView('mock')}
          onOpenLive={() => selectView('live')}
        />
      )}
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
            A newer saved Bid exists. Reload it before continuing. Your unsaved edits are retained
            until you choose to discard them.
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
        <div
          key={destination}
          aria-labelledby="bid-destination-heading"
          className="min-w-0 space-y-4"
        >
          <h2
            id="bid-destination-heading"
            ref={navigation.heading}
            tabIndex={-1}
            className="scroll-mt-4 rounded font-heading text-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Review {destinationTitle}
          </h2>
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
                    onClick={() => selectView('edit', id)}
                  >
                    {label}
                  </Button>
                ))}
              </nav>
              <div className="min-w-0 space-y-4">
                <fieldset disabled={locked} className="min-w-0">
                  {section === 'opportunities' ? (
                    <BidOpportunityFields content={draft.content} onChange={edit} />
                  ) : section === 'profiles' ? (
                    <BidRuleProfiles
                      content={draft.content}
                      selectedPositionId={null}
                      onChange={edit}
                    />
                  ) : (
                    <BidPolicyFields
                      content={draft.content}
                      section={section as PolicySection}
                      onChange={edit}
                    />
                  )}
                </fieldset>
                {section === 'profiles' && (
                  <BidProfileReview
                    content={draft.content}
                    expected={draft.base.expected}
                    year={year}
                    locked={locked || stale}
                  />
                )}
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
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={locked}
                    onClick={() => selectView('edit', section)}
                  >
                    Back to editing
                  </Button>
                  {preview && previewContent === JSON.stringify(draft.content) && dirty ? (
                    <Button
                      type="button"
                      variant="primary"
                      disabled={locked || stale}
                      onClick={() => {
                        const current = draftRef.current;
                        if (
                          !current ||
                          locked ||
                          stale ||
                          previewContent !== JSON.stringify(current.content)
                        )
                          return;
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
                      Save reviewed changes
                    </Button>
                  ) : null}
                </div>
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
          {view === 'marine' && (
            <BidMarineReview
              year={year}
              versionId={draft.base.version?.id ?? null}
              versionSha256={draft.base.version?.contentSha256 ?? null}
            />
          )}
          {view === 'live' && (
            <BidLiveReview
              key={liveReviewGeneration}
              base={draft.base}
              year={year}
              execute={execute}
              createdLive={createdLive}
              onOpenAuthority={() => {
                selectView('edit', 'authority');
              }}
              onOpenAssignmentTerms={() => {
                selectView('edit', 'specialties');
              }}
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
          {view === 'results' && <BidResults year={year} />}
        </div>
      )}
    </div>
  );
}
