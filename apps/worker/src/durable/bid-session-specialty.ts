import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import {
  type BeginSpecialtyAdjudicationResult,
  type ResolveOriginalSpecialtyRequestInput,
  type ResolveOriginalSpecialtyRequestResult,
  type ResolveSpecialtyCandidateInput,
  type ResolveSpecialtyCandidateResult,
  type ResumeSpecialtyAdjudicationInput,
  type ResumeSpecialtyAdjudicationResult,
  type SpecialtyAdjudicationRequest,
  type SpecialtyAdjudicationState,
  type SpecialtyAuditEvent,
  beginSpecialtyAdjudication,
  createSpecialtyAdjudicationState,
  resolveOriginalSpecialtyRequest,
  resolveSpecialtyCandidate,
  resumeSpecialtyAdjudication,
} from '../lib/specialty-adjudication.js';

/** The minimal Durable Object storage surface needed by the specialty adapter. */
export interface SpecialtyDOStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export type SpecialtyCommandOperation =
  | 'begin'
  | 'resolve_candidate'
  | 'resolve_original'
  | 'resume';

/**
 * A command ID names one immutable synthetic specialty command. It must never
 * be re-used for altered payloads, audit metadata, or another operation.
 */
export const SPECIALTY_COMMAND_ID_REUSE_CONFLICT = 'SPECIALTY_COMMAND_ID_REUSE_CONFLICT';

const SPECIALTY_COMMAND_FINGERPRINT_VERSION = 1;

/**
 * Kept separate from the central BidSessionState key so the adapter can be
 * introduced and recovered without changing the existing session state shape.
 */
export function bidSessionSpecialtyStorageKey(bidSessionId: string): string {
  return `bs:${bidSessionId}:specialty-adjudication`;
}

/**
 * Accepted specialty commands retain their own receipt so an operator retry
 * can return the original deterministic result without re-running a command.
 * The prefix is intentionally separate from the active state key: a completed
 * interruption still needs an auditable, reconnect-safe history.
 */
export function bidSessionSpecialtyReceiptPrefix(bidSessionId: string): string {
  return `bs:${bidSessionId}:specialty-adjudication:receipt:`;
}

export function bidSessionSpecialtyReceiptStorageKey(
  bidSessionId: string,
  commandId: string,
): string {
  return `${bidSessionSpecialtyReceiptPrefix(bidSessionId)}${encodeURIComponent(commandId)}`;
}

/**
 * Hash the normalized, parsed specialty transport command with RFC 8785-style
 * canonical JSON. Object insertion order can therefore never change replay
 * semantics, while array order remains part of the command because it can be
 * meaningful to a policy payload.
 */
export function specialtyCommandReceiptFingerprint(
  operation: SpecialtyCommandOperation,
  payload: unknown,
): string {
  const canonicalPayload = canonicalize({
    fingerprintVersion: SPECIALTY_COMMAND_FINGERPRINT_VERSION,
    operation,
    payload: payload as JsonValue,
  });
  return `sha256:${bytesToHex(sha256(new TextEncoder().encode(canonicalPayload)))}`;
}

/**
 * Reads a JSON-safe engine snapshot. A missing value is the only defaultable
 * case: a present-but-invalid value is intentionally passed to the engine so
 * it fails closed with INVALID_STATE instead of forgetting an interruption.
 */
export async function loadBidSessionSpecialtyState(
  storage: SpecialtyDOStorageLike,
  bidSessionId: string,
): Promise<SpecialtyAdjudicationState> {
  const persisted = await storage.get<SpecialtyAdjudicationState>(
    bidSessionSpecialtyStorageKey(bidSessionId),
  );
  return persisted ?? createSpecialtyAdjudicationState();
}

export type SpecialtyEngineTransitionResult =
  | BeginSpecialtyAdjudicationResult
  | ResolveSpecialtyCandidateResult
  | ResolveOriginalSpecialtyRequestResult
  | ResumeSpecialtyAdjudicationResult;

export type AcceptedSpecialtyEngineTransitionResult = Exclude<
  SpecialtyEngineTransitionResult,
  { readonly kind: 'rejected' }
>;

/**
 * This is deliberately durable-object-only evidence for a synthetic rehearsal.
 * It is not a replacement for the D1/R2 canonical audit chain required for a
 * real Bid award. The caller writes the receipt atomically with the state
 * transition in its Durable Object transaction.
 */
export interface SpecialtyCommandReceipt {
  readonly version: 2;
  readonly commandId: string;
  readonly operation: 'begin' | 'resolve_candidate' | 'resolve_original' | 'resume';
  /** SHA-256 of the canonical operation, parsed command payload, and audit metadata. */
  readonly commandFingerprint: string;
  readonly acceptedAtMs: number;
  readonly actorType: 'admin';
  readonly actorId: number;
  readonly reason: string;
  readonly effectiveDate: null;
  readonly origin: 'synthetic_specialty_test';
  readonly beforeState: SpecialtyAdjudicationState;
  readonly afterState: SpecialtyAdjudicationState;
  readonly events: readonly SpecialtyAuditEvent[];
  readonly result: AcceptedSpecialtyEngineTransitionResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * V1 receipts predate payload fingerprints. They are deliberately not
 * replayable because their stored result cannot prove it belongs to the
 * caller's current operation/payload/audit tuple.
 */
export function isVerifiedSpecialtyCommandReplay(
  receipt: unknown,
  commandId: string,
  operation: SpecialtyCommandOperation,
  commandFingerprint: string,
): receipt is SpecialtyCommandReceipt {
  if (!isRecord(receipt)) return false;
  return (
    receipt.version === 2 &&
    receipt.commandId === commandId &&
    receipt.operation === operation &&
    receipt.commandFingerprint === commandFingerprint &&
    isRecord(receipt.beforeState) &&
    isRecord(receipt.afterState) &&
    isRecord(receipt.result) &&
    Array.isArray(receipt.events)
  );
}

/**
 * Serializes a single session's specialty commands around a fresh durable
 * state read. It deliberately does not write audit records; callers receive
 * the engine events and can include them in their owning transaction.
 */
export class BidSessionSpecialtyAdapter {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: SpecialtyDOStorageLike,
    private readonly bidSessionId: string,
  ) {}

  /** A queued read observes every accepted command submitted before it. */
  load(): Promise<SpecialtyAdjudicationState> {
    return this.enqueue(() => loadBidSessionSpecialtyState(this.storage, this.bidSessionId));
  }

  begin(input: SpecialtyAdjudicationRequest): Promise<BeginSpecialtyAdjudicationResult> {
    return this.apply((state) => beginSpecialtyAdjudication(state, input));
  }

  resolveCandidate(
    input: ResolveSpecialtyCandidateInput,
  ): Promise<ResolveSpecialtyCandidateResult> {
    return this.apply((state) => resolveSpecialtyCandidate(state, input));
  }

  resolveOriginal(
    input: ResolveOriginalSpecialtyRequestInput,
  ): Promise<ResolveOriginalSpecialtyRequestResult> {
    return this.apply((state) => resolveOriginalSpecialtyRequest(state, input));
  }

  resume(input: ResumeSpecialtyAdjudicationInput): Promise<ResumeSpecialtyAdjudicationResult> {
    return this.apply((state) => resumeSpecialtyAdjudication(state, input));
  }

  private apply<T extends SpecialtyEngineTransitionResult>(
    transition: (state: SpecialtyAdjudicationState) => T,
  ): Promise<T> {
    return this.enqueue(async () => {
      const state = await loadBidSessionSpecialtyState(this.storage, this.bidSessionId);
      const result = transition(state);
      if (result.kind !== 'rejected') {
        await this.storage.put(bidSessionSpecialtyStorageKey(this.bidSessionId), result.state);
      }
      return result;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    // A storage error must reject its caller but may not permanently poison
    // later commands; each later command gets a fresh state read.
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
