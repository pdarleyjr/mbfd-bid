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
  readonly version: 1;
  readonly commandId: string;
  readonly operation: 'begin' | 'resolve_candidate' | 'resolve_original' | 'resume';
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
