import { evaluateEligibility } from '@mbfd/eligibility';
import {
  type AuditEvent,
  BID_EVENT_VERSION,
  type BidEventEnvelope,
  ClientMessageSchema,
  type MockFreezeCommand,
  type MockFreezeCommandResult,
  MockFreezeCommandSchema,
  type PickRejectedEvent,
  type StateSnapshotEvent,
  type SyntheticSpecialtyStateSignal,
} from '@mbfd/shared';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { z } from 'zod';
import { drainBidAuditOutbox } from '../audit/archive-outbox.js';
import { makeChainDb } from '../audit/chain-db-d1.js';
import { ChainEmitter } from '../audit/chain-emitter.js';
import {
  commitMockFreezeCommand,
  loadCanonicalBidSessionState,
} from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import {
  auditLog,
  bidOrder,
  bidSessions,
  bids,
  members,
  portalWritebackQueue,
  positions,
} from '../db/schema.js';
import {
  type AuditRowDraft,
  auditEntryForForcedPick,
  auditEntryForFreeze,
  auditEntryForPickMade,
  auditEntryForSkip,
} from '../lib/audit.js';
import { computeBidOrder } from '../lib/bid-order.js';
import {
  bidOrderInputFromSnapshot,
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadFrozenSessionBidPolicy,
  resolveFrozenSessionBidTarget,
} from '../lib/bid-policy.js';
import {
  type ResolveOriginalSpecialtyRequestInput,
  type ResolveSpecialtyCandidateInput,
  type ResumeSpecialtyAdjudicationInput,
  type SpecialtyAdjudicationRequest,
  type SpecialtyNormalTurn,
  isValidSpecialtyAdjudicationState,
} from '../lib/specialty-adjudication.js';
import { SpecialtyTestPolicySchema } from '../lib/specialty-test-policy.js';
import {
  type VerifiedWebSocketIdentity,
  parseVerifiedWebSocketIdentity,
} from '../lib/websocket-identity.js';
import { buildPortalPayload } from '../portal-writeback/payload-builder.js';
import { isPortalPublicationEnabled } from '../portal-writeback/publication-policy.js';
import { enqueuePortalWriteback } from '../portal-writeback/queue-producer.js';
import type { WorkerEnv } from '../types/env.js';
import {
  type SubmitADayPickInput,
  type SubmitADayPickResult,
  type TransitionToPhase2Input,
  handleSubmitADayPick,
  transitionToPhase2,
} from './bid-session-aday-handlers.js';
import {
  type ForcePickInput,
  type FreezeInput,
  type HandlerEnv,
  type SkipInput,
  type SubmitPickInput,
  handleForcePick,
  handleFreeze,
  handleSkip,
  handleSubmitPick,
} from './bid-session-handlers.js';
import {
  type AcceptedSpecialtyEngineTransitionResult,
  BidSessionSpecialtyAdapter,
  SPECIALTY_COMMAND_ID_REUSE_CONFLICT,
  type SpecialtyCommandOperation,
  type SpecialtyCommandReceipt,
  type SpecialtyEngineTransitionResult,
  bidSessionSpecialtyReceiptPrefix,
  bidSessionSpecialtyReceiptStorageKey,
  isVerifiedSpecialtyCommandReplay,
  specialtyCommandReceiptFingerprint,
} from './bid-session-specialty.js';
import {
  type BidSessionState,
  type DOStorageLike,
  emptyBidSessionState,
  loadBidSessionState,
  persistBidSessionState,
} from './bid-session-state.js';

interface ConnectedClient {
  socket: WebSocket;
  memberId: number;
  role: 'member' | 'admin';
}

interface IdempotencyRecord {
  envelope: BidEventEnvelope;
}

const SpecialtyOpaqueIdSchema = z.string().trim().min(1).max(160);
const SpecialtyEligibleSchema = z.object({ status: z.literal('eligible') }).strict();
const SpecialtyIneligibleSchema = z
  .object({
    status: z.literal('ineligible'),
    reasonCodes: z.array(SpecialtyOpaqueIdSchema).min(1).max(30),
  })
  .strict();
const SpecialtyEligibilitySchema = z.discriminatedUnion('status', [
  SpecialtyEligibleSchema,
  SpecialtyIneligibleSchema,
]);
const SyntheticSpecialtyPolicySchema = z
  .object({
    policyReference: SpecialtyOpaqueIdSchema.refine(
      (value) => value.toLowerCase().startsWith('synthetic-'),
      'synthetic policy references must be explicitly labelled',
    ),
    source: z.literal('synthetic'),
    testPolicy: SpecialtyTestPolicySchema,
    candidateReleasePolicy: z
      .object({
        status: z.literal('configured'),
        onRelease: z.enum(['continue_to_next_higher_priority', 'return_to_original_bidder']),
      })
      .strict(),
    candidates: z
      .array(
        z
          .object({
            memberId: z.number().int().positive(),
            priorityRank: z.number().int().nonnegative(),
            generalEligibility: SpecialtyEligibilitySchema,
            specialtyEligibility: SpecialtyEligibilitySchema,
          })
          .strict(),
      )
      .min(1)
      .max(250),
  })
  .strict();
const SpecialtyOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('award'), awardReference: SpecialtyOpaqueIdSchema }).strict(),
  z
    .object({
      kind: z.literal('release'),
      reason: z.enum(['declined', 'unreachable', 'withdrawn', 'ineligible_on_recheck']),
    })
    .strict(),
]);
const SpecialtyAuditSchema = z
  .object({
    actorId: z.number().int().nonnegative(),
    reason: z.string().trim().min(4).max(500),
    origin: z.literal('synthetic_specialty_test'),
    effectiveDate: z.null(),
  })
  .strict();
const SpecialtyBeginPayloadSchema = z
  .object({
    command: z
      .object({
        commandId: SpecialtyOpaqueIdSchema,
        expectedRevision: z.number().int().nonnegative(),
        /**
         * Mock rehearsal controls have their own D1 sequence. It is never
         * inferred from canonical DO `lastSeq`, because legacy rehearsal
         * writes intentionally do not create canonical Bid commands.
         */
        expectedNormalControlRevision: z.number().int().nonnegative(),
        requestId: SpecialtyOpaqueIdSchema,
        positionId: SpecialtyOpaqueIdSchema,
        policy: SyntheticSpecialtyPolicySchema,
      })
      .strict(),
    audit: SpecialtyAuditSchema,
  })
  .strict();
const SpecialtyCandidatePayloadSchema = z
  .object({
    command: z
      .object({
        commandId: SpecialtyOpaqueIdSchema,
        expectedRevision: z.number().int().nonnegative(),
        requestId: SpecialtyOpaqueIdSchema,
        memberId: z.number().int().positive(),
        outcome: SpecialtyOutcomeSchema,
      })
      .strict(),
    audit: SpecialtyAuditSchema,
  })
  .strict();
const SpecialtyOriginalPayloadSchema = z
  .object({
    command: z
      .object({
        commandId: SpecialtyOpaqueIdSchema,
        expectedRevision: z.number().int().nonnegative(),
        requestId: SpecialtyOpaqueIdSchema,
        outcome: SpecialtyOutcomeSchema,
      })
      .strict(),
    audit: SpecialtyAuditSchema,
  })
  .strict();
const SpecialtyResumePayloadSchema = z
  .object({
    command: z
      .object({
        commandId: SpecialtyOpaqueIdSchema,
        expectedRevision: z.number().int().nonnegative(),
        requestId: SpecialtyOpaqueIdSchema,
      })
      .strict(),
    audit: SpecialtyAuditSchema,
  })
  .strict();

type SpecialtyBeginPayload = z.infer<typeof SpecialtyBeginPayloadSchema>;
type SpecialtyCandidatePayload = z.infer<typeof SpecialtyCandidatePayloadSchema>;
type SpecialtyOriginalPayload = z.infer<typeof SpecialtyOriginalPayloadSchema>;
type SpecialtyResumePayload = z.infer<typeof SpecialtyResumePayloadSchema>;
type SpecialtyPayload =
  | SpecialtyBeginPayload
  | SpecialtyCandidatePayload
  | SpecialtyOriginalPayload
  | SpecialtyResumePayload;

interface NormalMutationLeaseRecord {
  readonly version: 1;
  readonly leaseId: string;
  readonly acquiredAtMs: number;
}

type NormalMutationLeaseStatus =
  | { readonly kind: 'none' }
  | { readonly kind: 'active'; readonly lease: NormalMutationLeaseRecord }
  | { readonly kind: 'unknown' };

type NormalMutationLeaseAcquireResult =
  | { readonly ok: true; readonly leaseId: string }
  | {
      readonly ok: false;
      readonly error:
        | 'specialty_adjudication_active'
        | 'specialty_adjudication_state_unavailable'
        | 'normal_mutation_lease_active'
        | 'normal_mutation_lease_state_unknown';
    };

type NormalMutationLeaseReleaseResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | 'normal_mutation_lease_state_unknown'
        | 'normal_mutation_lease_not_held'
        | 'normal_mutation_lease_not_owner';
    };

const NormalMutationLeaseReleasePayloadSchema = z
  .object({ lease_id: SpecialtyOpaqueIdSchema })
  .strict();

export function bidSessionNormalMutationLeaseStorageKey(bidSessionId: string): string {
  return `bs:${bidSessionId}:normal-mutation-lease`;
}

function isNormalMutationLeaseRecord(value: unknown): value is NormalMutationLeaseRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    typeof record.leaseId === 'string' &&
    record.leaseId.trim().length > 0 &&
    record.leaseId.length <= 160 &&
    typeof record.acquiredAtMs === 'number' &&
    Number.isSafeInteger(record.acquiredAtMs) &&
    record.acquiredAtMs >= 0
  );
}

type SpecialtyTransportResult =
  | {
      kind: 'accepted';
      idempotentReplay: boolean;
      result: AcceptedSpecialtyEngineTransitionResult;
      receipt: SpecialtyCommandReceipt;
    }
  | {
      kind: 'rejected';
      code: string;
      message: string;
      result: SpecialtyEngineTransitionResult | null;
    };

interface CurrentSpecialtyNormalTurn {
  readonly turn: SpecialtyNormalTurn;
  /** Present only when the turn is derived from a direct mock D1 session. */
  readonly mockControlRevision: number | null;
}

type CanonicalMockIntent = 'pending' | 'active';

type FrozenPoolGuard =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'session_policy_snapshot_missing'
        | 'session_policy_snapshot_invalid'
        | 'session_policy_snapshot_material_missing'
        | 'session_rule_book_invalid'
        | 'session_rule_book_revision_changed'
        | 'session_policy_snapshot_revision_missing'
        | 'member_not_in_bid_pool'
        | 'member_excluded_from_bid_pool'
        | 'bid_order_not_frozen_policy';
    };

type FrozenPhaseOneGuard = FrozenPoolGuard | { ok: false; code: 'position_not_biddable' };

function frozenPolicyRejectionMessage(code: string): string {
  switch (code) {
    case 'position_not_biddable':
      return 'The requested position is not biddable under the frozen session policy.';
    case 'member_not_in_bid_pool':
    case 'member_excluded_from_bid_pool':
      return 'The requested member is not in the frozen Bid pool.';
    default:
      return 'The immutable session policy is unavailable or invalid; the pick was rejected.';
  }
}

export class BidSessionDO implements DurableObject {
  private state: DurableObjectState;
  private env: WorkerEnv;
  private clients = new Map<string, ConnectedClient>();
  private memoryState: BidSessionState | null = null;
  /** Undefined until the private durable marker has been read for this DO instance. */
  private canonicalMockIntent: CanonicalMockIntent | null | undefined = undefined;
  /** Plan 08 — lazy per-DO chain emitter (one per Worker isolate). */
  private emitter: ChainEmitter | null = null;

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state;
    this.env = env;
  }

  private get storage(): DOStorageLike {
    return this.state.storage as unknown as DOStorageLike;
  }

  private namedSessionId(): string {
    return this.state.id.name ?? this.state.id.toString();
  }

  /** Preserve the physical DO storage namespace while D1 stores the named id. */
  private projectCanonicalState(canonicalState: BidSessionState): BidSessionState {
    return { ...canonicalState, bidSessionId: this.state.id.toString() };
  }

  private canonicalMockIntentKey(): string {
    return `canonical-mock-intent:${this.state.id.toString()}`;
  }

  private async canonicalMockIntentState(): Promise<CanonicalMockIntent | null> {
    if (this.canonicalMockIntent === undefined) {
      const marker = await this.storage.get<unknown>(this.canonicalMockIntentKey());
      this.canonicalMockIntent =
        marker === 'pending' || marker === 'active' || marker === true ? 'active' : null;
    }
    return this.canonicalMockIntent;
  }

  private async markCanonicalMockIntent(): Promise<void> {
    await this.storage.put(this.canonicalMockIntentKey(), 'pending');
    this.canonicalMockIntent = 'pending';
  }

  private async activateCanonicalMockIntent(): Promise<void> {
    await this.storage.put(this.canonicalMockIntentKey(), 'active');
    this.canonicalMockIntent = 'active';
  }

  private async clearCanonicalMockIntent(): Promise<void> {
    await this.storage.delete(this.canonicalMockIntentKey());
    this.canonicalMockIntent = null;
  }

  private async getState(): Promise<BidSessionState> {
    if (!this.memoryState) {
      const id = this.state.id.toString();
      const persisted = await loadBidSessionState(this.storage, id);
      this.memoryState = persisted.bidSessionId === id ? persisted : emptyBidSessionState(id);
    }
    if ((await this.canonicalMockIntentState()) === null) return this.memoryState;
    return this.hydrateCanonicalMockState(this.memoryState);
  }

  /**
   * Specialty adjudication deliberately remains a separate, synthetic test
   * state machine until a frozen MBFD specialty policy model exists. Keeping
   * its state out of BidSessionState avoids falsely representing a rehearsal
   * decision as an ordinary committed Bid fill.
   */
  private specialtyNormalTurn(state: BidSessionState): SpecialtyNormalTurn | null {
    if (state.currentPhase !== 'position_bid' || state.currentBidderId === null) return null;
    const entry = state.bidOrder[state.queueCursor];
    if (entry === undefined || entry.memberId !== state.currentBidderId) return null;
    return {
      turnId: `normal:${this.namedSessionId()}:${state.lastSeq}:${entry.ordinal}:${state.queueCursor}:${entry.memberId}`,
      bidderId: entry.memberId,
      ordinal: entry.ordinal,
      queueCursor: state.queueCursor,
    };
  }

  /**
   * Legacy rehearsal commands deliberately mutate D1 rather than canonical
   * DO state. For a mock session, D1 is therefore the only authoritative
   * source for the normal turn that a synthetic specialty interruption may
   * suspend or later resume. A missing/corrupt D1 turn fails closed instead
   * of falling back to an unrelated empty or stale DO snapshot.
   */
  private async currentSpecialtyNormalTurn(): Promise<CurrentSpecialtyNormalTurn | null> {
    let session:
      | {
          isMock: boolean;
          currentPhase: string;
          currentBidderId: number | null;
          mockControlRevision: number;
        }
      | undefined;
    try {
      session = await getDb(this.env.DB)
        .select({
          isMock: bidSessions.isMock,
          currentPhase: bidSessions.currentPhase,
          currentBidderId: bidSessions.currentBidderId,
          mockControlRevision: bidSessions.mockControlRevision,
        })
        .from(bidSessions)
        .where(eq(bidSessions.id, this.namedSessionId()))
        .get();
    } catch {
      return null;
    }

    if (session?.isMock) {
      if (session.currentPhase !== 'position_bid' || session.currentBidderId === null) return null;
      let order: Array<{ ordinal: number; memberId: number }>;
      try {
        order = await getDb(this.env.DB)
          .select({ ordinal: bidOrder.ordinal, memberId: bidOrder.memberId })
          .from(bidOrder)
          .where(eq(bidOrder.bidSessionId, this.namedSessionId()))
          .orderBy(asc(bidOrder.ordinal))
          .all();
      } catch {
        return null;
      }
      const queueCursor = order.findIndex((entry) => entry.memberId === session.currentBidderId);
      const entry = queueCursor < 0 ? undefined : order[queueCursor];
      if (entry === undefined) return null;
      return {
        turn: {
          turnId: `mock-normal:${this.namedSessionId()}:${session.mockControlRevision}:${entry.ordinal}:${queueCursor}:${entry.memberId}`,
          bidderId: entry.memberId,
          ordinal: entry.ordinal,
          queueCursor,
        },
        mockControlRevision: session.mockControlRevision,
      };
    }

    const turn = this.specialtyNormalTurn(await this.getState());
    return turn === null ? null : { turn, mockControlRevision: null };
  }

  private sameSpecialtyNormalTurn(left: SpecialtyNormalTurn, right: SpecialtyNormalTurn): boolean {
    return (
      left.turnId === right.turnId &&
      left.bidderId === right.bidderId &&
      left.ordinal === right.ordinal &&
      left.queueCursor === right.queueCursor
    );
  }

  /**
   * A normal D1 writer owns this durable permit until it calls release. There
   * is deliberately no timer or implicit expiry: after a crashed writer the
   * D1 outcome is unknowable, so another writer or synthetic interruption
   * must fail closed instead of guessing that the old operation is finished.
   */
  private async normalMutationLeaseStatus(
    storage: Pick<DOStorageLike, 'get'> = this.storage,
  ): Promise<NormalMutationLeaseStatus> {
    try {
      const record = await storage.get<unknown>(
        bidSessionNormalMutationLeaseStorageKey(this.namedSessionId()),
      );
      if (record === undefined) return { kind: 'none' };
      if (!isNormalMutationLeaseRecord(record)) return { kind: 'unknown' };
      return { kind: 'active', lease: record };
    } catch {
      return { kind: 'unknown' };
    }
  }

  private async acquireNormalMutationLease(): Promise<NormalMutationLeaseAcquireResult> {
    return this.state.blockConcurrencyWhile(async () => {
      const existingLease = await this.normalMutationLeaseStatus();
      if (existingLease.kind === 'unknown') {
        return { ok: false, error: 'normal_mutation_lease_state_unknown' };
      }
      if (existingLease.kind === 'active') {
        return { ok: false, error: 'normal_mutation_lease_active' };
      }

      let specialtyState: unknown;
      try {
        specialtyState = await new BidSessionSpecialtyAdapter(
          this.storage,
          this.namedSessionId(),
        ).load();
      } catch {
        return { ok: false, error: 'specialty_adjudication_state_unavailable' };
      }
      if (!isValidSpecialtyAdjudicationState(specialtyState)) {
        return { ok: false, error: 'specialty_adjudication_state_unavailable' };
      }
      if (specialtyState.active !== null) {
        return { ok: false, error: 'specialty_adjudication_active' };
      }

      const leaseId = ulid();
      await this.storage.put(bidSessionNormalMutationLeaseStorageKey(this.namedSessionId()), {
        version: 1,
        leaseId,
        acquiredAtMs: Date.now(),
      } satisfies NormalMutationLeaseRecord);
      return { ok: true, leaseId };
    });
  }

  private async releaseNormalMutationLease(
    leaseId: string,
  ): Promise<NormalMutationLeaseReleaseResult> {
    return this.state.blockConcurrencyWhile(async () => {
      const existingLease = await this.normalMutationLeaseStatus();
      if (existingLease.kind === 'unknown') {
        return { ok: false, error: 'normal_mutation_lease_state_unknown' };
      }
      if (existingLease.kind === 'none') {
        return { ok: false, error: 'normal_mutation_lease_not_held' };
      }
      if (existingLease.lease.leaseId !== leaseId) {
        return { ok: false, error: 'normal_mutation_lease_not_owner' };
      }
      await this.storage.delete(bidSessionNormalMutationLeaseStorageKey(this.namedSessionId()));
      return { ok: true };
    });
  }

  private normalMutationLeaseRejection(
    lease: Exclude<NormalMutationLeaseStatus, { readonly kind: 'none' }>,
  ): SpecialtyTransportResult {
    if (lease.kind === 'active') {
      return {
        kind: 'rejected',
        code: 'normal_mutation_lease_active',
        message:
          'A direct normal Bid mutation is in progress; synthetic specialty interruption is blocked.',
        result: null,
      };
    }
    return {
      kind: 'rejected',
      code: 'normal_mutation_lease_state_unknown',
      message:
        'The normal Bid mutation permit has an unknown state; synthetic specialty interruption is blocked.',
      result: null,
    };
  }

  private async syntheticSpecialtyStatus(): Promise<{
    mode: 'synthetic_test_only';
    does_not_commit_bid: true;
    database_audit_log: 'not_written';
    normal_turn: {
      bidder_id: number;
      ordinal: number;
      queue_cursor: number;
      mock_control_revision: number | null;
    } | null;
    state: Awaited<ReturnType<BidSessionSpecialtyAdapter['load']>>;
    audit_receipts: SpecialtyCommandReceipt[];
  }> {
    const adapter = new BidSessionSpecialtyAdapter(this.storage, this.namedSessionId());
    const [specialtyState, receiptMap, currentNormalTurn] = await Promise.all([
      adapter.load(),
      this.state.storage.list<SpecialtyCommandReceipt>({
        prefix: bidSessionSpecialtyReceiptPrefix(this.namedSessionId()),
      }),
      this.currentSpecialtyNormalTurn(),
    ]);
    const receipts = [...receiptMap.values()].sort(
      (left, right) => left.afterState.revision - right.afterState.revision,
    );
    return {
      mode: 'synthetic_test_only',
      does_not_commit_bid: true,
      database_audit_log: 'not_written',
      normal_turn:
        currentNormalTurn === null
          ? null
          : {
              bidder_id: currentNormalTurn.turn.bidderId,
              ordinal: currentNormalTurn.turn.ordinal,
              queue_cursor: currentNormalTurn.turn.queueCursor,
              mock_control_revision: currentNormalTurn.mockControlRevision,
            },
      state: specialtyState,
      audit_receipts: receipts,
    };
  }

  private specialtyReplayResult(
    receipt: unknown | undefined,
    commandId: string,
    operation: SpecialtyCommandOperation,
    commandFingerprint: string,
  ): SpecialtyTransportResult | null {
    if (receipt === undefined) return null;
    if (!isVerifiedSpecialtyCommandReplay(receipt, commandId, operation, commandFingerprint)) {
      return {
        kind: 'rejected',
        code: SPECIALTY_COMMAND_ID_REUSE_CONFLICT,
        message:
          'This specialty command ID was previously used with a different or unverifiable command.',
        result: null,
      };
    }
    return {
      kind: 'accepted',
      idempotentReplay: true,
      result: receipt.result,
      receipt,
    };
  }

  /**
   * A successful synthetic command writes the engine state and immutable
   * receipt inside one Durable Object storage transaction. A retry can then
   * return the original exact result instead of attempting a duplicate engine
   * command. This intentionally does not write D1/R2 canonical audit records:
   * there is no approved specialty policy or award command to archive.
   */
  private async runSyntheticSpecialtyCommand(
    operation: SpecialtyCommandOperation,
    payload: SpecialtyPayload,
  ): Promise<SpecialtyTransportResult> {
    const bidSessionId = this.namedSessionId();
    const commandId = payload.command.commandId;
    const commandFingerprint = specialtyCommandReceiptFingerprint(operation, payload);
    const outcome = await this.state.blockConcurrencyWhile(
      async (): Promise<SpecialtyTransportResult> => {
        const receiptKey = bidSessionSpecialtyReceiptStorageKey(bidSessionId, commandId);
        const priorReceipt = this.specialtyReplayResult(
          await this.state.storage.get<unknown>(receiptKey),
          commandId,
          operation,
          commandFingerprint,
        );
        if (priorReceipt !== null) return priorReceipt;

        return this.state.storage.transaction(async (transaction) => {
          const replay = this.specialtyReplayResult(
            await transaction.get<unknown>(receiptKey),
            commandId,
            operation,
            commandFingerprint,
          );
          if (replay !== null) return replay;

          const adapter = new BidSessionSpecialtyAdapter(transaction, bidSessionId);
          const beforeState = await adapter.load();
          let result: SpecialtyEngineTransitionResult;
          switch (operation) {
            case 'begin': {
              // The direct normal D1 routes acquire this permit from this same
              // DO before writing. Checking it inside the synthetic command's
              // serialized storage transaction closes the status-read -> D1
              // TOCTOU: a specialty begin cannot suspend a turn while that
              // normal mutation remains unresolved.
              const normalMutationLease = await this.normalMutationLeaseStatus(transaction);
              if (normalMutationLease.kind !== 'none') {
                return this.normalMutationLeaseRejection(normalMutationLease);
              }
              const currentNormalTurn = await this.currentSpecialtyNormalTurn();
              if (currentNormalTurn === null) {
                return {
                  kind: 'rejected',
                  code: 'NORMAL_TURN_UNAVAILABLE',
                  message: 'The current normal position-Bid turn cannot be captured.',
                  result: null,
                };
              }
              const beginPayload = payload as SpecialtyBeginPayload;
              if (
                currentNormalTurn.mockControlRevision !== null &&
                beginPayload.command.expectedNormalControlRevision !==
                  currentNormalTurn.mockControlRevision
              ) {
                return {
                  kind: 'rejected',
                  code: 'STALE_MOCK_CONTROL_REVISION',
                  message:
                    'The mock normal Bid turn changed before the specialty interruption command was accepted.',
                  result: null,
                };
              }
              const {
                expectedNormalControlRevision: _expectedNormalControlRevision,
                ...beginCommand
              } = beginPayload.command;
              const command: SpecialtyAdjudicationRequest = {
                ...beginCommand,
                normalTurn: currentNormalTurn.turn,
              };
              result = await adapter.begin(command);
              break;
            }
            case 'resolve_candidate': {
              const candidatePayload = payload as SpecialtyCandidatePayload;
              const command: ResolveSpecialtyCandidateInput = candidatePayload.command;
              result = await adapter.resolveCandidate(command);
              break;
            }
            case 'resolve_original': {
              const originalPayload = payload as SpecialtyOriginalPayload;
              const command: ResolveOriginalSpecialtyRequestInput = originalPayload.command;
              result = await adapter.resolveOriginal(command);
              break;
            }
            case 'resume': {
              const active = beforeState.active;
              if (active !== null) {
                const currentNormalTurn = await this.currentSpecialtyNormalTurn();
                if (
                  currentNormalTurn === null ||
                  !this.sameSpecialtyNormalTurn(active.originalTurn, currentNormalTurn.turn)
                ) {
                  return {
                    kind: 'rejected',
                    code: 'NORMAL_TURN_CHANGED',
                    message:
                      'The captured normal turn changed while specialty adjudication was active.',
                    result: null,
                  };
                }
              }
              const resumePayload = payload as SpecialtyResumePayload;
              const command: ResumeSpecialtyAdjudicationInput = resumePayload.command;
              result = await adapter.resume(command);
              break;
            }
          }

          if (result.kind === 'rejected') {
            return {
              kind: 'rejected',
              code: result.code,
              message: result.message,
              result,
            };
          }

          const receipt: SpecialtyCommandReceipt = {
            version: 2,
            commandId,
            operation,
            commandFingerprint,
            acceptedAtMs: Date.now(),
            actorType: 'admin',
            actorId: payload.audit.actorId,
            reason: payload.audit.reason,
            effectiveDate: payload.audit.effectiveDate,
            origin: payload.audit.origin,
            beforeState,
            afterState: result.state,
            events: result.events,
            result,
          };
          await transaction.put(receiptKey, receipt);
          return {
            kind: 'accepted',
            idempotentReplay: false,
            result,
            receipt,
          };
        });
      },
    );
    // Emit only after the storage transaction committed. The marker is
    // deliberately separate from normal Bid envelopes and tells admin-only
    // clients to rehydrate the isolated synthetic state through its guarded
    // read endpoint.
    if (outcome.kind === 'accepted' && !outcome.idempotentReplay) {
      await this.broadcastSyntheticSpecialtyState();
    }
    return outcome;
  }

  private specialtyResponse(result: SpecialtyTransportResult): Response {
    const payload =
      result.kind === 'accepted'
        ? {
            mode: 'synthetic_test_only',
            does_not_commit_bid: true,
            kind: result.kind,
            idempotent_replay: result.idempotentReplay,
            result: result.result,
            audit_receipt: result.receipt,
          }
        : {
            mode: 'synthetic_test_only',
            does_not_commit_bid: true,
            kind: result.kind,
            error: result.code,
            message: result.message,
            result: result.result,
          };
    return new Response(JSON.stringify(payload), {
      status: result.kind === 'accepted' ? 200 : 409,
      headers: { 'content-type': 'application/json' },
    });
  }

  /**
   * The canonical D1 state exists only for the rehearsal mock command. Keep
   * this recovery path out of ordinary snapshots and legacy commands so an
   * unavailable or not-yet-migrated D1 binding cannot alter their behavior.
   */
  private async hydrateCanonicalMockState(localState: BidSessionState): Promise<BidSessionState> {
    const canonicalState = await loadCanonicalBidSessionState(this.env.DB, this.namedSessionId());
    if (canonicalState === null) return localState;

    const projection = this.projectCanonicalState(canonicalState);
    await persistBidSessionState(this.storage, projection);
    this.memoryState = projection;
    return projection;
  }

  private handlerEnv(): HandlerEnv {
    return {
      nowMs: () => Date.now(),
      newBidId: () => ulid(),
      evaluateEligibility: () => ({
        eligible: true,
        reasons: [],
        points: 0,
        soPoints: 0,
        moPoints: 0,
        breakdown: { total: 0, soTotal: 0, moTotal: 0, itemized: [] },
      }),
    };
  }

  /**
   * Reads policy only from the immutable session snapshot. It is deliberately
   * shared by non-position actions (skip/A-Day/order initialization), while
   * position picks use resolveFrozenSessionBidTarget below for the additional
   * rule-book membership check.
   */
  private async guardFrozenPoolMembers(memberIds: Iterable<number>): Promise<FrozenPoolGuard> {
    const frozen = await loadFrozenSessionBidPolicy(getDb(this.env.DB), this.namedSessionId());
    if (!frozen.ok) return { ok: false, code: frozen.code };

    const membersById = new Map(frozen.snapshot.members.map((member) => [member.memberId, member]));
    for (const memberId of memberIds) {
      const member = membersById.get(memberId);
      if (member === undefined) return { ok: false, code: 'member_not_in_bid_pool' };
      if (member.pool === 'EXCLUDED') {
        return { ok: false, code: 'member_excluded_from_bid_pool' };
      }
    }
    return { ok: true };
  }

  /** Accept only the exact order computed from the frozen session policy. */
  private async guardFrozenBidOrder(order: BidSessionState['bidOrder']): Promise<FrozenPoolGuard> {
    const frozen = await loadFrozenSessionBidPolicy(getDb(this.env.DB), this.namedSessionId());
    if (!frozen.ok) return { ok: false, code: frozen.code };

    const expected = computeBidOrder(bidOrderInputFromSnapshot(frozen.snapshot));
    if (
      order.length !== expected.length ||
      order.some((entry, index) => {
        const expectedEntry = expected[index];
        return (
          expectedEntry === undefined ||
          entry.ordinal !== expectedEntry.ordinal ||
          entry.memberId !== expectedEntry.memberId ||
          entry.pool !== expectedEntry.pool
        );
      })
    ) {
      return { ok: false, code: 'bid_order_not_frozen_policy' };
    }
    return { ok: true };
  }

  /**
   * Phase-two setup accepts a supplied record of phase-one picks. Validate the
   * complete batch against one frozen policy read so an administrative
   * position cannot be smuggled into A-Day setup without issuing one D1 read
   * per completed pick.
   */
  private async guardFrozenPhaseOnePicks(
    picks: TransitionToPhase2Input['phase1Picks'],
  ): Promise<FrozenPhaseOneGuard> {
    const frozen = await loadFrozenSessionBidPolicy(getDb(this.env.DB), this.namedSessionId());
    if (!frozen.ok) return { ok: false, code: frozen.code };

    const membersById = new Map(frozen.snapshot.members.map((member) => [member.memberId, member]));
    const biddablePositionIds = new Set(frozen.coverage.rules.map((rule) => rule.positionId));
    for (const pick of picks) {
      const member = membersById.get(pick.memberId);
      if (member === undefined) return { ok: false, code: 'member_not_in_bid_pool' };
      if (member.pool === 'EXCLUDED') {
        return { ok: false, code: 'member_excluded_from_bid_pool' };
      }
      if (!biddablePositionIds.has(pick.positionId)) {
        return { ok: false, code: 'position_not_biddable' };
      }
    }
    return { ok: true };
  }

  private envelope(
    type: BidEventEnvelope['type'],
    payload: unknown,
    seq: number,
  ): BidEventEnvelope {
    return { v: BID_EVENT_VERSION, seq, ts: Date.now(), type, payload };
  }

  private broadcast(env: BidEventEnvelope): void {
    const json = JSON.stringify(env);
    for (const c of this.clients.values()) {
      try {
        c.socket.send(json);
      } catch {}
    }
  }

  private async syntheticSpecialtyStateSignal(): Promise<SyntheticSpecialtyStateSignal> {
    const adapter = new BidSessionSpecialtyAdapter(this.storage, this.namedSessionId());
    const [specialtyState, currentNormalTurn] = await Promise.all([
      adapter.load(),
      this.currentSpecialtyNormalTurn(),
    ]);
    const normalTurn =
      currentNormalTurn === null
        ? null
        : {
            ...currentNormalTurn.turn,
            mockControlRevision: currentNormalTurn.mockControlRevision,
          };
    const active = specialtyState.active;
    const originalTurn =
      active === null
        ? null
        : {
            ...active.originalTurn,
            // A current mock turn can only be attached when it still matches
            // the persisted resume target. Otherwise the guarded GET is the
            // authority and the signal intentionally does not guess.
            mockControlRevision:
              currentNormalTurn !== null &&
              this.sameSpecialtyNormalTurn(active.originalTurn, currentNormalTurn.turn)
                ? currentNormalTurn.mockControlRevision
                : null,
          };
    const allowedNextAction =
      active === null
        ? normalTurn?.mockControlRevision !== null
          ? 'begin'
          : 'none'
        : active.phase === 'resolving_higher_priority_candidates'
          ? 'resolve_candidate'
          : active.phase === 'awaiting_original_bidder'
            ? 'resolve_original'
            : 'resume';
    return {
      v: 1,
      type: 'synthetic_specialty_state_changed',
      mode: 'synthetic_test_only',
      does_not_commit_bid: true,
      bidSessionId: this.namedSessionId(),
      revision: specialtyState.revision,
      controlState: {
        rehearsalRevision: currentNormalTurn?.mockControlRevision ?? null,
        normalTurn,
        normalBidderSuspended: active !== null,
        specialty:
          active === null
            ? {
                active: false,
                requestId: null,
                positionId: null,
                phase: null,
                originalTurn: null,
                candidateQueue: [],
                candidateCursor: 0,
                resolvedCandidateCount: 0,
                resolution: null,
                allowedNextAction,
              }
            : {
                active: true,
                requestId: active.requestId,
                positionId: active.positionId,
                phase: active.phase,
                originalTurn,
                candidateQueue: active.candidateQueue.map((candidate) => ({
                  memberId: candidate.memberId,
                  priorityRank: candidate.priorityRank,
                })),
                candidateCursor: active.candidateCursor,
                resolvedCandidateCount: active.candidateOutcomes.length,
                resolution: active.resolution,
                allowedNextAction,
              },
      },
    };
  }

  private async sendSyntheticSpecialtyState(socket: WebSocket): Promise<void> {
    try {
      socket.send(JSON.stringify(await this.syntheticSpecialtyStateSignal()));
    } catch {}
  }

  private async broadcastSyntheticSpecialtyState(): Promise<void> {
    const adminSockets = [...this.clients.values()]
      .filter((client) => client.role === 'admin')
      .map((client) => client.socket);
    await Promise.all(adminSockets.map((socket) => this.sendSyntheticSpecialtyState(socket)));
  }

  /**
   * Archive only after the canonical D1 command has committed and clients have
   * seen the realtime event. The retryable outbox absorbs R2 failures; it is
   * never part of the acceptance path.
   */
  private scheduleCanonicalAuditArchive(): void {
    if (!this.env.R2_AUDIT || typeof this.env.R2_AUDIT.put !== 'function') return;
    this.state.waitUntil(
      drainBidAuditOutbox({ db: this.env.DB, r2: this.env.R2_AUDIT }).catch((error) => {
        console.error('[BidSessionDO] canonical audit archive retry failed', error);
      }),
    );
  }

  private send(socket: WebSocket, env: BidEventEnvelope): void {
    try {
      socket.send(JSON.stringify(env));
    } catch {}
  }

  /**
   * Writes a flat audit_log row and (best-effort) emits into the R2 chain.
   *
   * For `pick` and `forced_pick` events the chain emit is performed
   * explicitly BEFORE state is persisted (§D10 strict variant) and the
   * caller passes `opts.skipChainEmit = true` so this method doesn't
   * double-emit. Non-pick events (skip, freeze, etc.) are emitted
   * best-effort: their D1 row is the authoritative record and any missing
   * chain entry is picked up by the reconciliation cron.
   */
  private async writeAudit(
    draft: AuditRowDraft,
    opts: { skipChainEmit?: boolean } = {},
  ): Promise<void> {
    try {
      await getDb(this.env.DB).insert(auditLog).values({
        id: draft.id,
        bidSessionId: draft.bidSessionId,
        seq: draft.seq,
        actorType: draft.actorType,
        actorId: draft.actorId,
        action: draft.action,
        targetKind: draft.targetKind,
        targetId: draft.targetId,
        beforeState: draft.beforeState,
        afterState: draft.afterState,
        reason: draft.reason,
        aiAdvisoryId: draft.aiAdvisoryId,
        clientMeta: draft.clientMeta,
        createdAt: draft.createdAt,
      });
    } catch (err) {
      // Audit failures must not break the DO state machine. The durable state
      // is the source of truth; failed audit writes are picked up by the
      // Plan 08 reconciliation job.
      console.error('[BidSessionDO] audit insert failed', err);
    }
    if (opts.skipChainEmit) return;
    try {
      await this.emitDraftToChain(draft);
    } catch (err) {
      console.error('[BidSessionDO] chain emit (best-effort) failed', err);
    }
  }

  /**
   * Plan 08 Task 21 — Look up the bid+member+position rows for an existing
   * D1 bid and enqueue the portal write-back. Returns silently when the
   * portal queue binding is absent (local/test).
   */
  private async enqueuePortalForBid(bidId: string): Promise<void> {
    if (!isPortalPublicationEnabled(this.env)) return;
    if (!this.env.PORTAL_QUEUE || typeof this.env.PORTAL_QUEUE.send !== 'function') return;
    const db = getDb(this.env.DB);
    const bid = await db.select().from(bids).where(eq(bids.id, bidId)).get();
    if (!bid) return;
    const session = await db
      .select({ isMock: bidSessions.isMock })
      .from(bidSessions)
      .where(eq(bidSessions.id, bid.bidSessionId))
      .get();
    if (!session || session.isMock) return;
    const member = await db.select().from(members).where(eq(members.id, bid.memberId)).get();
    if (!member) return;
    // Composite PK on positions means we have to fetch by id+template; since
    // only one active template is in use at a time we filter by id and pick
    // the first hit (Plan 03 invariant).
    const position = await db
      .select()
      .from(positions)
      .where(eq(positions.id, bid.positionId))
      .get();
    if (!position) return;
    const adminActor = bid.adminActorId
      ? ((await db.select().from(members).where(eq(members.id, bid.adminActorId)).get()) ?? null)
      : null;
    const payload = buildPortalPayload({
      bid: {
        id: bid.id,
        bidSessionId: bid.bidSessionId,
        memberId: bid.memberId,
        positionId: bid.positionId,
        aDay: bid.aDay,
        pickedAt: bid.pickedAt,
        forced: bid.forced,
        adminActorId: bid.adminActorId,
      },
      member: {
        id: member.id,
        employeeId: member.employeeId,
        rank: member.rank,
      },
      adminActor: adminActor ? { id: adminActor.id, employeeId: adminActor.employeeId } : null,
      position: {
        id: position.id,
        shift: position.shift,
        station: position.station,
        unit: position.unit,
      },
      bidYear: new Date().getUTCFullYear(),
    });
    await enqueuePortalWriteback({
      bidId: bid.id,
      employeeId: member.employeeId,
      payload,
      publicationEnabled: true,
      isMock: false,
      queue: this.env.PORTAL_QUEUE,
      insertQueueRow: async (row) => {
        await db.insert(portalWritebackQueue).values({
          id: row.id,
          bidId: row.bidId,
          enqueuedAt: row.enqueuedAt,
          nextAttemptAt: row.nextAttemptAt,
          attempts: row.attempts,
          status: row.status,
          payloadJson: row.payloadJson,
          lastError: row.lastError,
        });
      },
      now: () => Date.now(),
    });
  }

  /**
   * Plan 08 §D10 — strict variant for picks. Throws on R2 failure so the
   * caller can return pick_rejected. MUST be called BEFORE persisting the
   * new state — otherwise a successful pick will be unrecoverable if R2 is
   * down.
   */
  private async emitPickToChain(draft: AuditRowDraft): Promise<void> {
    const emitter = this.getEmitter();
    if (!emitter) return; // emitter disabled (no AUDIT_SIGNING_PRIVKEY) — degrade gracefully
    await emitter.emit(this.draftToEvent(draft));
    // W34 — arm the timeout flush. If the emit just triggered a threshold
    // flush (100 events), pendingSessions() is empty and we don't really
    // need an alarm — but we set it cheaply and the alarm() callback
    // will be a no-op via flushStale.
    await this.armAuditFlushAlarm();
  }

  private async emitDraftToChain(draft: AuditRowDraft): Promise<void> {
    const emitter = this.getEmitter();
    if (!emitter) return;
    await emitter.emit(this.draftToEvent(draft));
    await this.armAuditFlushAlarm();
  }

  private draftToEvent(draft: AuditRowDraft): AuditEvent {
    return {
      seq: draft.seq,
      bid_session_id: draft.bidSessionId,
      action: draft.action,
      actor_type: draft.actorType,
      actor_id: draft.actorId,
      target_kind: draft.targetKind ?? null,
      target_id: draft.targetId ?? null,
      before_state: draft.beforeState ?? null,
      after_state: draft.afterState ?? null,
      reason: draft.reason ?? null,
      ai_advisory_id: draft.aiAdvisoryId ?? null,
      client_meta: draft.clientMeta ?? null,
      created_at: draft.createdAt.toISOString(),
    };
  }

  /**
   * Returns the per-isolate ChainEmitter, or null if the audit-chain bindings
   * are not configured (e.g. unit tests with stub env). Constructed lazily so
   * DO instantiation does not fail when secrets are absent in local dev.
   */
  private getEmitter(): ChainEmitter | null {
    if (this.emitter) return this.emitter;
    if (!this.env.AUDIT_SIGNING_PRIVKEY || !this.env.AUDIT_SIGNING_PUBKEY) return null;
    if (!this.env.R2_AUDIT || typeof this.env.R2_AUDIT.put !== 'function') return null;
    this.emitter = new ChainEmitter({
      r2: this.env.R2_AUDIT,
      db: makeChainDb(this.env.DB),
      privKey: this.env.AUDIT_SIGNING_PRIVKEY,
      pubKey: this.env.AUDIT_SIGNING_PUBKEY,
      year: new Date().getUTCFullYear(),
      now: () => Date.now(),
    });
    return this.emitter;
  }

  /**
   * W34 — Arm a DO alarm to flush the audit chain in ~30s.
   *
   * Called after every `emitter.emit(...)` that buffers events (i.e. didn't
   * already trigger a threshold flush). The Worker-level 1-minute cron
   * can't reach per-DO emitter state, so we delegate stale-flush duty to
   * the DO itself.
   *
   * Best-effort: in unit tests `state.storage.setAlarm` doesn't exist on
   * the stubbed storage; we no-op silently. The threshold flush (100 events)
   * still works synchronously inside `emitter.emit`, so durability is
   * preserved even if the alarm path is unreachable.
   */
  private async armAuditFlushAlarm(): Promise<void> {
    const storage = this.state.storage as unknown as {
      setAlarm?: (whenMs: number) => Promise<void>;
      getAlarm?: () => Promise<number | null>;
    };
    if (typeof storage.setAlarm !== 'function') return;
    try {
      const desired = Date.now() + 30_000;
      const current = typeof storage.getAlarm === 'function' ? await storage.getAlarm() : null;
      // If an alarm is already pending and earlier than `desired`, keep it —
      // the existing alarm will fire first and re-arm if there's still work.
      if (current !== null && current <= desired) return;
      await storage.setAlarm(desired);
    } catch (err) {
      console.error('[BidSessionDO] setAlarm failed (best-effort)', err);
    }
  }

  /**
   * W34 — DO alarm callback. Cloudflare invokes this at the time we set via
   * `state.storage.setAlarm`. We flush any stale chunks (buffer age >= 30s)
   * and re-arm the alarm if there's still pending work waiting to age out.
   *
   * Safe to call repeatedly; `flushStale` is a no-op when no buffers have
   * crossed the timeout threshold.
   */
  async alarm(): Promise<void> {
    const emitter = this.getEmitter();
    if (!emitter) return;
    try {
      await emitter.flushStale();
    } catch (err) {
      console.error('[BidSessionDO] alarm flushStale failed', err);
    }
    // If anything still has pending events, re-arm so the next age-out gets
    // its flush. The chunker only flushes >=30s-old buffers, so the work
    // left here is "events buffered after the last alarm armed".
    if (emitter.pendingSessions().length > 0) {
      await this.armAuditFlushAlarm();
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/ws')) {
      return this.handleUpgrade(req);
    }
    if (url.pathname.endsWith('/snapshot')) {
      const state = await this.getState();
      return new Response(JSON.stringify(state), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/normal-mutation-lease/acquire') {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const result = await this.acquireNormalMutationLease();
      return new Response(
        JSON.stringify(
          result.ok ? { ok: true, lease_id: result.leaseId } : { error: result.error },
        ),
        {
          status: result.ok ? 200 : 409,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    if (url.pathname === '/admin/normal-mutation-lease/release') {
      if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
      const raw = await req.json().catch(() => null);
      const parsed = NormalMutationLeaseReleasePayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: 'normal_mutation_lease_invalid' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const result = await this.releaseNormalMutationLease(parsed.data.lease_id);
      return new Response(JSON.stringify(result.ok ? { ok: true } : { error: result.error }), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/specialty-adjudication') {
      if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
      return new Response(JSON.stringify(await this.syntheticSpecialtyStatus()), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/specialty-adjudication/begin') {
      const raw = await req.json().catch(() => null);
      const parsed = SpecialtyBeginPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: 'invalid_synthetic_specialty_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return this.specialtyResponse(await this.runSyntheticSpecialtyCommand('begin', parsed.data));
    }
    if (url.pathname === '/admin/specialty-adjudication/resolve-candidate') {
      const raw = await req.json().catch(() => null);
      const parsed = SpecialtyCandidatePayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: 'invalid_synthetic_specialty_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return this.specialtyResponse(
        await this.runSyntheticSpecialtyCommand('resolve_candidate', parsed.data),
      );
    }
    if (url.pathname === '/admin/specialty-adjudication/resolve-original') {
      const raw = await req.json().catch(() => null);
      const parsed = SpecialtyOriginalPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: 'invalid_synthetic_specialty_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return this.specialtyResponse(
        await this.runSyntheticSpecialtyCommand('resolve_original', parsed.data),
      );
    }
    if (url.pathname === '/admin/specialty-adjudication/resume') {
      const raw = await req.json().catch(() => null);
      const parsed = SpecialtyResumePayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: 'invalid_synthetic_specialty_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return this.specialtyResponse(await this.runSyntheticSpecialtyCommand('resume', parsed.data));
    }
    if (url.pathname === '/admin/skip') {
      const body = (await req.json()) as SkipInput;
      const result = await this.adminSkip(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/force-pick') {
      const body = (await req.json()) as ForcePickInput;
      const result = await this.adminForcePick(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/freeze') {
      const body = (await req.json()) as FreezeInput;
      const result = await this.adminFreeze(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/admin/commands/mock-freeze') {
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid_mock_freeze_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const parsed = MockFreezeCommandSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: 'invalid_mock_freeze_command' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      const result = await this.adminMockFreezeCommand(parsed.data);
      return new Response(JSON.stringify(result), {
        status: result.kind === 'accepted' ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/submit-a-day-pick')) {
      const body = (await req.json()) as SubmitADayPickInput;
      const result = await this.submitADayPick(body);
      return new Response(JSON.stringify(result), {
        status: result.kind === 'accepted' ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/transition-to-phase-2')) {
      const body = (await req.json()) as TransitionToPhase2Input;
      const result = await this.transitionToPhase2(body);
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname.endsWith('/reset-mock')) {
      // Plan 09 / Rehearsal Tooling — Task R4. Wipes durable session state so
      // an admin can re-run a mock rehearsal from a clean slate without
      // destroying the audit chain.
      const reset = await this.resetMock();
      if (!reset) {
        return new Response(JSON.stringify({ error: 'canonical_reset_requires_new_epoch' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  /**
   * Plan 09 / Rehearsal Tooling — Task R4.
   *
   * Reset is intentionally disabled until a future audited reset-epoch command
   * can serialize it with canonical mock commands. A preflight-plus-delete
   * route is unsafe: a freeze may commit between those operations.
   */
  async resetMock(): Promise<boolean> {
    return false;
  }

  private async handleUpgrade(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 });
    }
    const identity = parseVerifiedWebSocketIdentity(req.headers);
    if (identity === null) {
      return new Response('Forbidden', { status: 403 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    const clientId = ulid();

    server.addEventListener('message', async (ev) => {
      await this.onMessage(clientId, server, ev, identity);
    });
    server.addEventListener('close', () => {
      this.clients.delete(clientId);
    });
    server.addEventListener('error', () => {
      this.clients.delete(clientId);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async onMessage(
    clientId: string,
    socket: WebSocket,
    ev: MessageEvent,
    identity: VerifiedWebSocketIdentity,
  ): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(String(ev.data));
    } catch {
      this.send(
        socket,
        this.envelope(
          'pick_rejected',
          {
            idempotencyKey: '00000000-0000-4000-8000-000000000000',
            code: 'PROTOCOL_ERROR',
            message: 'Invalid JSON',
          } satisfies PickRejectedEvent,
          0,
        ),
      );
      return;
    }
    const parsed = ClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.send(
        socket,
        this.envelope(
          'pick_rejected',
          {
            idempotencyKey: '00000000-0000-4000-8000-000000000000',
            code: 'PROTOCOL_ERROR',
            message: parsed.error.message,
          } satisfies PickRejectedEvent,
          0,
        ),
      );
      return;
    }

    const msg = parsed.data;
    if (msg.type === 'hello') {
      // Never trust a client-provided identity or the hello JWT: the route
      // already verified the token and this identity crossed only the DO
      // service binding.
      this.clients.set(clientId, { socket, ...identity });
      const state = await this.getState();
      const snap: StateSnapshotEvent = {
        bidSessionId: state.bidSessionId,
        seq: state.lastSeq,
        currentPhase: state.currentPhase,
        currentBidderId: state.currentBidderId,
        turnStartedAtMs: state.turnStartedAtMs,
        turnTimerSeconds: state.turnTimerSeconds,
        frozenAt: state.frozenAt,
        fills: Object.entries(state.fills).map(([positionId, f]) => ({
          positionId,
          memberId: f.memberId,
          ordinal: f.ordinal,
        })),
        bidOrder: [...state.bidOrder],
      };
      this.send(socket, this.envelope('state_snapshot', snap, state.lastSeq));
      if (identity.role === 'admin') {
        await this.sendSyntheticSpecialtyState(socket);
      }
      return;
    }

    if (msg.type === 'ping') {
      const state = await this.getState();
      this.send(socket, this.envelope('pong', { ts: msg.ts }, state.lastSeq));
      return;
    }

    if (msg.type === 'submit_pick') {
      await this.applySubmitPick(clientId, msg);
    }
  }

  private async applySubmitPick(
    clientId: string,
    msg: { positionId: string; aDay: string | null; idempotencyKey: string },
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    await this.state.blockConcurrencyWhile(async () => {
      const idemKey = `idem:${this.state.id.toString()}:${msg.idempotencyKey}`;
      const state = await this.getState();

      // A synthetic specialty rehearsal captures this exact normal turn in a
      // separate durable state record. Do not allow the websocket path to
      // advance it until the adjudication has explicitly resumed it. There is
      // deliberately no idempotency record for this temporary rejection so the
      // same normal pick can be retried after the exact captured turn resumes.
      const specialtyState = await new BidSessionSpecialtyAdapter(
        this.storage,
        this.namedSessionId(),
      ).load();
      if (specialtyState.active !== null) {
        this.send(
          client.socket,
          this.envelope(
            'pick_rejected',
            {
              idempotencyKey: msg.idempotencyKey,
              code: 'SESSION_PAUSED',
              message:
                'The normal turn is suspended for synthetic specialty adjudication and has not resumed.',
            } satisfies PickRejectedEvent,
            state.lastSeq,
          ),
        );
        return;
      }

      // The DO is an independent mutation boundary. Never trust a queued or
      // websocket-supplied target merely because its legacy state happens to
      // contain it: resolve the member and position against the frozen policy
      // before idempotency replay or handler execution.
      const policyTarget = await resolveFrozenSessionBidTarget(getDb(this.env.DB), {
        bidSessionId: this.namedSessionId(),
        memberId: client.memberId,
        positionId: msg.positionId,
      });
      if (!policyTarget.ok) {
        const envelope = this.envelope(
          'pick_rejected',
          {
            idempotencyKey: msg.idempotencyKey,
            code: 'NOT_ELIGIBLE',
            message: frozenPolicyRejectionMessage(policyTarget.code),
          } satisfies PickRejectedEvent,
          state.lastSeq,
        );
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        this.send(client.socket, envelope);
        return;
      }

      const frozenEligibilityMember = frozenEligibilityMemberForSession(
        policyTarget.snapshot,
        client.memberId,
      );
      if (frozenEligibilityMember === null) {
        const envelope = this.envelope(
          'pick_rejected',
          {
            idempotencyKey: msg.idempotencyKey,
            code: 'NOT_ELIGIBLE',
            message: 'Immutable session eligibility material is unavailable.',
          } satisfies PickRejectedEvent,
          state.lastSeq,
        );
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        this.send(client.socket, envelope);
        return;
      }
      const eligibility = evaluateEligibility(
        eligibilityMemberFromFrozen(frozenEligibilityMember),
        policyTarget.rule,
      );
      if (!eligibility.eligible) {
        const envelope = this.envelope(
          'pick_rejected',
          {
            idempotencyKey: msg.idempotencyKey,
            code: 'NOT_ELIGIBLE',
            message: `Not eligible: ${eligibility.reasons
              .filter((reason) => !reason.satisfied)
              .map((reason) => reason.label)
              .join('; ')}`,
          } satisfies PickRejectedEvent,
          state.lastSeq,
        );
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        this.send(client.socket, envelope);
        return;
      }

      const prior = await this.storage.get<IdempotencyRecord>(idemKey);
      if (prior) {
        this.send(client.socket, prior.envelope);
        return;
      }

      const input: SubmitPickInput = {
        senderMemberId: client.memberId,
        positionId: msg.positionId,
        aDay: msg.aDay,
        idempotencyKey: msg.idempotencyKey,
      };
      const result = handleSubmitPick(state, this.handlerEnv(), input);

      let envelope: BidEventEnvelope;
      if (result.kind === 'accepted') {
        // Plan 08 §D10 — emit the R2 audit chunk BEFORE persisting durable
        // state. If R2 is unavailable we throw, the outer fetch handler
        // catches the error and the pick is rejected (the WS client sees
        // pick_rejected/AUDIT_UNAVAILABLE). This protects the legal-record
        // guarantee: every persisted pick has a chained R2 record.
        const pickDraft = auditEntryForPickMade({
          bidSessionId: result.event.payload.bidSessionId,
          seq: result.newState.lastSeq,
          bidId: result.event.payload.bidId,
          memberId: result.event.payload.memberId,
          positionId: result.event.payload.positionId,
          idempotencyKey: result.event.payload.idempotencyKey,
          nowMs: Date.now(),
        });
        try {
          await this.emitPickToChain(pickDraft);
        } catch (err) {
          console.error('[BidSessionDO] pick rejected — audit chain unavailable', err);
          envelope = this.envelope(
            'pick_rejected',
            {
              idempotencyKey: msg.idempotencyKey,
              code: 'AUDIT_UNAVAILABLE',
              message: 'Audit chain unavailable — pick rejected (Plan 08 §D10).',
            } satisfies PickRejectedEvent,
            state.lastSeq,
          );
          await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
          this.send(client.socket, envelope);
          return;
        }
        await persistBidSessionState(this.storage, result.newState);
        this.memoryState = result.newState;
        envelope = this.envelope('pick_made', result.event.payload, result.newState.lastSeq);
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        // D1 mirror — fire-and-forget; chain is already durable in R2.
        await this.writeAudit(pickDraft, { skipChainEmit: true });
        // Plan 08 Task 21 — enqueue portal write-back. Failures are
        // best-effort; reconciliation cron picks up unfinished rows.
        try {
          await this.enqueuePortalForBid(result.event.payload.bidId);
        } catch (err) {
          console.error('[BidSessionDO] portal enqueue failed (best-effort)', err);
        }
        this.broadcast(envelope);
      } else {
        envelope = this.envelope(
          'pick_rejected',
          {
            idempotencyKey: msg.idempotencyKey,
            code: result.code,
            message: result.message,
          } satisfies PickRejectedEvent,
          state.lastSeq,
        );
        await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
        this.send(client.socket, envelope);
      }
    });
  }

  async adminSkip(input: SkipInput): Promise<{ ok: boolean; envelope?: BidEventEnvelope }> {
    return this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      if (state.currentBidderId === null) return { ok: false };
      const policy = await this.guardFrozenPoolMembers([state.currentBidderId]);
      if (!policy.ok) return { ok: false };
      const r = handleSkip(state, this.handlerEnv(), input);
      if (r.kind === 'rejected') {
        return { ok: false };
      }
      await persistBidSessionState(this.storage, r.newState);
      this.memoryState = r.newState;
      const envelope = this.envelope('skip', r.event.payload, r.newState.lastSeq);
      await this.writeAudit(
        auditEntryForSkip({
          bidSessionId: r.event.payload.bidSessionId,
          seq: r.newState.lastSeq,
          adminActorId: input.adminActorId,
          skippedMemberId: r.event.payload.skippedMemberId,
          reason: r.event.payload.reason,
          nowMs: Date.now(),
        }),
      );
      this.broadcast(envelope);
      return { ok: true, envelope };
    });
  }

  async adminForcePick(
    input: ForcePickInput,
  ): Promise<{ ok: boolean; envelope?: BidEventEnvelope; error?: string }> {
    return this.state.blockConcurrencyWhile(async () => {
      const policyTarget = await resolveFrozenSessionBidTarget(getDb(this.env.DB), {
        bidSessionId: this.namedSessionId(),
        memberId: input.targetMemberId,
        positionId: input.positionId,
      });
      if (!policyTarget.ok) return { ok: false, error: policyTarget.code };

      const state = await this.getState();
      const r = handleForcePick(state, this.handlerEnv(), input);
      if (r.kind === 'rejected') {
        return { ok: false };
      }
      // Plan 08 §D10 — strict chain emit BEFORE persist so a forced pick
      // is never silently un-mirrored to R2.
      const forcedDraft = auditEntryForForcedPick({
        bidSessionId: r.event.payload.bidSessionId,
        seq: r.newState.lastSeq,
        bidId: r.event.payload.bidId,
        adminActorId: input.adminActorId,
        targetMemberId: r.event.payload.memberId,
        positionId: r.event.payload.positionId,
        reason: r.event.payload.reason,
        nowMs: Date.now(),
      });
      try {
        await this.emitPickToChain(forcedDraft);
      } catch (err) {
        console.error('[BidSessionDO] force-pick rejected — audit chain unavailable', err);
        return { ok: false };
      }
      await persistBidSessionState(this.storage, r.newState);
      this.memoryState = r.newState;
      const envelope = this.envelope('forced_pick', r.event.payload, r.newState.lastSeq);
      await this.writeAudit(forcedDraft, { skipChainEmit: true });
      this.broadcast(envelope);
      return { ok: true, envelope };
    });
  }

  async adminFreeze(input: FreezeInput): Promise<{ ok: boolean; envelope?: BidEventEnvelope }> {
    return this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      const r = handleFreeze(state, this.handlerEnv(), input);
      if (r.kind === 'rejected') {
        return { ok: false };
      }
      await persistBidSessionState(this.storage, r.newState);
      this.memoryState = r.newState;
      const envelope = this.envelope('freeze', r.event.payload, r.newState.lastSeq);
      await this.writeAudit(
        auditEntryForFreeze({
          bidSessionId: r.event.payload.bidSessionId,
          seq: r.newState.lastSeq,
          adminActorId: input.adminActorId,
          reason: r.event.payload.reason,
          nowMs: Date.now(),
        }),
      );
      this.broadcast(envelope);
      return { ok: true, envelope };
    });
  }

  /**
   * Rehearsal-only canonical command proof. The named DO supplies ordering,
   * while D1 atomically owns the state/receipt/event/audit/outbox bundle. DO
   * storage is only a reconstructible local projection after that commit.
   */
  async adminMockFreezeCommand(command: MockFreezeCommand): Promise<MockFreezeCommandResult> {
    return this.state.blockConcurrencyWhile(async () => {
      const localState = await this.getState();
      const namedSessionId = this.namedSessionId();
      if (command.bidSessionId !== namedSessionId) {
        return {
          kind: 'rejected',
          commandId: command.commandId,
          code: 'SESSION_ID_MISMATCH',
          currentSeq: localState.lastSeq,
        };
      }
      const commit = await commitMockFreezeCommand({
        db: this.env.DB,
        command,
        state: localState,
        // This durable marker is written immediately before the D1 batch. If
        // projection fails after an accepted batch, future snapshots/reconnects
        // know to rebuild from D1 without making legacy sessions D1-dependent.
        beforeD1Commit: () => this.markCanonicalMockIntent(),
      });
      const canonicalState =
        commit.canonicalState ??
        (await loadCanonicalBidSessionState(this.env.DB, this.namedSessionId()));
      if (canonicalState === null) {
        // A confirmed no-commit must not convert this DO into a D1-dependent
        // session. An exception above deliberately leaves the pending marker
        // intact because the D1 outcome is then unknown.
        await this.clearCanonicalMockIntent();
        return commit.result;
      }
      await this.activateCanonicalMockIntent();

      const projection = this.projectCanonicalState(canonicalState);
      // If this write is interrupted, D1 still has the accepted command and a
      // later hibernation/retry rebuilds this projection from that authority.
      await persistBidSessionState(this.storage, projection);
      this.memoryState = projection;
      if (commit.result.kind === 'accepted') {
        this.broadcast(commit.result.envelope);
        this.scheduleCanonicalAuditArchive();
      }
      return commit.result;
    });
  }

  async initSession(input: {
    bidOrder: BidSessionState['bidOrder'];
    turnTimerSeconds: number;
  }): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      if (state.currentPhase !== 'config') {
        return;
      }
      const policy = await this.guardFrozenBidOrder(input.bidOrder);
      if (!policy.ok) return;
      const first = input.bidOrder[0]?.memberId ?? null;
      const newState: BidSessionState = {
        ...state,
        bidOrder: input.bidOrder,
        queueCursor: 0,
        currentBidderId: first,
        currentPhase: first === null ? 'complete' : 'position_bid',
        turnTimerSeconds: input.turnTimerSeconds,
        turnStartedAtMs: first === null ? 0 : Date.now(),
        lastSeq: state.lastSeq + 1,
      };
      await persistBidSessionState(this.storage, newState);
      this.memoryState = newState;
    });
  }

  /**
   * Plan 07: transition the DO from `position_bid` to `a_day_bid`.
   * Caller (admin route or auto-detect job) supplies the Phase 1 results and
   * member roster. Atomic via blockConcurrencyWhile.
   */
  async transitionToPhase2(input: TransitionToPhase2Input): Promise<{ ok: boolean }> {
    return this.state.blockConcurrencyWhile(async () => {
      const state = await this.getState();
      if (state.frozenAt !== null) {
        return { ok: false };
      }
      if (state.currentPhase !== 'position_bid' && state.currentPhase !== 'paused') {
        return { ok: false };
      }
      const participantIds = [
        ...input.phase1Order,
        ...(input.preSeededPicks?.map((pick) => pick.memberId) ?? []),
      ];
      const policy = await this.guardFrozenPoolMembers(participantIds);
      if (!policy.ok) return { ok: false };
      const phaseOnePolicy = await this.guardFrozenPhaseOnePicks(input.phase1Picks);
      if (!phaseOnePolicy.ok) return { ok: false };
      const nowMs = Date.now();
      const newState = transitionToPhase2(state, input, nowMs);
      await persistBidSessionState(this.storage, newState);
      this.memoryState = newState;
      const envelope = this.envelope(
        'phase_changed',
        {
          from: state.currentPhase,
          to: newState.currentPhase,
          bidOrderPhase2: newState.aDay?.bidOrder ?? [],
        },
        newState.lastSeq,
      );
      this.broadcast(envelope);
      return { ok: true };
    });
  }

  /**
   * Plan 07: apply a Phase-2 A-Day pick (normal member submission OR admin force).
   * Mirrors applySubmitPick from Phase 1 — persist before broadcast, idempotent
   * via storage-keyed prior envelope.
   */
  async submitADayPick(input: SubmitADayPickInput): Promise<SubmitADayPickResult> {
    return this.state.blockConcurrencyWhile(async () => {
      const idemKey = `idem-aday:${this.state.id.toString()}:${input.idempotencyKey}`;
      const policy = await this.guardFrozenPoolMembers([input.senderMemberId]);
      if (!policy.ok) {
        return {
          kind: 'rejected',
          code: 'UNKNOWN_MEMBER',
          message: frozenPolicyRejectionMessage(policy.code),
          idempotencyKey: input.idempotencyKey,
        };
      }
      const prior = await this.storage.get<IdempotencyRecord>(idemKey);
      if (prior) {
        // Replay the prior envelope to the caller via broadcast for parity, but
        // return a synthesized "accepted-like" result. For correctness we just
        // re-broadcast and let the caller treat this as a no-op.
        this.broadcast(prior.envelope);
        return {
          kind: 'rejected',
          code: 'ALREADY_PICKED',
          message: 'Idempotency key already used.',
          idempotencyKey: input.idempotencyKey,
        };
      }
      const state = await this.getState();
      const nowMs = Date.now();
      const result = handleSubmitADayPick(state, input, nowMs);
      if (result.kind === 'rejected') {
        return result;
      }
      await persistBidSessionState(this.storage, result.newState);
      this.memoryState = result.newState;
      const envelope = this.envelope(
        result.pick.forced ? 'forced_a_day_pick_made' : 'a_day_pick_made',
        {
          memberId: result.pick.memberId,
          shift: result.pick.shift,
          aDay: result.pick.aDay,
          pickedAtMs: result.pick.pickedAtMs,
          forced: result.pick.forced,
          adminActorId: result.pick.adminActorId,
          nextMemberId: result.nextMemberId,
        },
        result.newState.lastSeq,
      );
      await this.storage.put(idemKey, { envelope } satisfies IdempotencyRecord);
      this.broadcast(envelope);
      // If Phase 2 just completed, also broadcast phase_changed.
      if (result.newState.currentPhase === 'complete') {
        this.broadcast(
          this.envelope(
            'phase_changed',
            { from: 'a_day_bid', to: 'complete' },
            result.newState.lastSeq,
          ),
        );
      }
      return result;
    });
  }
}
