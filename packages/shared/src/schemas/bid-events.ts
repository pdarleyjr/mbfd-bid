import { z } from 'zod';
import { BID_EVENT_VERSION } from '../constants/bid-events.js';

export const PICK_REJECT_CODES = [
  'NOT_YOUR_TURN',
  'POSITION_FILLED',
  'NOT_ELIGIBLE',
  'ALREADY_PICKED',
  'SESSION_FROZEN',
  'SESSION_PAUSED',
  'PROTOCOL_ERROR',
  // Plan 08 §D10 — chain emit failed; pick is unrecoverable until R2 recovers.
  'AUDIT_UNAVAILABLE',
] as const;
export const PickRejectCodeSchema = z.enum(PICK_REJECT_CODES);
export type PickRejectCode = z.infer<typeof PickRejectCodeSchema>;

export const SubmitPickMessageSchema = z.object({
  type: z.literal('submit_pick'),
  positionId: z.string().min(1).max(16),
  aDay: z.string().nullable(),
  idempotencyKey: z.string().uuid(),
});
export type SubmitPickMessage = z.infer<typeof SubmitPickMessageSchema>;

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
  ts: z.number().int().nonnegative(),
});
export type PingMessage = z.infer<typeof PingMessageSchema>;

export const ClientHelloMessageSchema = z.object({
  type: z.literal('hello'),
  // Connection authentication is completed during the WebSocket upgrade via
  // a short-lived, protocol-bound ticket. Keeping a bearer JWT out of the
  // application message prevents it from being retained in client logs,
  // reconnect payloads, or Durable Object message traces.
  lastSeq: z.number().int().nonnegative().optional(),
});
export type ClientHelloMessage = z.infer<typeof ClientHelloMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientHelloMessageSchema,
  SubmitPickMessageSchema,
  PingMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const PickMadeEventSchema = z.object({
  bidId: z.string().min(1),
  bidSessionId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  memberId: z.number().int().positive(),
  positionId: z.string().min(1),
  aDay: z.string().nullable(),
  idempotencyKey: z.string().uuid(),
  nextBidderId: z.number().int().nonnegative().nullable(),
  turnStartedAtMs: z.number().int().nonnegative(),
});
export type PickMadeEvent = z.infer<typeof PickMadeEventSchema>;

export const PickRejectedEventSchema = z.object({
  idempotencyKey: z.string().uuid(),
  code: PickRejectCodeSchema,
  message: z.string().min(1),
});
export type PickRejectedEvent = z.infer<typeof PickRejectedEventSchema>;

export const SkipEventSchema = z.object({
  bidSessionId: z.string().min(1),
  skippedMemberId: z.number().int().positive(),
  ordinal: z.number().int().nonnegative(),
  reason: z.string().min(1),
  nextBidderId: z.number().int().nonnegative().nullable(),
  turnStartedAtMs: z.number().int().nonnegative(),
});
export type SkipEvent = z.infer<typeof SkipEventSchema>;

export const ForcedPickEventSchema = z.object({
  bidId: z.string().min(1),
  bidSessionId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  memberId: z.number().int().positive(),
  positionId: z.string().min(1),
  adminActorId: z.number().int().nonnegative(),
  reason: z.string().min(1),
});
export type ForcedPickEvent = z.infer<typeof ForcedPickEventSchema>;

export const FreezeEventSchema = z.object({
  bidSessionId: z.string().min(1),
  frozenAt: z.number().int().nonnegative(),
  freezeActorId: z.number().int().nonnegative(),
  reason: z.string().min(1),
});
export type FreezeEvent = z.infer<typeof FreezeEventSchema>;

export const StateSnapshotEventSchema = z.object({
  bidSessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  currentPhase: z.enum(['config', 'position_bid', 'a_day_bid', 'paused', 'complete']),
  currentBidderId: z.number().int().nonnegative().nullable(),
  turnStartedAtMs: z.number().int().nonnegative(),
  turnTimerSeconds: z.number().int().positive(),
  frozenAt: z.number().int().nonnegative().nullable(),
  fills: z.array(
    z.object({
      positionId: z.string().min(1),
      memberId: z.number().int().positive(),
      ordinal: z.number().int().nonnegative(),
    }),
  ),
  bidOrder: z.array(
    z.object({
      ordinal: z.number().int().positive(),
      memberId: z.number().int().positive(),
      pool: z.enum(['OFC', 'FF']),
    }),
  ),
});
export type StateSnapshotEvent = z.infer<typeof StateSnapshotEventSchema>;

/**
 * An admin-only, PII-free normal-turn locator used by the isolated synthetic
 * specialty rehearsal. It is deliberately separate from the normal Bid event
 * sequence, whose state is canonical and must not be imitated by a mock.
 */
export const SyntheticSpecialtyNormalTurnSchema = z
  .object({
    turnId: z.string().min(1).max(320),
    bidderId: z.number().int().positive(),
    ordinal: z.number().int().positive(),
    queueCursor: z.number().int().nonnegative(),
    mockControlRevision: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type SyntheticSpecialtyNormalTurn = z.infer<typeof SyntheticSpecialtyNormalTurnSchema>;

const SyntheticSpecialtyCandidateSchema = z
  .object({
    memberId: z.number().int().positive(),
    priorityRank: z.number().int().nonnegative(),
  })
  .strict();

const SyntheticSpecialtyResolutionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('awarded'),
      awardedToMemberId: z.number().int().positive(),
      awardReference: z.string().min(1).max(500),
      awardedBy: z.enum(['higher_priority_candidate', 'original_bidder']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('released'),
      releasedByMemberId: z.number().int().positive(),
      reason: z.enum(['declined', 'unreachable', 'withdrawn', 'ineligible_on_recheck']),
    })
    .strict(),
]);

/**
 * A self-contained, sanitized summary that lets an admin client discard its
 * stale React state and refetch the guarded synthetic state. It is neither an
 * operational Bid command nor a source of policy semantics.
 */
export const SyntheticSpecialtyControlStateSchema = z
  .object({
    rehearsalRevision: z.number().int().nonnegative().nullable(),
    normalTurn: SyntheticSpecialtyNormalTurnSchema.nullable(),
    normalBidderSuspended: z.boolean(),
    specialty: z
      .object({
        active: z.boolean(),
        requestId: z.string().min(1).max(160).nullable(),
        positionId: z.string().min(1).max(160).nullable(),
        phase: z
          .enum([
            'resolving_higher_priority_candidates',
            'awaiting_original_bidder',
            'awaiting_resume',
          ])
          .nullable(),
        originalTurn: SyntheticSpecialtyNormalTurnSchema.nullable(),
        candidateQueue: z.array(SyntheticSpecialtyCandidateSchema),
        candidateCursor: z.number().int().nonnegative(),
        resolvedCandidateCount: z.number().int().nonnegative(),
        resolution: SyntheticSpecialtyResolutionSchema.nullable(),
        allowedNextAction: z.enum([
          'begin',
          'resolve_candidate',
          'resolve_original',
          'resume',
          'none',
        ]),
      })
      .strict(),
  })
  .strict();
export type SyntheticSpecialtyControlState = z.infer<typeof SyntheticSpecialtyControlStateSchema>;

/**
 * An admin-only state signal for the isolated synthetic specialty rehearsal.
 * It is intentionally not a BidEventEnvelope: specialty state has its own
 * durable revision and must never consume or imitate the normal Bid event
 * sequence. The control state gives a reconnecting client enough information
 * to invalidate local UI state before it rehydrates the complete state through
 * the separately guarded admin endpoint.
 */
export const SyntheticSpecialtyStateSignalSchema = z
  .object({
    v: z.literal(1),
    type: z.literal('synthetic_specialty_state_changed'),
    mode: z.literal('synthetic_test_only'),
    does_not_commit_bid: z.literal(true),
    bidSessionId: z.string().min(1).max(160),
    revision: z.number().int().nonnegative(),
    controlState: SyntheticSpecialtyControlStateSchema,
  })
  .strict();
export type SyntheticSpecialtyStateSignal = z.infer<typeof SyntheticSpecialtyStateSignalSchema>;

export const ResyncEventSchema = z.object({
  reason: z.enum(['version_skew', 'do_restart', 'seq_gap']),
  lastSeq: z.number().int().nonnegative(),
});
export type ResyncEvent = z.infer<typeof ResyncEventSchema>;

export const EVENT_TYPES = [
  'state_snapshot',
  'pick_made',
  'pick_rejected',
  'skip',
  'forced_pick',
  'freeze',
  'resync',
  'pong',
  // Plan 07: Phase 2 (A-Day) events
  'phase_changed',
  'a_day_pick_made',
  'forced_a_day_pick_made',
  'a_day_reject',
  'live_command_applied',
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const BidEventEnvelopeSchema = z.object({
  v: z.literal(BID_EVENT_VERSION),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  type: EventTypeSchema,
  payload: z.unknown(),
});
export type BidEventEnvelope = z.infer<typeof BidEventEnvelopeSchema>;
