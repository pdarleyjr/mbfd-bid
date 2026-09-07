'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { SyntheticSpecialtyStateSignal } from '@mbfd/shared';
import { type FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import { useBidWebSocket } from '../../bid/_hooks/useBidWebSocket';

type RecordValue = Record<string, unknown>;
type SpecialtyPhase =
  | 'resolving_higher_priority_candidates'
  | 'awaiting_original_bidder'
  | 'awaiting_resume';
type ReleaseReason = 'declined' | 'unreachable' | 'withdrawn' | 'ineligible_on_recheck';
type CommandOperation = 'begin' | 'candidate' | 'original' | 'resume';
type TestPolicyTieBreak = 'rsc_seniority' | 'rank_seniority' | 'member_id';

const SPECIALTY_TEST_POLICY_LABEL = 'TEST POLICY — NOT APPROVED MBFD POLICY' as const;
const TEST_POLICY_RANKING_SOURCE = 'EXPLICIT_TEST_PRIORITY' as const;
const TEST_POLICY_SCORING_DIRECTION = 'LOWER_SCORE_WINS' as const;
const TEST_POLICY_NORMAL_BID_INTERRUPTION = 'SUSPEND_EXACT_NORMAL_TURN' as const;
const TEST_POLICY_ORIGINAL_BIDDER_RESUME = 'RESUME_EXACT_ORIGINAL_TURN' as const;
const TEST_POLICY_CANDIDATE_OUTCOMES = [
  'award',
  'declined',
  'unreachable',
  'withdrawn',
  'ineligible_on_recheck',
] as const;
const TEST_POLICY_TIE_BREAKS = ['rsc_seniority', 'rank_seniority', 'member_id'] as const;

const TEST_POLICY_TIE_BREAK_LABELS: Record<TestPolicyTieBreak, string> = {
  rsc_seniority: 'RSC seniority',
  rank_seniority: 'Rank seniority',
  member_id: 'Member ID',
};

interface SpecialtyTestPolicyEnvelope {
  policy_label: typeof SPECIALTY_TEST_POLICY_LABEL;
  policy_version: string;
  specialty_pool: { id: string; label: string };
  qualification_requirements: {
    v: 1;
    credential_names: string[];
    specialty_codes: string[];
  };
  ranking: { source: typeof TEST_POLICY_RANKING_SOURCE; reference: string };
  scoring: {
    source: typeof TEST_POLICY_RANKING_SOURCE;
    direction: typeof TEST_POLICY_SCORING_DIRECTION;
  };
  tie_break_chain: TestPolicyTieBreak[];
  normal_bid_interruption: typeof TEST_POLICY_NORMAL_BID_INTERRUPTION;
  candidate_outcomes: typeof TEST_POLICY_CANDIDATE_OUTCOMES;
  original_bidder_resume: typeof TEST_POLICY_ORIGINAL_BIDDER_RESUME;
}

interface CandidateSummary {
  memberId: number;
  priorityRank: number;
}

interface ActiveSpecialtyState {
  requestId: string;
  positionId: string;
  policyReference: string;
  policySource: 'synthetic' | 'official';
  originalBidderId: number;
  phase: SpecialtyPhase;
  candidateQueue: CandidateSummary[];
  candidateCursor: number;
  resolvedCandidateCount: number;
  resolution: RecordValue | null;
}

interface SpecialtyState {
  revision: number;
  active: ActiveSpecialtyState | null;
}

interface SpecialtyNormalTurn {
  bidderId: number;
  ordinal: number;
  queueCursor: number;
  mockControlRevision: number | null;
}

interface SpecialtyReceipt {
  commandId: string | null;
  operation: string | null;
  origin: string | null;
  reason: string | null;
  replayed: boolean;
  raw: unknown;
}

interface SpecialtyStatus {
  state: SpecialtyState;
  normalTurn: SpecialtyNormalTurn | null;
  receipts: SpecialtyReceipt[];
  databaseAuditLog: string | null;
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseCandidateSummary(value: unknown): CandidateSummary | null {
  const candidate = asRecord(value);
  if (candidate === null) return null;
  const memberId = asPositiveInteger(candidate.memberId);
  const priorityRank = asNonNegativeInteger(candidate.priorityRank);
  if (memberId === null || priorityRank === null) return null;
  return { memberId, priorityRank };
}

function parseActiveState(value: unknown): ActiveSpecialtyState | null {
  const active = asRecord(value);
  if (active === null) return null;
  const requestId = asString(active.requestId);
  const positionId = asString(active.positionId);
  const policyReference = asString(active.policyReference);
  const policySource = active.policySource;
  const phase = active.phase;
  const originalTurn = asRecord(active.originalTurn);
  const originalBidderId = originalTurn === null ? null : asPositiveInteger(originalTurn.bidderId);
  const candidateCursor = asNonNegativeInteger(active.candidateCursor);
  const candidateOutcomes = active.candidateOutcomes;
  if (
    requestId === null ||
    positionId === null ||
    policyReference === null ||
    (policySource !== 'synthetic' && policySource !== 'official') ||
    (phase !== 'resolving_higher_priority_candidates' &&
      phase !== 'awaiting_original_bidder' &&
      phase !== 'awaiting_resume') ||
    originalBidderId === null ||
    candidateCursor === null ||
    !Array.isArray(active.candidateQueue) ||
    !Array.isArray(candidateOutcomes)
  ) {
    return null;
  }
  const candidateQueue = active.candidateQueue.map(parseCandidateSummary);
  if (candidateQueue.some((candidate) => candidate === null)) return null;
  return {
    requestId,
    positionId,
    policyReference,
    policySource,
    originalBidderId,
    phase,
    candidateQueue: candidateQueue as CandidateSummary[],
    candidateCursor,
    resolvedCandidateCount: candidateOutcomes.length,
    resolution: asRecord(active.resolution),
  };
}

function parseState(value: unknown): SpecialtyState | null {
  const state = asRecord(value);
  if (state === null) return null;
  const revision = asNonNegativeInteger(state.revision);
  if (revision === null || !('active' in state)) return null;
  if (state.active === null) return { revision, active: null };
  const active = parseActiveState(state.active);
  return active === null ? null : { revision, active };
}

function parseNormalTurn(value: unknown): SpecialtyNormalTurn | null | undefined {
  if (value === null) return null;
  const turn = asRecord(value);
  if (turn === null) return undefined;
  const bidderId = asPositiveInteger(turn.bidder_id);
  const ordinal = asPositiveInteger(turn.ordinal);
  const queueCursor = asNonNegativeInteger(turn.queue_cursor);
  const mockControlRevision =
    turn.mock_control_revision === null ? null : asNonNegativeInteger(turn.mock_control_revision);
  if (bidderId === null || ordinal === null || queueCursor === null) return undefined;
  if (mockControlRevision === null && turn.mock_control_revision !== null) return undefined;
  return { bidderId, ordinal, queueCursor, mockControlRevision };
}

function parseReceipt(value: unknown, replayed = false): SpecialtyReceipt | null {
  const receipt = asRecord(value);
  if (receipt === null) return null;
  return {
    commandId: asString(receipt.commandId),
    operation: asString(receipt.operation),
    origin: asString(receipt.origin),
    reason: asString(receipt.reason),
    replayed,
    raw: value,
  };
}

function parseStatus(value: unknown): SpecialtyStatus | null {
  const response = asRecord(value);
  if (
    response === null ||
    response.mode !== 'synthetic_test_only' ||
    response.does_not_commit_bid !== true
  ) {
    return null;
  }
  const state = parseState(response.state);
  const normalTurn = parseNormalTurn(response.normal_turn);
  if (state === null || normalTurn === undefined || !Array.isArray(response.audit_receipts))
    return null;
  const receipts = response.audit_receipts.map((receipt) => parseReceipt(receipt)).filter(Boolean);
  return {
    state,
    normalTurn,
    receipts: receipts as SpecialtyReceipt[],
    databaseAuditLog: asString(response.database_audit_log),
  };
}

function workerError(value: unknown, fallback: string): string {
  const response = asRecord(value);
  if (response === null) return fallback;
  const error = asString(response.error);
  const policyError = asString(response.policy_error);
  const message = asString(response.message);
  if (error === null) return message ?? fallback;
  const qualifier = policyError === null ? '' : ` (${policyError})`;
  return message === null ? `${error}${qualifier}` : `${error}${qualifier} — ${message}`;
}

function createCommandId(operation: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `synthetic-specialty-${operation}-${suffix}`;
}

function lineItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSpecialtyTestPolicy(input: {
  policyVersion: string;
  poolId: string;
  poolLabel: string;
  credentialRequirements: string;
  specialtyRequirements: string;
  rankingReference: string;
  tieBreaks: readonly [TestPolicyTieBreak, TestPolicyTieBreak, TestPolicyTieBreak | ''];
}): { ok: true; policy: SpecialtyTestPolicyEnvelope } | { ok: false; error: string } {
  const policyVersion = input.policyVersion.trim();
  if (policyVersion.length === 0 || policyVersion.length > 160) {
    return { ok: false, error: 'Test-policy version must contain 1–160 characters.' };
  }
  const poolId = input.poolId.trim();
  if (poolId.length === 0 || poolId.length > 160) {
    return { ok: false, error: 'Synthetic specialty-pool ID must contain 1–160 characters.' };
  }
  const poolLabel = input.poolLabel.trim();
  if (poolLabel.length === 0 || poolLabel.length > 200) {
    return { ok: false, error: 'Synthetic specialty-pool label must contain 1–200 characters.' };
  }
  const credentialRequirements = lineItems(input.credentialRequirements);
  const specialtyRequirements = lineItems(input.specialtyRequirements);
  const totalRequirements = credentialRequirements.length + specialtyRequirements.length;
  if (totalRequirements === 0 || totalRequirements > 30) {
    return {
      ok: false,
      error: 'Provide 1–30 synthetic credential names and specialty codes in total.',
    };
  }
  if (credentialRequirements.some((requirement) => requirement.length > 160)) {
    return {
      ok: false,
      error: 'Each synthetic credential name must be 160 characters or less.',
    };
  }
  if (specialtyRequirements.some((requirement) => requirement.length > 160)) {
    return {
      ok: false,
      error: 'Each synthetic specialty qualification code must be 160 characters or less.',
    };
  }
  if (new Set(credentialRequirements).size !== credentialRequirements.length) {
    return { ok: false, error: 'Synthetic credential names must be unique.' };
  }
  if (new Set(specialtyRequirements).size !== specialtyRequirements.length) {
    return { ok: false, error: 'Synthetic specialty qualification codes must be unique.' };
  }
  const rankingReference = input.rankingReference.trim();
  if (rankingReference.length === 0 || rankingReference.length > 160) {
    return { ok: false, error: 'Explicit test-ranking reference must contain 1–160 characters.' };
  }
  const tieBreakChain = input.tieBreaks.filter(
    (tieBreak): tieBreak is TestPolicyTieBreak => tieBreak !== '',
  );
  if (tieBreakChain.length < 2 || tieBreakChain.length > 3) {
    return { ok: false, error: 'Configure two or three ordered synthetic tie-breaks.' };
  }
  if (new Set(tieBreakChain).size !== tieBreakChain.length) {
    return { ok: false, error: 'Synthetic tie-break entries must be unique.' };
  }
  if (tieBreakChain.at(-1) !== 'member_id') {
    return { ok: false, error: 'Synthetic tie-break chain must end with Member ID.' };
  }
  return {
    ok: true,
    policy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: policyVersion,
      specialty_pool: { id: poolId, label: poolLabel },
      qualification_requirements: {
        v: 1,
        credential_names: credentialRequirements,
        specialty_codes: specialtyRequirements,
      },
      ranking: { source: TEST_POLICY_RANKING_SOURCE, reference: rankingReference },
      scoring: {
        source: TEST_POLICY_RANKING_SOURCE,
        direction: TEST_POLICY_SCORING_DIRECTION,
      },
      tie_break_chain: tieBreakChain,
      normal_bid_interruption: TEST_POLICY_NORMAL_BID_INTERRUPTION,
      candidate_outcomes: TEST_POLICY_CANDIDATE_OUTCOMES,
      original_bidder_resume: TEST_POLICY_ORIGINAL_BIDDER_RESUME,
    },
  };
}

function candidateRows(
  value: string,
):
  | { ok: true; candidates: Array<{ member_id: number; explicit_priority: number }> }
  | { ok: false; error: string } {
  const rows = value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length === 0)
    return { ok: false, error: 'At least one synthetic candidate is required.' };
  const candidates: Array<{ member_id: number; explicit_priority: number }> = [];
  const memberIds = new Set<number>();
  for (const row of rows) {
    const parts = row.split(/[,:\s]+/).filter(Boolean);
    if (parts.length !== 2) {
      return {
        ok: false,
        error: 'Each synthetic candidate must use exactly “member ID, explicit priority score”.',
      };
    }
    const memberId = Number(parts[0]);
    const priorityRank = Number(parts[1]);
    if (
      !Number.isSafeInteger(memberId) ||
      memberId <= 0 ||
      !Number.isSafeInteger(priorityRank) ||
      priorityRank < 0
    ) {
      return {
        ok: false,
        error:
          'Candidate member IDs must be positive integers and explicit priority scores must be zero or greater.',
      };
    }
    if (memberIds.has(memberId)) {
      return {
        ok: false,
        error: 'Synthetic candidates must not repeat a member ID.',
      };
    }
    memberIds.add(memberId);
    candidates.push({ member_id: memberId, explicit_priority: priorityRank });
  }
  return { ok: true, candidates };
}

function commandKeyLabel(commandId: string | null): string {
  return commandId ?? 'Generated on first submit and retained for a safe retry.';
}

function receiptKey(receipt: SpecialtyReceipt): string {
  return receipt.commandId ?? JSON.stringify(receipt.raw);
}

function receiptTitle(receipt: SpecialtyReceipt): string {
  const operation = receipt.operation?.replaceAll('_', ' ') ?? 'synthetic command';
  return receipt.replayed ? `${operation} receipt replayed` : `${operation} receipt recorded`;
}

/**
 * This UI is intentionally constrained to the backend's mock-only specialty
 * adapter. It serializes only a labelled, typed synthetic test-policy envelope
 * and sends no live-Bid or portal command; every action is revisioned and
 * independently guarded by the Worker.
 */
export function SpecialtyAdjudicationWorkspace({ wsBase }: { wsBase?: string | undefined }) {
  const [sessionId, setSessionId] = useState('');
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpecialtyStatus | null>(null);
  const [receipts, setReceipts] = useState<SpecialtyReceipt[]>([]);
  const [positionId, setPositionId] = useState('');
  const [candidateRowsText, setCandidateRowsText] = useState('');
  const [policyReference, setPolicyReference] = useState('synthetic-specialty-fixture-v2');
  const [testPolicyVersion, setTestPolicyVersion] = useState('synthetic-specialty-v2');
  const [testPolicyPoolId, setTestPolicyPoolId] = useState('SYNTHETIC_SPECIALTY_TEST_POOL');
  const [testPolicyPoolLabel, setTestPolicyPoolLabel] = useState('Synthetic specialty test pool');
  const [testPolicyCredentialRequirements, setTestPolicyCredentialRequirements] =
    useState('SYNTHETIC_CREDENTIAL_A');
  const [testPolicySpecialtyRequirements, setTestPolicySpecialtyRequirements] =
    useState('SYNTHETIC_SPECIALTY_A');
  const [testPolicyRankingReference, setTestPolicyRankingReference] = useState(
    'synthetic-specialty-ranking-v2',
  );
  const [testPolicyTieBreakOne, setTestPolicyTieBreakOne] =
    useState<TestPolicyTieBreak>('rsc_seniority');
  const [testPolicyTieBreakTwo, setTestPolicyTieBreakTwo] =
    useState<TestPolicyTieBreak>('rank_seniority');
  const [testPolicyTieBreakThree, setTestPolicyTieBreakThree] = useState<TestPolicyTieBreak | ''>(
    'member_id',
  );
  const [releasePolicy, setReleasePolicy] = useState<
    'continue_to_next_higher_priority' | 'return_to_original_bidder'
  >('continue_to_next_higher_priority');
  const [beginReason, setBeginReason] = useState('');
  const [candidateReason, setCandidateReason] = useState('');
  const [candidateOutcome, setCandidateOutcome] = useState<'award' | 'release'>('release');
  const [candidateReleaseReason, setCandidateReleaseReason] = useState<ReleaseReason>('declined');
  const [candidateAwardReference, setCandidateAwardReference] = useState('');
  const [originalReason, setOriginalReason] = useState('');
  const [originalOutcome, setOriginalOutcome] = useState<'award' | 'release'>('award');
  const [originalReleaseReason, setOriginalReleaseReason] = useState<ReleaseReason>('declined');
  const [originalAwardReference, setOriginalAwardReference] = useState('');
  const [resumeReason, setResumeReason] = useState('');
  const [commandIds, setCommandIds] = useState<Partial<Record<CommandOperation, string>>>({});
  const [beginRequestId, setBeginRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState<CommandOperation | 'inspect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [socketControlState, setSocketControlState] = useState<
    SyntheticSpecialtyStateSignal['controlState'] | null
  >(null);
  const sessionIdRef = useRef('');
  const lastRehydratedSignalRef = useRef<string | null>(null);

  const trimmedSessionId = sessionId.trim();
  sessionIdRef.current = trimmedSessionId;
  const state = status?.state ?? null;
  const active = state?.active ?? null;
  const stateLoaded = state !== null && loadedSessionId === trimmedSessionId;
  const nextCandidate =
    active?.phase === 'resolving_higher_priority_candidates'
      ? (active.candidateQueue[active.candidateCursor] ?? null)
      : null;
  const normalizedCandidateRows = useMemo(
    () => candidateRows(candidateRowsText),
    [candidateRowsText],
  );

  const rehydrateFromSyntheticSpecialtySignal = useCallback(
    (signal: SyntheticSpecialtyStateSignal) => {
      // The frame itself carries only a sanitized invalidation summary. The
      // guarded admin GET below remains the source for commandable state,
      // receipts, and all UI rendering after disconnect/reconnect.
      if (signal.bidSessionId !== sessionIdRef.current) return;
      setSocketControlState(signal.controlState);
      const signalKey = `${signal.bidSessionId}:${signal.revision}`;
      if (lastRehydratedSignalRef.current === signalKey) return;
      lastRehydratedSignalRef.current = signalKey;
      void (async () => {
        try {
          const response = await fetch(
            `/api/admin/bid-session/${encodeURIComponent(signal.bidSessionId)}/specialty-adjudication`,
            { credentials: 'include', cache: 'no-store' },
          );
          const body: unknown = await response.json().catch(() => null);
          if (signal.bidSessionId !== sessionIdRef.current) return;
          if (!response.ok) {
            setError(workerError(body, `Live specialty rehydration failed (${response.status}).`));
            return;
          }
          const nextStatus = parseStatus(body);
          if (nextStatus === null) {
            setError('Live specialty rehydration returned an incomplete synthetic state.');
            return;
          }
          setStatus(nextStatus);
          setReceipts(nextStatus.receipts);
          setLoadedSessionId(signal.bidSessionId);
          setNotice(
            'Live synthetic specialty state rehydrated through the guarded Worker read. It remains separate from canonical Bid state.',
          );
        } catch (caught) {
          if (signal.bidSessionId !== sessionIdRef.current) return;
          setError(
            caught instanceof Error
              ? caught.message
              : 'Live specialty rehydration could not be reached.',
          );
        }
      })();
    },
    [],
  );
  const { status: specialtySocketStatus } = useBidWebSocket(null, {
    bidSessionId: trimmedSessionId,
    wsBase,
    // This isolated surface must not silently fall back to the Pages origin:
    // its websocket endpoint belongs to the Worker and is enabled only when
    // the server supplied that explicit Worker base.
    enabled: stateLoaded && typeof wsBase === 'string' && wsBase.length > 0,
    onSyntheticSpecialtyState: rehydrateFromSyntheticSpecialtySignal,
  });

  function clearLoadedState() {
    setLoadedSessionId(null);
    setStatus(null);
    setReceipts([]);
    setError(null);
    setNotice(null);
    setCommandIds({});
    setBeginRequestId(null);
    setSocketControlState(null);
    lastRehydratedSignalRef.current = null;
  }

  function resetBeginKey() {
    setBeginRequestId(null);
    setCommandIds((current) => {
      const { begin: _discarded, ...remaining } = current;
      return remaining;
    });
  }

  function resetActionKey(operation: Exclude<CommandOperation, 'begin'>) {
    setCommandIds((current) => {
      const { [operation]: _discarded, ...remaining } = current;
      return remaining;
    });
  }

  function retainReceipt(receipt: SpecialtyReceipt) {
    setReceipts((current) => {
      const existing = current.find((entry) => receiptKey(entry) === receiptKey(receipt));
      return existing ? current : [...current, receipt];
    });
  }

  async function inspectState(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (trimmedSessionId.length === 0 || trimmedSessionId.length > 160) {
      setError('Enter a 1–160 character mock Bid session ID before inspecting specialty state.');
      return;
    }
    setBusy('inspect');
    try {
      const response = await fetch(
        `/api/admin/bid-session/${encodeURIComponent(trimmedSessionId)}/specialty-adjudication`,
        { credentials: 'include' },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(workerError(body, `Specialty inspection failed (${response.status}).`));
        return;
      }
      const nextStatus = parseStatus(body);
      if (nextStatus === null) {
        setError(
          'The Worker reply is not a complete synthetic specialty state. No scenario is enabled.',
        );
        return;
      }
      setStatus(nextStatus);
      setReceipts(nextStatus.receipts);
      setLoadedSessionId(trimmedSessionId);
      setNotice('Synthetic specialty state loaded. It remains separate from canonical Bid state.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Specialty inspection could not be reached.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function submitCommand(
    operation: CommandOperation,
    endpoint: string,
    commandId: string,
    payload: RecordValue,
  ) {
    setError(null);
    setNotice(null);
    setBusy(operation);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': commandId,
        },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(workerError(body, `Specialty ${operation} command failed (${response.status}).`));
        return;
      }
      const responseRecord = asRecord(body);
      const nextState =
        responseRecord === null ? null : parseState(asRecord(responseRecord.result)?.state);
      if (
        responseRecord === null ||
        responseRecord.mode !== 'synthetic_test_only' ||
        responseRecord.does_not_commit_bid !== true ||
        responseRecord.kind !== 'accepted' ||
        nextState === null
      ) {
        setError(
          'The Worker command reply did not provide complete synthetic state evidence. Reload before another action.',
        );
        return;
      }
      const receipt = parseReceipt(
        responseRecord.audit_receipt,
        responseRecord.idempotent_replay === true,
      );
      setStatus((current) => ({
        state: nextState,
        normalTurn: current?.normalTurn ?? null,
        receipts:
          receipt === null ? (current?.receipts ?? []) : [...(current?.receipts ?? []), receipt],
        databaseAuditLog: current?.databaseAuditLog ?? null,
      }));
      if (receipt !== null) retainReceipt(receipt);
      setLoadedSessionId(trimmedSessionId);
      setNotice(
        receipt === null
          ? 'The Worker accepted a synthetic command but did not return a receipt. Reload before treating the rehearsal as evidenced.'
          : responseRecord.idempotent_replay === true
            ? 'The original synthetic command receipt was replayed. No new command was created.'
            : 'Synthetic command receipt recorded. The canonical Bid remains unchanged.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : `Specialty ${operation} command could not be reached. Retry with the same idempotency key.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function beginScenario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stateLoaded || state === null || active !== null) {
      setError(
        'Reload a mock session with no active specialty adjudication before beginning a synthetic scenario.',
      );
      return;
    }
    const normalTurn = status?.normalTurn;
    if (
      normalTurn === null ||
      normalTurn === undefined ||
      normalTurn.mockControlRevision === null
    ) {
      setError(
        'The current mock normal turn and its control revision are unavailable. Reload after the ordinary mock Bid is initialized.',
      );
      return;
    }
    if (positionId.trim().length === 0 || positionId.trim().length > 160) {
      setError('Enter the biddable position ID from the frozen mock session.');
      return;
    }
    if (!normalizedCandidateRows.ok) {
      setError(normalizedCandidateRows.error);
      return;
    }
    const trimmedReference = policyReference.trim();
    if (!trimmedReference.startsWith('synthetic-') || trimmedReference.length > 160) {
      setError('The labelled scenario reference must begin with “synthetic-”.');
      return;
    }
    const testPolicy = buildSpecialtyTestPolicy({
      policyVersion: testPolicyVersion,
      poolId: testPolicyPoolId,
      poolLabel: testPolicyPoolLabel,
      credentialRequirements: testPolicyCredentialRequirements,
      specialtyRequirements: testPolicySpecialtyRequirements,
      rankingReference: testPolicyRankingReference,
      tieBreaks: [testPolicyTieBreakOne, testPolicyTieBreakTwo, testPolicyTieBreakThree],
    });
    if (!testPolicy.ok) {
      setError(testPolicy.error);
      return;
    }
    const trimmedReason = beginReason.trim();
    if (trimmedReason.length < 4 || trimmedReason.length > 500) {
      setError('Record a 4–500 character operator reason before beginning the synthetic scenario.');
      return;
    }
    const commandId = commandIds.begin ?? createCommandId('begin');
    const requestId = beginRequestId ?? createCommandId('request');
    setCommandIds((current) => ({ ...current, begin: commandId }));
    setBeginRequestId(requestId);
    await submitCommand(
      'begin',
      `/api/admin/bid-session/${encodeURIComponent(trimmedSessionId)}/specialty-adjudication/requests`,
      commandId,
      {
        command_id: commandId,
        expected_revision: state.revision,
        expected_normal_control_revision: normalTurn.mockControlRevision,
        request_id: requestId,
        position_id: positionId.trim(),
        policy: {
          source: 'synthetic',
          policy_reference: trimmedReference,
          test_policy: testPolicy.policy,
          candidate_release_policy: { status: 'configured', on_release: releasePolicy },
          candidates: normalizedCandidateRows.candidates,
        },
        reason: trimmedReason,
      },
    );
  }

  async function resolveCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stateLoaded || state === null || active === null || nextCandidate === null) {
      setError('Reload the active specialty state before resolving a candidate.');
      return;
    }
    const trimmedReason = candidateReason.trim();
    if (trimmedReason.length < 4 || trimmedReason.length > 500) {
      setError(
        'Record a 4–500 character operator reason before resolving this synthetic candidate.',
      );
      return;
    }
    const awardReference = candidateAwardReference.trim();
    if (candidateOutcome === 'award' && awardReference.length === 0) {
      setError('An award reference is required when the synthetic candidate is awarded.');
      return;
    }
    const commandId = commandIds.candidate ?? createCommandId('candidate');
    setCommandIds((current) => ({ ...current, candidate: commandId }));
    await submitCommand(
      'candidate',
      `/api/admin/bid-session/${encodeURIComponent(trimmedSessionId)}/specialty-adjudication/candidates`,
      commandId,
      {
        command_id: commandId,
        expected_revision: state.revision,
        request_id: active.requestId,
        member_id: nextCandidate.memberId,
        outcome:
          candidateOutcome === 'award'
            ? { kind: 'award', award_reference: awardReference }
            : { kind: 'release', reason: candidateReleaseReason },
        reason: trimmedReason,
      },
    );
  }

  async function resolveOriginal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stateLoaded || state === null || active === null) {
      setError('Reload the active specialty state before resolving the original bidder.');
      return;
    }
    const trimmedReason = originalReason.trim();
    if (trimmedReason.length < 4 || trimmedReason.length > 500) {
      setError('Record a 4–500 character operator reason before resolving the original bidder.');
      return;
    }
    const awardReference = originalAwardReference.trim();
    if (originalOutcome === 'award' && awardReference.length === 0) {
      setError('An award reference is required when the original bidder is awarded.');
      return;
    }
    const commandId = commandIds.original ?? createCommandId('original');
    setCommandIds((current) => ({ ...current, original: commandId }));
    await submitCommand(
      'original',
      `/api/admin/bid-session/${encodeURIComponent(trimmedSessionId)}/specialty-adjudication/original-request`,
      commandId,
      {
        command_id: commandId,
        expected_revision: state.revision,
        request_id: active.requestId,
        outcome:
          originalOutcome === 'award'
            ? { kind: 'award', award_reference: awardReference }
            : { kind: 'release', reason: originalReleaseReason },
        reason: trimmedReason,
      },
    );
  }

  async function resumeNormalTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stateLoaded || state === null || active === null) {
      setError('Reload the active specialty state before resuming the synthetic normal turn.');
      return;
    }
    const trimmedReason = resumeReason.trim();
    if (trimmedReason.length < 4 || trimmedReason.length > 500) {
      setError(
        'Record a 4–500 character operator reason before resuming the synthetic normal turn.',
      );
      return;
    }
    const commandId = commandIds.resume ?? createCommandId('resume');
    setCommandIds((current) => ({ ...current, resume: commandId }));
    await submitCommand(
      'resume',
      `/api/admin/bid-session/${encodeURIComponent(trimmedSessionId)}/specialty-adjudication/resume`,
      commandId,
      {
        command_id: commandId,
        expected_revision: state.revision,
        request_id: active.requestId,
        reason: trimmedReason,
      },
    );
  }

  return (
    <section
      className="mx-auto max-w-7xl space-y-6"
      aria-labelledby="specialty-adjudication-heading"
    >
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-warning">
          Mock-bid interruption rehearsal
        </p>
        <h1
          id="specialty-adjudication-heading"
          className="mt-1 font-heading text-3xl text-foreground"
        >
          Specialty adjudication rehearsal
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Inspect and exercise one labelled synthetic interruption against an existing frozen mock
          session. The Worker owns the ordered state machine and the idempotent receipts.
        </p>
      </header>

      <section
        className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning"
        aria-labelledby="specialty-boundary-heading"
      >
        <h2 id="specialty-boundary-heading" className="font-semibold text-warning">
          Synthetic test only
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-warning">
          <li>
            This rehearsal does not commit a Bid, create a live award, or enqueue portal writeback.
          </li>
          <li>
            No approved specialty policy or live specialty adjudication path exists in this
            workspace.
          </li>
          <li>
            Every scenario carries the fixed label TEST POLICY — NOT APPROVED MBFD POLICY; it is a
            typed mock fixture, not an imported or inferred MBFD policy.
          </li>
          <li>Only a mock session with a frozen policy snapshot can be inspected or commanded.</li>
          <li>
            Receipts are Durable Object rehearsal evidence; they are not the canonical D1/R2 audit
            chain.
          </li>
        </ul>
      </section>

      <form
        data-testid="specialty-inspect-form"
        onSubmit={inspectState}
        className="rounded-xl border border-border bg-card p-5"
      >
        <div className="flex flex-wrap items-end gap-4">
          <Label className="block min-w-72 flex-1">
            <span className="text-sm font-medium text-foreground">Mock Bid session ID</span>
            <Input
              name="session_id"
              required
              maxLength={160}
              autoComplete="off"
              value={sessionId}
              onChange={(event) => {
                setSessionId(event.target.value);
                clearLoadedState();
              }}
              placeholder="Mock session identifier"
              className="mt-1 block min-h-11 w-full rounded border border-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground"
            />
          </Label>
          <Button
            type="submit"
            disabled={busy !== null || trimmedSessionId.length === 0}
            className="min-h-11 rounded bg-warning px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-warning disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'inspect' ? 'Inspecting…' : 'Inspect specialty state'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Inspection is read-only. After a valid empty mock state loads, you can begin labelled
          synthetic scenario. A Worker rejection is shown verbatim below and never converted into an
          official-policy fallback.
        </p>
      </form>

      {error !== null && (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive-surface px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p
          aria-live="polite"
          className="rounded border border-info/40 bg-info-surface px-4 py-3 text-sm text-info"
        >
          {notice}
        </p>
      )}
      {stateLoaded && socketControlState !== null && (
        <p
          data-testid="specialty-live-control-state"
          aria-live="polite"
          className="rounded border border-border bg-card px-4 py-3 text-sm text-foreground"
        >
          Live synthetic control signal: transport {specialtySocketStatus}; specialty revision{' '}
          {state?.revision ?? socketControlState.rehearsalRevision ?? 'unknown'}; normal bidder{' '}
          {socketControlState.normalBidderSuspended ? 'suspended' : 'not suspended'}; next action{' '}
          {socketControlState.specialty.allowedNextAction.replaceAll('_', ' ')}. The complete state
          is rehydrated through the guarded Worker read, not retained only in this page.
        </p>
      )}

      {stateLoaded && state !== null && (
        <>
          <section
            className="rounded-xl border border-border bg-card p-5"
            aria-labelledby="specialty-state-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-info">
                  Worker-owned state
                </p>
                <h2
                  id="specialty-state-heading"
                  className="mt-1 font-heading text-xl text-foreground"
                >
                  Specialty interruption state
                </h2>
              </div>
              <span className="rounded-full border border-border px-3 py-1 font-mono text-xs font-semibold text-foreground">
                Revision {state.revision}
              </span>
            </div>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Mode</dt>
                <dd className="mt-1 font-medium text-foreground">Synthetic test only</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Bid commit</dt>
                <dd className="mt-1 font-medium text-foreground">Not committed</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Database audit</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {status?.databaseAuditLog ?? 'Not reported'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Active interruption</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {active === null ? 'None' : active.phase.replaceAll('_', ' ')}
                </dd>
              </div>
            </dl>

            {active !== null && (
              <div className="mt-5 rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
                <p className="font-semibold">Synthetic interruption is active</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-warning">Request</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{active.requestId}</dd>
                  </div>
                  <div>
                    <dt className="text-warning">Position</dt>
                    <dd className="mt-1 font-mono text-xs">{active.positionId}</dd>
                  </div>
                  <div>
                    <dt className="text-warning">Original bidder</dt>
                    <dd className="mt-1 font-medium">Member {active.originalBidderId}</dd>
                  </div>
                  <div>
                    <dt className="text-warning">Policy label</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{active.policyReference}</dd>
                  </div>
                </dl>
                {nextCandidate !== null && (
                  <p className="mt-3 text-warning">
                    Next eligible synthetic candidate: member {nextCandidate.memberId}, priority{' '}
                    {nextCandidate.priorityRank}.
                  </p>
                )}
              </div>
            )}
            {active === null && receipts.some((receipt) => receipt.operation === 'resume') && (
              <p className="mt-4 rounded border border-success/40 bg-success-surface px-3 py-2 text-sm text-success">
                Normal Bid turn resumed in synthetic state. Confirm actual Bid/operator acceptance
                separately; this receipt is not a live-Bid completion claim.
              </p>
            )}
          </section>

          {active === null && (
            <form
              data-testid="specialty-begin-form"
              onSubmit={beginScenario}
              className="rounded-xl border border-border bg-card p-5"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-warning">
                  Controlled fixture
                </p>
                <h2 className="mt-1 font-heading text-xl text-foreground">
                  Begin labelled synthetic scenario
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-foreground">
                  Enter synthetic explicit-priority scores only. The Worker independently derives
                  general eligibility and specialty qualifications from the frozen mock snapshot,
                  preserves the actual normal bidder, and requires this list to exactly cover its
                  frozen bid pool.
                </p>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <Label className="block">
                  <span className="text-sm font-medium text-foreground">Biddable position ID</span>
                  <Input
                    name="position_id"
                    required
                    maxLength={160}
                    value={positionId}
                    onChange={(event) => {
                      setPositionId(event.target.value);
                      resetBeginKey();
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 font-mono text-sm text-foreground"
                  />
                </Label>
                <Label className="block">
                  <span className="text-sm font-medium text-foreground">
                    Synthetic scenario reference
                  </span>
                  <Input
                    name="policy_reference"
                    required
                    maxLength={160}
                    value={policyReference}
                    onChange={(event) => {
                      setPolicyReference(event.target.value);
                      resetBeginKey();
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 font-mono text-sm text-foreground"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Must start with synthetic-. It binds the mock-only route contract and is not an
                    approved policy reference.
                  </span>
                </Label>
                <fieldset className="rounded-lg border border-warning/40 bg-warning-surface p-4 lg:col-span-2">
                  <legend className="px-1 text-sm font-semibold text-warning">
                    Typed synthetic test-policy envelope
                  </legend>
                  <p className="mt-1 max-w-3xl text-sm text-warning">
                    This complete envelope is sent only to the mock specialty route. It is
                    explicitly versioned and never substitutes for approved MBFD specialty policy.
                  </p>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <Label className="block lg:col-span-2">
                      <span className="text-sm font-medium text-foreground">Test policy label</span>
                      <Input
                        name="test_policy_label"
                        readOnly
                        value={SPECIALTY_TEST_POLICY_LABEL}
                        className="mt-1 min-h-11 w-full rounded border border-warning/40 bg-card px-3 font-mono text-sm text-warning"
                      />
                    </Label>
                    <Label className="block">
                      <span className="text-sm font-medium text-foreground">Policy version</span>
                      <Input
                        name="test_policy_version"
                        required
                        maxLength={160}
                        value={testPolicyVersion}
                        onChange={(event) => {
                          setTestPolicyVersion(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 font-mono text-sm text-foreground"
                      />
                    </Label>
                    <Label className="block">
                      <span className="text-sm font-medium text-foreground">Specialty pool ID</span>
                      <Input
                        name="test_policy_pool_id"
                        required
                        maxLength={160}
                        value={testPolicyPoolId}
                        onChange={(event) => {
                          setTestPolicyPoolId(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 font-mono text-sm text-foreground"
                      />
                    </Label>
                    <Label className="block lg:col-span-2">
                      <span className="text-sm font-medium text-foreground">
                        Specialty pool label
                      </span>
                      <Input
                        name="test_policy_pool_label"
                        required
                        maxLength={200}
                        value={testPolicyPoolLabel}
                        onChange={(event) => {
                          setTestPolicyPoolLabel(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground"
                      />
                    </Label>
                    <Label className="block lg:col-span-2">
                      <span className="text-sm font-medium text-foreground">
                        Required credential names
                      </span>
                      <Textarea
                        name="test_policy_credential_requirements"
                        rows={3}
                        maxLength={5000}
                        value={testPolicyCredentialRequirements}
                        onChange={(event) => {
                          setTestPolicyCredentialRequirements(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground"
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        One synthetic credential name per line. The Worker checks only frozen
                        evaluation-date evidence; this form cannot assert a credential or
                        eligibility result.
                      </span>
                    </Label>
                    <Label className="block lg:col-span-2">
                      <span className="text-sm font-medium text-foreground">
                        Required specialty qualification codes
                      </span>
                      <Textarea
                        name="test_policy_specialty_requirements"
                        rows={3}
                        maxLength={5000}
                        value={testPolicySpecialtyRequirements}
                        onChange={(event) => {
                          setTestPolicySpecialtyRequirements(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground"
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        One synthetic specialty code per line. A code requires source-safe frozen
                        lifecycle evidence at the configured evaluation date; pre-bridge snapshots
                        are rejected rather than treated as qualified.
                      </span>
                    </Label>
                    <Label className="block">
                      <span className="text-sm font-medium text-foreground">
                        Explicit test ranking source
                      </span>
                      <Input
                        name="test_policy_ranking_source"
                        readOnly
                        value={TEST_POLICY_RANKING_SOURCE}
                        className="mt-1 min-h-11 w-full rounded border border-warning/40 bg-card px-3 font-mono text-sm text-warning"
                      />
                    </Label>
                    <Label className="block">
                      <span className="text-sm font-medium text-foreground">
                        Explicit test ranking reference
                      </span>
                      <Input
                        name="test_policy_ranking_reference"
                        required
                        maxLength={160}
                        value={testPolicyRankingReference}
                        onChange={(event) => {
                          setTestPolicyRankingReference(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 font-mono text-sm text-foreground"
                      />
                    </Label>
                    <Label className="block">
                      <span className="text-sm font-medium text-foreground">Scoring direction</span>
                      <Input
                        name="test_policy_scoring_direction"
                        readOnly
                        value={TEST_POLICY_SCORING_DIRECTION}
                        className="mt-1 min-h-11 w-full rounded border border-warning/40 bg-card px-3 font-mono text-sm text-warning"
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Lower score wins; configured tie-breaks resolve equal scores.
                      </span>
                    </Label>
                    <fieldset className="rounded border border-border p-3 lg:col-span-2">
                      <legend className="px-1 text-sm font-medium text-foreground">
                        Tie-break chain
                      </legend>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Configure two or three unique synthetic tie-breaks in order, ending with
                        Member ID.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <Label className="block">
                          <span className="text-xs text-foreground">First</span>
                          <NativeSelect
                            name="test_policy_tie_break_1"
                            value={testPolicyTieBreakOne}
                            onChange={(event) => {
                              setTestPolicyTieBreakOne(event.target.value as TestPolicyTieBreak);
                              resetBeginKey();
                            }}
                            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground"
                          >
                            {TEST_POLICY_TIE_BREAKS.map((tieBreak) => (
                              <option key={tieBreak} value={tieBreak}>
                                {TEST_POLICY_TIE_BREAK_LABELS[tieBreak]}
                              </option>
                            ))}
                          </NativeSelect>
                        </Label>
                        <Label className="block">
                          <span className="text-xs text-foreground">Second</span>
                          <NativeSelect
                            name="test_policy_tie_break_2"
                            value={testPolicyTieBreakTwo}
                            onChange={(event) => {
                              setTestPolicyTieBreakTwo(event.target.value as TestPolicyTieBreak);
                              resetBeginKey();
                            }}
                            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground"
                          >
                            {TEST_POLICY_TIE_BREAKS.map((tieBreak) => (
                              <option key={tieBreak} value={tieBreak}>
                                {TEST_POLICY_TIE_BREAK_LABELS[tieBreak]}
                              </option>
                            ))}
                          </NativeSelect>
                        </Label>
                        <Label className="block">
                          <span className="text-xs text-foreground">Third (optional)</span>
                          <NativeSelect
                            name="test_policy_tie_break_3"
                            value={testPolicyTieBreakThree}
                            onChange={(event) => {
                              setTestPolicyTieBreakThree(
                                event.target.value as TestPolicyTieBreak | '',
                              );
                              resetBeginKey();
                            }}
                            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground"
                          >
                            <option value="">No third tie-break</option>
                            {TEST_POLICY_TIE_BREAKS.map((tieBreak) => (
                              <option key={tieBreak} value={tieBreak}>
                                {TEST_POLICY_TIE_BREAK_LABELS[tieBreak]}
                              </option>
                            ))}
                          </NativeSelect>
                        </Label>
                      </div>
                    </fieldset>
                    <dl className="grid gap-3 rounded border border-border bg-card p-3 text-sm lg:col-span-2 sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Normal Bid interruption</dt>
                        <dd className="mt-1 font-mono text-xs text-warning">
                          {TEST_POLICY_NORMAL_BID_INTERRUPTION}
                        </dd>
                        <dd className="mt-1 text-xs text-foreground">
                          Suspend exact normal Bid turn
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Allowed candidate outcomes</dt>
                        <dd className="mt-1 font-mono text-xs text-warning">
                          {TEST_POLICY_CANDIDATE_OUTCOMES.join(' · ')}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Scoring</dt>
                        <dd className="mt-1 font-mono text-xs text-warning">
                          {TEST_POLICY_SCORING_DIRECTION}
                        </dd>
                        <dd className="mt-1 text-xs text-foreground">Lower score wins</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Original-bidder resumption</dt>
                        <dd className="mt-1 font-mono text-xs text-success">
                          {TEST_POLICY_ORIGINAL_BIDDER_RESUME}
                        </dd>
                        <dd className="mt-1 text-xs text-foreground">
                          Resume exact original Bid turn
                        </dd>
                      </div>
                    </dl>
                  </div>
                </fieldset>
                <Label className="block">
                  <span className="text-sm font-medium text-foreground">
                    Released-candidate behavior
                  </span>
                  <NativeSelect
                    name="release_policy"
                    value={releasePolicy}
                    onChange={(event) => {
                      setReleasePolicy(event.target.value as typeof releasePolicy);
                      resetBeginKey();
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground"
                  >
                    <option value="continue_to_next_higher_priority">
                      Continue to next higher-priority synthetic candidate
                    </option>
                    <option value="return_to_original_bidder">
                      Return to original synthetic bidder
                    </option>
                  </NativeSelect>
                </Label>
                <Label className="block lg:col-span-2">
                  <span className="text-sm font-medium text-foreground">Synthetic candidates</span>
                  <Textarea
                    name="candidate_rows"
                    required
                    rows={4}
                    value={candidateRowsText}
                    onChange={(event) => {
                      setCandidateRowsText(event.target.value);
                      resetBeginKey();
                    }}
                    placeholder={
                      'One candidate per line: member ID, explicit priority score\n11, 1\n17, 1'
                    }
                    className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Equal scores are resolved by the configured tie-break chain. Include every
                    non-excluded frozen mock-pool member exactly once; eligibility is evaluated by
                    the Worker, never asserted by this form.
                  </span>
                </Label>
                <Label className="block lg:col-span-2">
                  <span className="text-sm font-medium text-foreground">Operator reason</span>
                  <Textarea
                    name="begin_reason"
                    required
                    minLength={4}
                    maxLength={500}
                    rows={3}
                    value={beginReason}
                    onChange={(event) => {
                      setBeginReason(event.target.value);
                      resetBeginKey();
                    }}
                    placeholder="Record why this synthetic specialty fixture is being rehearsed."
                    className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </Label>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  disabled={busy !== null}
                  className="min-h-11 rounded bg-warning px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-warning disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'begin' ? 'Beginning synthetic scenario…' : 'Begin synthetic scenario'}
                </Button>
                <span className="max-w-xl text-xs text-muted-foreground">
                  Idempotency key:{' '}
                  <span className="font-mono">{commandKeyLabel(commandIds.begin ?? null)}</span>
                </span>
              </div>
            </form>
          )}

          {active?.phase === 'resolving_higher_priority_candidates' && nextCandidate !== null && (
            <form
              data-testid="specialty-candidate-form"
              onSubmit={resolveCandidate}
              className="rounded-xl border border-border bg-card p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-warning">
                Ordered candidate resolution
              </p>
              <h2 className="mt-1 font-heading text-xl text-foreground">
                Resolve next synthetic candidate
              </h2>
              <p className="mt-1 text-sm text-foreground">
                Only member {nextCandidate.memberId} at priority {nextCandidate.priorityRank} is
                currently accepted by the Worker.
              </p>
              <OutcomeFields
                prefix="candidate"
                outcome={candidateOutcome}
                setOutcome={setCandidateOutcome}
                releaseReason={candidateReleaseReason}
                setReleaseReason={setCandidateReleaseReason}
                awardReference={candidateAwardReference}
                setAwardReference={setCandidateAwardReference}
                resetKey={() => resetActionKey('candidate')}
              />
              <ReasonAndSubmit
                name="candidate_reason"
                value={candidateReason}
                onChange={(value) => {
                  setCandidateReason(value);
                  resetActionKey('candidate');
                }}
                commandId={commandIds.candidate ?? null}
                busy={busy === 'candidate'}
                label="Resolve synthetic candidate"
              />
            </form>
          )}

          {active?.phase === 'awaiting_original_bidder' && (
            <form
              data-testid="specialty-original-form"
              onSubmit={resolveOriginal}
              className="rounded-xl border border-border bg-card p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-warning">
                Original bidder resolution
              </p>
              <h2 className="mt-1 font-heading text-xl text-foreground">
                Resolve original synthetic bidder
              </h2>
              <p className="mt-1 text-sm text-foreground">
                Member {active.originalBidderId} is now the only Worker-accepted synthetic
                resolution target.
              </p>
              <OutcomeFields
                prefix="original"
                outcome={originalOutcome}
                setOutcome={setOriginalOutcome}
                releaseReason={originalReleaseReason}
                setReleaseReason={setOriginalReleaseReason}
                awardReference={originalAwardReference}
                setAwardReference={setOriginalAwardReference}
                resetKey={() => resetActionKey('original')}
              />
              <ReasonAndSubmit
                name="original_reason"
                value={originalReason}
                onChange={(value) => {
                  setOriginalReason(value);
                  resetActionKey('original');
                }}
                commandId={commandIds.original ?? null}
                busy={busy === 'original'}
                label="Resolve original synthetic bidder"
              />
            </form>
          )}

          {active?.phase === 'awaiting_resume' && (
            <form
              data-testid="specialty-resume-form"
              onSubmit={resumeNormalTurn}
              className="rounded-xl border border-success/40 bg-success-surface p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-success">
                Synthetic continuation
              </p>
              <h2 className="mt-1 font-heading text-xl text-foreground">
                Resume normal Bid turn in synthetic state
              </h2>
              <p className="mt-1 text-sm text-success">
                The Worker rechecks the captured normal turn before resuming. This does not resume
                an official or live Bid.
              </p>
              <ReasonAndSubmit
                name="resume_reason"
                value={resumeReason}
                onChange={(value) => {
                  setResumeReason(value);
                  resetActionKey('resume');
                }}
                commandId={commandIds.resume ?? null}
                busy={busy === 'resume'}
                label="Resume synthetic normal turn"
                tone="emerald"
              />
            </form>
          )}

          {receipts.length > 0 && (
            <section
              className="rounded-xl border border-border bg-card p-5"
              aria-labelledby="specialty-receipts-heading"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-info">
                Rehearsal evidence
              </p>
              <h2
                id="specialty-receipts-heading"
                className="mt-1 font-heading text-xl text-foreground"
              >
                Synthetic command receipts
              </h2>
              <p className="mt-1 text-sm text-foreground">
                These are the exact Worker receipt payloads returned in this browser session; they
                are not a canonical audit export.
              </p>
              <div className="mt-4 space-y-3">
                {receipts.map((receipt) => (
                  <details
                    key={receiptKey(receipt)}
                    className="rounded border border-border bg-card p-3"
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-foreground">
                      {receiptTitle(receipt)}
                    </summary>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Command ID</dt>
                        <dd className="mt-1 break-all font-mono text-xs text-foreground">
                          {receipt.commandId ?? 'Not returned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Origin</dt>
                        <dd className="mt-1 font-mono text-xs text-foreground">
                          {receipt.origin ?? 'Not returned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Operation</dt>
                        <dd className="mt-1 text-foreground">
                          {receipt.operation ?? 'Not returned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Replay</dt>
                        <dd className="mt-1 text-foreground">{receipt.replayed ? 'Yes' : 'No'}</dd>
                      </div>
                    </dl>
                    {receipt.reason !== null && (
                      <p className="mt-3 text-sm text-foreground">Reason: {receipt.reason}</p>
                    )}
                    <pre className="mt-3 overflow-x-auto rounded bg-card p-3 text-xs leading-5 text-foreground">
                      {JSON.stringify(receipt.raw, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}

interface OutcomeFieldsProps {
  prefix: 'candidate' | 'original';
  outcome: 'award' | 'release';
  setOutcome: (value: 'award' | 'release') => void;
  releaseReason: ReleaseReason;
  setReleaseReason: (value: ReleaseReason) => void;
  awardReference: string;
  setAwardReference: (value: string) => void;
  resetKey: () => void;
}

function OutcomeFields({
  prefix,
  outcome,
  setOutcome,
  releaseReason,
  setReleaseReason,
  awardReference,
  setAwardReference,
  resetKey,
}: OutcomeFieldsProps) {
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <Label className="block">
        <span className="text-sm font-medium text-foreground">Synthetic outcome</span>
        <NativeSelect
          name={`${prefix}_outcome_kind`}
          value={outcome}
          onChange={(event) => {
            setOutcome(event.target.value as 'award' | 'release');
            resetKey();
          }}
          className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground"
        >
          <option value="release">Release candidate</option>
          <option value="award">Award candidate</option>
        </NativeSelect>
      </Label>
      {outcome === 'award' ? (
        <Label className="block">
          <span className="text-sm font-medium text-foreground">Synthetic award reference</span>
          <Input
            name={`${prefix}_award_reference`}
            required
            maxLength={160}
            value={awardReference}
            onChange={(event) => {
              setAwardReference(event.target.value);
              resetKey();
            }}
            placeholder="synthetic-award-reference"
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground"
          />
        </Label>
      ) : (
        <Label className="block">
          <span className="text-sm font-medium text-foreground">Synthetic release reason</span>
          <NativeSelect
            name={`${prefix}_release_reason`}
            value={releaseReason}
            onChange={(event) => {
              setReleaseReason(event.target.value as ReleaseReason);
              resetKey();
            }}
            className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="declined">Declined</option>
            <option value="unreachable">Unreachable</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="ineligible_on_recheck">Ineligible on recheck</option>
          </NativeSelect>
        </Label>
      )}
    </div>
  );
}

interface ReasonAndSubmitProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  commandId: string | null;
  busy: boolean;
  label: string;
  tone?: 'amber' | 'emerald';
}

function ReasonAndSubmit({
  name,
  value,
  onChange,
  commandId,
  busy,
  label,
  tone = 'amber',
}: ReasonAndSubmitProps) {
  const buttonClass =
    tone === 'emerald' ? 'bg-success hover:bg-success' : 'bg-warning hover:bg-warning';
  return (
    <div className="mt-5">
      <Label className="block">
        <span className="text-sm font-medium text-foreground">Operator reason</span>
        <Textarea
          name={name}
          required
          minLength={4}
          maxLength={500}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Record the observed synthetic outcome and why it is being recorded."
          className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </Label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={busy}
          className={`min-h-11 rounded px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${buttonClass}`}
        >
          {busy ? 'Submitting synthetic command…' : label}
        </Button>
        <span className="max-w-xl text-xs text-muted-foreground">
          Idempotency key: <span className="font-mono">{commandKeyLabel(commandId)}</span>
        </span>
      </div>
    </div>
  );
}
