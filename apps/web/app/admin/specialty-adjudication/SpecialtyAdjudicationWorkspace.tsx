'use client';

import { type FormEvent, useMemo, useState } from 'react';

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
const TEST_POLICY_NORMAL_BID_INTERRUPTION = 'SUSPEND_EXACT_NORMAL_TURN' as const;
const TEST_POLICY_ORIGINAL_BIDDER_RESUME = 'RESUME_EXACT_ORIGINAL_TURN' as const;
const TEST_POLICY_CANDIDATE_OUTCOMES = ['award', 'declined', 'unavailable'] as const;
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
  qualification_requirements: string[];
  ranking: { source: typeof TEST_POLICY_RANKING_SOURCE; reference: string };
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
  if (state === null || !Array.isArray(response.audit_receipts)) return null;
  const receipts = response.audit_receipts.map((receipt) => parseReceipt(receipt)).filter(Boolean);
  return {
    state,
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
  qualificationRequirements: string;
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
  const qualificationRequirements = lineItems(input.qualificationRequirements);
  if (qualificationRequirements.length === 0 || qualificationRequirements.length > 30) {
    return {
      ok: false,
      error: 'Provide 1–30 unique synthetic qualification requirements, one per line.',
    };
  }
  if (qualificationRequirements.some((requirement) => requirement.length > 160)) {
    return {
      ok: false,
      error: 'Each synthetic qualification requirement must be 160 characters or less.',
    };
  }
  if (new Set(qualificationRequirements).size !== qualificationRequirements.length) {
    return { ok: false, error: 'Synthetic qualification requirements must be unique.' };
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
  return {
    ok: true,
    policy: {
      policy_label: SPECIALTY_TEST_POLICY_LABEL,
      policy_version: policyVersion,
      specialty_pool: { id: poolId, label: poolLabel },
      qualification_requirements: qualificationRequirements,
      ranking: { source: TEST_POLICY_RANKING_SOURCE, reference: rankingReference },
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
  | { ok: true; candidates: Array<{ member_id: number; priority_rank: number }> }
  | { ok: false; error: string } {
  const rows = value
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length === 0)
    return { ok: false, error: 'At least one synthetic candidate is required.' };
  const candidates: Array<{ member_id: number; priority_rank: number }> = [];
  const memberIds = new Set<number>();
  const priorityRanks = new Set<number>();
  for (const row of rows) {
    const parts = row.split(/[,:\s]+/).filter(Boolean);
    if (parts.length !== 2) {
      return {
        ok: false,
        error: 'Each synthetic candidate must use exactly “member ID, priority rank”.',
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
        error: 'Candidate member IDs must be positive integers and ranks must be zero or greater.',
      };
    }
    if (memberIds.has(memberId) || priorityRanks.has(priorityRank)) {
      return {
        ok: false,
        error: 'Synthetic candidates must not repeat a member ID or priority rank.',
      };
    }
    memberIds.add(memberId);
    priorityRanks.add(priorityRank);
    candidates.push({ member_id: memberId, priority_rank: priorityRank });
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
export function SpecialtyAdjudicationWorkspace() {
  const [sessionId, setSessionId] = useState('');
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpecialtyStatus | null>(null);
  const [receipts, setReceipts] = useState<SpecialtyReceipt[]>([]);
  const [positionId, setPositionId] = useState('');
  const [originalMemberId, setOriginalMemberId] = useState('');
  const [candidateRowsText, setCandidateRowsText] = useState('');
  const [policyReference, setPolicyReference] = useState('synthetic-specialty-fixture-v1');
  const [testPolicyVersion, setTestPolicyVersion] = useState('synthetic-specialty-v1');
  const [testPolicyPoolId, setTestPolicyPoolId] = useState('MARINE_TEST_POOL');
  const [testPolicyPoolLabel, setTestPolicyPoolLabel] = useState(
    'Marine Operations synthetic test pool',
  );
  const [testPolicyQualificationRequirements, setTestPolicyQualificationRequirements] = useState(
    'Marine Operations\nDriver Operator',
  );
  const [testPolicyRankingReference, setTestPolicyRankingReference] = useState(
    'synthetic-specialty-ranking-v1',
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

  const trimmedSessionId = sessionId.trim();
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

  function clearLoadedState() {
    setLoadedSessionId(null);
    setStatus(null);
    setReceipts([]);
    setError(null);
    setNotice(null);
    setCommandIds({});
    setBeginRequestId(null);
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
    const originalId = Number(originalMemberId);
    if (!Number.isSafeInteger(originalId) || originalId <= 0) {
      setError('Enter the original normal-bidder member ID as a positive integer.');
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
    if (
      !normalizedCandidateRows.candidates.some((candidate) => candidate.member_id === originalId)
    ) {
      setError('The original normal bidder must appear in the synthetic candidate list.');
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
      qualificationRequirements: testPolicyQualificationRequirements,
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
        request_id: requestId,
        position_id: positionId.trim(),
        policy: {
          source: 'synthetic',
          policy_reference: trimmedReference,
          test_policy: testPolicy.policy,
          candidate_release_policy: { status: 'configured', on_release: releasePolicy },
          candidates: normalizedCandidateRows.candidates.map((candidate) => ({
            ...candidate,
            general_eligibility: { status: 'eligible' },
            specialty_eligibility: { status: 'eligible' },
          })),
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
      <header className="border-b border-slate-800 pb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
          Mock-bid interruption rehearsal
        </p>
        <h1 id="specialty-adjudication-heading" className="mt-1 font-heading text-3xl text-white">
          Specialty adjudication rehearsal
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Inspect and exercise one labelled synthetic interruption against an existing frozen mock
          session. The Worker owns the ordered state machine and the idempotent receipts.
        </p>
      </header>

      <section
        className="rounded-xl border border-amber-700 bg-amber-950/30 p-5 text-sm text-amber-100"
        aria-labelledby="specialty-boundary-heading"
      >
        <h2 id="specialty-boundary-heading" className="font-semibold text-amber-50">
          Synthetic test only
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-100/90">
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
        className="rounded-xl border border-slate-700 bg-slate-800/40 p-5"
      >
        <div className="flex flex-wrap items-end gap-4">
          <label className="block min-w-72 flex-1">
            <span className="text-sm font-medium text-slate-200">Mock Bid session ID</span>
            <input
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
              className="mt-1 block min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-500"
            />
          </label>
          <button
            type="submit"
            disabled={busy !== null || trimmedSessionId.length === 0}
            className="min-h-11 rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'inspect' ? 'Inspecting…' : 'Inspect specialty state'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Inspection is read-only. After a valid empty mock state loads, you can begin labelled
          synthetic scenario. A Worker rejection is shown verbatim below and never converted into an
          official-policy fallback.
        </p>
      </form>

      {error !== null && (
        <p
          role="alert"
          className="rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-100"
        >
          {error}
        </p>
      )}
      {notice !== null && (
        <p
          aria-live="polite"
          className="rounded border border-sky-800 bg-sky-950/30 px-4 py-3 text-sm text-sky-100"
        >
          {notice}
        </p>
      )}

      {stateLoaded && state !== null && (
        <>
          <section
            className="rounded-xl border border-slate-700 bg-slate-800/40 p-5"
            aria-labelledby="specialty-state-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
                  Worker-owned state
                </p>
                <h2 id="specialty-state-heading" className="mt-1 font-heading text-xl text-white">
                  Specialty interruption state
                </h2>
              </div>
              <span className="rounded-full border border-slate-600 px-3 py-1 font-mono text-xs font-semibold text-slate-200">
                Revision {state.revision}
              </span>
            </div>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-slate-400">Mode</dt>
                <dd className="mt-1 font-medium text-white">Synthetic test only</dd>
              </div>
              <div>
                <dt className="text-slate-400">Bid commit</dt>
                <dd className="mt-1 font-medium text-white">Not committed</dd>
              </div>
              <div>
                <dt className="text-slate-400">Database audit</dt>
                <dd className="mt-1 font-medium text-white">
                  {status?.databaseAuditLog ?? 'Not reported'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Active interruption</dt>
                <dd className="mt-1 font-medium text-white">
                  {active === null ? 'None' : active.phase.replaceAll('_', ' ')}
                </dd>
              </div>
            </dl>

            {active !== null && (
              <div className="mt-5 rounded-lg border border-amber-800/80 bg-amber-950/20 p-4 text-sm text-amber-50">
                <p className="font-semibold">Synthetic interruption is active</p>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-amber-200/80">Request</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{active.requestId}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-200/80">Position</dt>
                    <dd className="mt-1 font-mono text-xs">{active.positionId}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-200/80">Original bidder</dt>
                    <dd className="mt-1 font-medium">Member {active.originalBidderId}</dd>
                  </div>
                  <div>
                    <dt className="text-amber-200/80">Policy label</dt>
                    <dd className="mt-1 break-all font-mono text-xs">{active.policyReference}</dd>
                  </div>
                </dl>
                {nextCandidate !== null && (
                  <p className="mt-3 text-amber-100">
                    Next eligible synthetic candidate: member {nextCandidate.memberId}, priority{' '}
                    {nextCandidate.priorityRank}.
                  </p>
                )}
              </div>
            )}
            {active === null && receipts.some((receipt) => receipt.operation === 'resume') && (
              <p className="mt-4 rounded border border-emerald-800 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-100">
                Normal Bid turn resumed in synthetic state. Confirm actual Bid/operator acceptance
                separately; this receipt is not a live-Bid completion claim.
              </p>
            )}
          </section>

          {active === null && (
            <form
              data-testid="specialty-begin-form"
              onSubmit={beginScenario}
              className="rounded-xl border border-slate-700 bg-slate-800/40 p-5"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                  Controlled fixture
                </p>
                <h2 className="mt-1 font-heading text-xl text-white">
                  Begin labelled synthetic scenario
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-slate-300">
                  Candidate rank and eligibility here are synthetic test inputs only. The Worker
                  independently requires a frozen mock session and rejects candidates outside its
                  frozen bid pool.
                </p>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">Biddable position ID</span>
                  <input
                    name="position_id"
                    required
                    maxLength={160}
                    value={positionId}
                    onChange={(event) => {
                      setPositionId(event.target.value);
                      resetBeginKey();
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">
                    Original normal-bidder member ID
                  </span>
                  <input
                    name="original_member_id"
                    required
                    inputMode="numeric"
                    value={originalMemberId}
                    onChange={(event) => {
                      setOriginalMemberId(event.target.value);
                      resetBeginKey();
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">
                    Synthetic scenario reference
                  </span>
                  <input
                    name="policy_reference"
                    required
                    maxLength={160}
                    value={policyReference}
                    onChange={(event) => {
                      setPolicyReference(event.target.value);
                      resetBeginKey();
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white"
                  />
                  <span className="mt-1 block text-xs text-slate-400">
                    Must start with synthetic-. It binds the mock-only route contract and is not an
                    approved policy reference.
                  </span>
                </label>
                <fieldset className="rounded-lg border border-amber-800/80 bg-amber-950/20 p-4 lg:col-span-2">
                  <legend className="px-1 text-sm font-semibold text-amber-100">
                    Typed synthetic test-policy envelope
                  </legend>
                  <p className="mt-1 max-w-3xl text-sm text-amber-100/90">
                    This complete envelope is sent only to the mock specialty route. It is
                    explicitly versioned and never substitutes for approved MBFD specialty policy.
                  </p>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="block lg:col-span-2">
                      <span className="text-sm font-medium text-slate-100">Test policy label</span>
                      <input
                        name="test_policy_label"
                        readOnly
                        value={SPECIALTY_TEST_POLICY_LABEL}
                        className="mt-1 min-h-11 w-full rounded border border-amber-700 bg-slate-950 px-3 font-mono text-sm text-amber-100"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-100">Policy version</span>
                      <input
                        name="test_policy_version"
                        required
                        maxLength={160}
                        value={testPolicyVersion}
                        onChange={(event) => {
                          setTestPolicyVersion(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-100">Specialty pool ID</span>
                      <input
                        name="test_policy_pool_id"
                        required
                        maxLength={160}
                        value={testPolicyPoolId}
                        onChange={(event) => {
                          setTestPolicyPoolId(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="text-sm font-medium text-slate-100">
                        Specialty pool label
                      </span>
                      <input
                        name="test_policy_pool_label"
                        required
                        maxLength={200}
                        value={testPolicyPoolLabel}
                        onChange={(event) => {
                          setTestPolicyPoolLabel(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white"
                      />
                    </label>
                    <label className="block lg:col-span-2">
                      <span className="text-sm font-medium text-slate-100">
                        Qualification requirements
                      </span>
                      <textarea
                        name="test_policy_qualification_requirements"
                        required
                        rows={3}
                        maxLength={5000}
                        value={testPolicyQualificationRequirements}
                        onChange={(event) => {
                          setTestPolicyQualificationRequirements(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
                      />
                      <span className="mt-1 block text-xs text-slate-400">
                        One synthetic requirement per line (1–30 unique entries). This fixture does
                        not infer member credential records.
                      </span>
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-100">
                        Explicit test ranking source
                      </span>
                      <input
                        name="test_policy_ranking_source"
                        readOnly
                        value={TEST_POLICY_RANKING_SOURCE}
                        className="mt-1 min-h-11 w-full rounded border border-amber-700 bg-slate-950 px-3 font-mono text-sm text-amber-100"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium text-slate-100">
                        Explicit test ranking reference
                      </span>
                      <input
                        name="test_policy_ranking_reference"
                        required
                        maxLength={160}
                        value={testPolicyRankingReference}
                        onChange={(event) => {
                          setTestPolicyRankingReference(event.target.value);
                          resetBeginKey();
                        }}
                        className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white"
                      />
                    </label>
                    <fieldset className="rounded border border-slate-700 p-3 lg:col-span-2">
                      <legend className="px-1 text-sm font-medium text-slate-100">
                        Tie-break chain
                      </legend>
                      <p className="mt-1 text-xs text-slate-400">
                        Configure two or three unique synthetic tie-breaks in order.
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <label className="block">
                          <span className="text-xs text-slate-300">First</span>
                          <select
                            name="test_policy_tie_break_1"
                            value={testPolicyTieBreakOne}
                            onChange={(event) => {
                              setTestPolicyTieBreakOne(event.target.value as TestPolicyTieBreak);
                              resetBeginKey();
                            }}
                            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white"
                          >
                            {TEST_POLICY_TIE_BREAKS.map((tieBreak) => (
                              <option key={tieBreak} value={tieBreak}>
                                {TEST_POLICY_TIE_BREAK_LABELS[tieBreak]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs text-slate-300">Second</span>
                          <select
                            name="test_policy_tie_break_2"
                            value={testPolicyTieBreakTwo}
                            onChange={(event) => {
                              setTestPolicyTieBreakTwo(event.target.value as TestPolicyTieBreak);
                              resetBeginKey();
                            }}
                            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white"
                          >
                            {TEST_POLICY_TIE_BREAKS.map((tieBreak) => (
                              <option key={tieBreak} value={tieBreak}>
                                {TEST_POLICY_TIE_BREAK_LABELS[tieBreak]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-xs text-slate-300">Third (optional)</span>
                          <select
                            name="test_policy_tie_break_3"
                            value={testPolicyTieBreakThree}
                            onChange={(event) => {
                              setTestPolicyTieBreakThree(
                                event.target.value as TestPolicyTieBreak | '',
                              );
                              resetBeginKey();
                            }}
                            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white"
                          >
                            <option value="">No third tie-break</option>
                            {TEST_POLICY_TIE_BREAKS.map((tieBreak) => (
                              <option key={tieBreak} value={tieBreak}>
                                {TEST_POLICY_TIE_BREAK_LABELS[tieBreak]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </fieldset>
                    <dl className="grid gap-3 rounded border border-slate-700 bg-slate-950/40 p-3 text-sm lg:col-span-2 sm:grid-cols-3">
                      <div>
                        <dt className="text-slate-400">Normal Bid interruption</dt>
                        <dd className="mt-1 font-mono text-xs text-amber-100">
                          {TEST_POLICY_NORMAL_BID_INTERRUPTION}
                        </dd>
                        <dd className="mt-1 text-xs text-slate-300">
                          Suspend exact normal Bid turn
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Allowed candidate outcomes</dt>
                        <dd className="mt-1 font-mono text-xs text-amber-100">
                          {TEST_POLICY_CANDIDATE_OUTCOMES.join(' · ')}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Original-bidder resumption</dt>
                        <dd className="mt-1 font-mono text-xs text-emerald-100">
                          {TEST_POLICY_ORIGINAL_BIDDER_RESUME}
                        </dd>
                        <dd className="mt-1 text-xs text-slate-300">
                          Resume exact original Bid turn
                        </dd>
                      </div>
                    </dl>
                  </div>
                </fieldset>
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">
                    Released-candidate behavior
                  </span>
                  <select
                    name="release_policy"
                    value={releasePolicy}
                    onChange={(event) => {
                      setReleasePolicy(event.target.value as typeof releasePolicy);
                      resetBeginKey();
                    }}
                    className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white"
                  >
                    <option value="continue_to_next_higher_priority">
                      Continue to next higher-priority synthetic candidate
                    </option>
                    <option value="return_to_original_bidder">
                      Return to original synthetic bidder
                    </option>
                  </select>
                </label>
                <label className="block lg:col-span-2">
                  <span className="text-sm font-medium text-slate-200">Synthetic candidates</span>
                  <textarea
                    name="candidate_rows"
                    required
                    rows={4}
                    value={candidateRowsText}
                    onChange={(event) => {
                      setCandidateRowsText(event.target.value);
                      resetBeginKey();
                    }}
                    placeholder={'One candidate per line: member ID, priority rank\n11, 1\n17, 2'}
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 font-mono text-sm text-white placeholder:text-slate-500"
                  />
                  <span className="mt-1 block text-xs text-slate-400">
                    All rows are marked synthetic eligible. Include the original bidder exactly
                    once.
                  </span>
                </label>
                <label className="block lg:col-span-2">
                  <span className="text-sm font-medium text-slate-200">Operator reason</span>
                  <textarea
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
                    className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500"
                  />
                </label>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="min-h-11 rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'begin' ? 'Beginning synthetic scenario…' : 'Begin synthetic scenario'}
                </button>
                <span className="max-w-xl text-xs text-slate-400">
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
              className="rounded-xl border border-slate-700 bg-slate-800/40 p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                Ordered candidate resolution
              </p>
              <h2 className="mt-1 font-heading text-xl text-white">
                Resolve next synthetic candidate
              </h2>
              <p className="mt-1 text-sm text-slate-300">
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
              className="rounded-xl border border-slate-700 bg-slate-800/40 p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                Original bidder resolution
              </p>
              <h2 className="mt-1 font-heading text-xl text-white">
                Resolve original synthetic bidder
              </h2>
              <p className="mt-1 text-sm text-slate-300">
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
              className="rounded-xl border border-emerald-800 bg-emerald-950/20 p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Synthetic continuation
              </p>
              <h2 className="mt-1 font-heading text-xl text-white">
                Resume normal Bid turn in synthetic state
              </h2>
              <p className="mt-1 text-sm text-emerald-100/90">
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
              className="rounded-xl border border-slate-700 bg-slate-800/40 p-5"
              aria-labelledby="specialty-receipts-heading"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
                Rehearsal evidence
              </p>
              <h2 id="specialty-receipts-heading" className="mt-1 font-heading text-xl text-white">
                Synthetic command receipts
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                These are the exact Worker receipt payloads returned in this browser session; they
                are not a canonical audit export.
              </p>
              <div className="mt-4 space-y-3">
                {receipts.map((receipt) => (
                  <details
                    key={receiptKey(receipt)}
                    className="rounded border border-slate-700 bg-slate-950/40 p-3"
                  >
                    <summary className="cursor-pointer text-sm font-semibold text-slate-100">
                      {receiptTitle(receipt)}
                    </summary>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-slate-400">Command ID</dt>
                        <dd className="mt-1 break-all font-mono text-xs text-slate-100">
                          {receipt.commandId ?? 'Not returned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Origin</dt>
                        <dd className="mt-1 font-mono text-xs text-slate-100">
                          {receipt.origin ?? 'Not returned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Operation</dt>
                        <dd className="mt-1 text-slate-100">
                          {receipt.operation ?? 'Not returned'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Replay</dt>
                        <dd className="mt-1 text-slate-100">{receipt.replayed ? 'Yes' : 'No'}</dd>
                      </div>
                    </dl>
                    {receipt.reason !== null && (
                      <p className="mt-3 text-sm text-slate-300">Reason: {receipt.reason}</p>
                    )}
                    <pre className="mt-3 overflow-x-auto rounded bg-slate-950 p-3 text-xs leading-5 text-slate-300">
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
      <label className="block">
        <span className="text-sm font-medium text-slate-200">Synthetic outcome</span>
        <select
          name={`${prefix}_outcome_kind`}
          value={outcome}
          onChange={(event) => {
            setOutcome(event.target.value as 'award' | 'release');
            resetKey();
          }}
          className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white"
        >
          <option value="release">Release candidate</option>
          <option value="award">Award candidate</option>
        </select>
      </label>
      {outcome === 'award' ? (
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Synthetic award reference</span>
          <input
            name={`${prefix}_award_reference`}
            required
            maxLength={160}
            value={awardReference}
            onChange={(event) => {
              setAwardReference(event.target.value);
              resetKey();
            }}
            placeholder="synthetic-award-reference"
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 font-mono text-sm text-white placeholder:text-slate-500"
          />
        </label>
      ) : (
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Synthetic release reason</span>
          <select
            name={`${prefix}_release_reason`}
            value={releaseReason}
            onChange={(event) => {
              setReleaseReason(event.target.value as ReleaseReason);
              resetKey();
            }}
            className="mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 px-3 text-sm text-white"
          >
            <option value="declined">Declined</option>
            <option value="unreachable">Unreachable</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="ineligible_on_recheck">Ineligible on recheck</option>
          </select>
        </label>
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
    tone === 'emerald' ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-amber-600 hover:bg-amber-500';
  return (
    <div className="mt-5">
      <label className="block">
        <span className="text-sm font-medium text-slate-200">Operator reason</span>
        <textarea
          name={name}
          required
          minLength={4}
          maxLength={500}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Record the observed synthetic outcome and why it is being recorded."
          className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className={`min-h-11 rounded px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${buttonClass}`}
        >
          {busy ? 'Submitting synthetic command…' : label}
        </button>
        <span className="max-w-xl text-xs text-slate-400">
          Idempotency key: <span className="font-mono">{commandKeyLabel(commandId)}</span>
        </span>
      </div>
    </div>
  );
}
