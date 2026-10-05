import { z } from 'zod';
import { ADayValueSchema } from './a-day.js';
import type { BidEventEnvelope } from './bid-events.js';
import { BidCommandNoteSchema, BidOperationNoteSchema } from './bid-operation-note.js';
import { BidPoolSelectionSchema } from './bid-opportunity-pool.js';

const CommandIdSchema = z.string().uuid();
const ExpectedSeqSchema = z.number().int().nonnegative();
const ReasonSchema = BidCommandNoteSchema;
/** Explicit operator acknowledgement; the server derives and rechecks every
 * warning against the canonical sequence and immutable session evidence. */
export const AdminBidOverrideSchema = z
  .object({
    acknowledged: z.literal(true),
    warningCodes: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .refine((codes) => new Set(codes).size === codes.length),
  })
  .strict();
export type AdminBidOverride = z.infer<typeof AdminBidOverrideSchema>;
const FallbackSelectionSchema = z
  .object({ policyId: z.string().min(1), tierId: z.string().min(1) })
  .strict();
export const TermDepartureElectionSchema = z
  .object({
    assignmentId: z.string().trim().min(1).max(256),
    memberConfirmed: z.literal(true),
    evidenceReference: z.string().trim().min(4).max(500),
  })
  .strict();
export type TermDepartureElection = z.infer<typeof TermDepartureElectionSchema>;

/**
 * Browser-facing input for the rehearsal-only freeze command. The authenticated
 * actor, session identity, version, and command type are assigned by the
 * Worker adapter rather than trusted from a client body.
 */
export const MockFreezeRequestSchema = z
  .object({
    expectedSeq: ExpectedSeqSchema,
    reason: ReasonSchema,
  })
  .strict();
export type MockFreezeRequest = z.infer<typeof MockFreezeRequestSchema>;

/**
 * Internal command envelope passed from the authenticated Worker adapter to
 * the named BidSession Durable Object. This is deliberately scoped to a mock
 * rehearsal; it is not a live-session command contract.
 */
export const MockFreezeCommandSchema = z
  .object({
    v: z.literal(1),
    type: z.literal('mock.freeze'),
    commandId: CommandIdSchema,
    bidSessionId: z.string().min(1),
    expectedSeq: ExpectedSeqSchema,
    actor: z
      .object({
        id: z.number().int().nonnegative(),
        role: z.literal('admin'),
      })
      .strict(),
    reason: ReasonSchema,
  })
  .strict();
export type MockFreezeCommand = z.infer<typeof MockFreezeCommandSchema>;

export const MOCK_FREEZE_COMMAND_REJECT_CODES = [
  'STALE_SEQUENCE',
  'SESSION_FROZEN',
  'COMMAND_ID_REUSED',
  'SESSION_ID_MISMATCH',
  'NOT_A_MOCK_SESSION',
  'LEGACY_STATE_REQUIRES_IMPORT',
  'LEGACY_A_DAY_STATE_REQUIRES_IMPORT',
] as const;
export type MockFreezeCommandRejectCode = (typeof MOCK_FREEZE_COMMAND_REJECT_CODES)[number];

export type MockFreezeCommandResult =
  | {
      kind: 'accepted';
      commandId: string;
      seq: number;
      envelope: BidEventEnvelope;
    }
  | {
      kind: 'rejected';
      commandId: string;
      code: MockFreezeCommandRejectCode;
      currentSeq: number;
    };

/**
 * The shared mutating envelope for Mock and Real sessions. The browser supplies a
 * command id and sequence expectation; the authenticated Worker adapter owns
 * the actor and never accepts it from the browser.  `evidenceReference` is an
 * opaque provenance pointer, not copied evidence or a source-system payload.
 */
const LiveCommandBase = z.object({
  v: z.literal(1),
  commandId: CommandIdSchema,
  bidSessionId: z.string().min(1),
  expectedSeq: ExpectedSeqSchema,
  /** Bind confirmation to the reviewed scoring source even when its adoption
   * leaves the canonical sequence and recorded selections unchanged. */
  expectedScoreReceiptSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  actor: z.object({ id: z.number().int().positive(), role: z.literal('admin') }).strict(),
  reason: ReasonSchema,
  evidenceReference: z.string().trim().min(1).max(200).nullable(),
});

export const LiveBidCommandSchema = z.discriminatedUnion('type', [
  LiveCommandBase.extend({
    type: z.literal('live.record_selection'),
    adminOverride: AdminBidOverrideSchema.optional(),
    /** Explicit chief-directed placement, reviewed under the existing force grant. */
    forced: z.literal(true).optional(),
    membershipIds: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    termDeparture: TermDepartureElectionSchema.optional(),
    pool: BidPoolSelectionSchema.optional(),
    fallback: FallbackSelectionSchema.optional(),
    aDay: ADayValueSchema.optional(),
    memberId: z.number().int().positive(),
    positionId: z.string().min(1),
    /** Frozen sheet provenance only; it never changes a command into auto-award. */
    preferenceSheetId: z.string().min(1).nullable().optional(),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.amend_selection'),
    membershipIds: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length)
      .optional(),
    termDeparture: TermDepartureElectionSchema.optional(),
    pool: BidPoolSelectionSchema.optional(),
    aDay: ADayValueSchema.optional(),
    memberId: z.number().int().positive(),
    fromPositionId: z.string().min(1),
    toPositionId: z.string().min(1),
  }).strict(),
  /** Compensating correction; the accepted source receipt and active award
   * are validated by the canonical boundary. Uses the existing amendment grant. */
  LiveCommandBase.extend({
    type: z.literal('live.correct_bid'),
    adminOverride: AdminBidOverrideSchema.optional(),
    /** An explicitly forced replacement retains the existing force grant. */
    forced: z.literal(true).optional(),
    // Corrections historically trimmed their note before receipt hashing.
    reason: BidOperationNoteSchema,
    memberId: z.number().int().positive(),
    originalCommandId: CommandIdSchema,
    originalBidId: z.string().min(1),
    originalPositionId: z.string().min(1),
    originalADayCommandId: CommandIdSchema.nullable(),
    operation: z.enum(['REPLACE', 'REVOKE']),
    termDeparture: TermDepartureElectionSchema.optional(),
    pool: BidPoolSelectionSchema.optional(),
    replacement: z
      .object({
        positionId: z.string().min(1),
        aDay: ADayValueSchema.nullable(),
        membershipIds: z
          .array(z.string().trim().min(1).max(80))
          .max(20)
          .refine((ids) => new Set(ids).size === ids.length)
          .optional(),
      })
      .strict()
      .nullable(),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.disposition'),
    disposition: z.enum(['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE']),
    memberId: z.number().int().positive().optional(),
    deferStageId: z.string().trim().min(1).max(160).optional(),
    adminOverride: AdminBidOverrideSchema.optional(),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.force_selection'),
    pool: BidPoolSelectionSchema.optional(),
    fallback: FallbackSelectionSchema.optional(),
    aDay: ADayValueSchema.optional(),
    memberId: z.number().int().positive(),
    positionId: z.string().min(1),
  }).strict(),
  /**
   * A Timeline-controlled A-Day choice is a canonical command of its own.
   * It carries the normal command envelope; the Worker owns identity,
   * authorization, sequence and frozen-policy validation.
   */
  LiveCommandBase.extend({
    type: z.literal('live.record_a_day'),
    adminOverride: AdminBidOverrideSchema.optional(),
    memberId: z.number().int().positive(),
    aDay: ADayValueSchema,
  }).strict(),
  LiveCommandBase.extend({ type: z.literal('live.pause') }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.record_fallback_response'),
    fallback: FallbackSelectionSchema,
    positionId: z.string().min(1),
    memberId: z.number().int().positive(),
    outcome: z.enum(['DECLINE', 'UNREACHABLE']),
  }).strict(),
  LiveCommandBase.extend({ type: z.literal('live.resume') }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.record_contact_attempt'),
    memberId: z.number().int().positive(),
    method: z.enum(['PHONE', 'TEXT']),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.declare_unreachable'),
    memberId: z.number().int().positive(),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.return_at_current_sequence'),
    memberId: z.number().int().positive(),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.checkpoint'),
    name: z.string().trim().min(1).max(160),
  }).strict(),
  LiveCommandBase.extend({ type: z.literal('live.complete_session') }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.transition_stage'),
    stageId: z.string().min(1),
    adminOverride: AdminBidOverrideSchema.optional(),
    completePriorStages: z.boolean().optional(),
    withdrawOpenPositionIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(2_000)
      .refine((ids) => new Set(ids).size === ids.length, 'Position IDs must be unique')
      .optional(),
    restoreOpenPositionIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(2_000)
      .refine((ids) => new Set(ids).size === ids.length, 'Position IDs must be unique')
      .optional(),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.alter_order'),
    adminOverride: AdminBidOverrideSchema.optional(),
    orderedRemainingMemberIds: z.array(z.number().int().positive()).min(1).max(2_000),
    /** Distinguishes a member's Days eligibility turn from their ordinary rank turn. */
    orderedRemainingTurns: z
      .array(
        z
          .object({
            memberId: z.number().int().positive(),
            stageId: z.string().trim().min(1).max(160).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2_000)
      .optional(),
  }).strict(),
  /** Candidate ids are injected by the Worker from frozen evidence, never accepted from a browser body. */
  LiveCommandBase.extend({
    type: z.literal('live.start_specialty_adjudication'),
    specialtyId: z.string().trim().min(1).max(80),
    positionId: z.string().trim().min(1).max(160),
    candidateMemberIds: z.array(z.number().int().positive()).min(1).max(2_000),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.resolve_specialty_candidate'),
    termDeparture: TermDepartureElectionSchema.optional(),
    /** A candidate may choose another open seat within the same frozen specialty. */
    positionId: z.string().trim().min(1).max(160).optional(),
    aDay: ADayValueSchema.optional(),
    memberId: z.number().int().positive(),
    outcome: z.enum(['ACCEPT', 'DECLINE', 'PASS', 'UNREACHABLE']),
  }).strict(),
  /** Session-only administrative duty; never a Bid award, promotion or staffing write. */
  LiveCommandBase.extend({
    type: z.literal('live.close_specialty_adjudication'),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.set_exceptional_assignment'),
    adminOverride: AdminBidOverrideSchema.optional(),
    memberId: z.number().int().positive(),
    operation: z.enum(['ASSIGN', 'RELEASE']),
    roleLabel: z.string().trim().min(4).max(160),
    positionId: z.string().trim().min(1).max(160).optional(),
    // Temporary-duty commands historically used a trimmed note as well.
    reason: BidOperationNoteSchema,
  }).strict(),
  /** Presentation mode never changes the execution phase or selection order. */
  LiveCommandBase.extend({
    type: z.literal('live.set_presentation_mode'),
    mode: z.enum(['OFF', 'LIVE', 'HOLD']),
  }).strict(),
]);
export type LiveBidCommand = z.infer<typeof LiveBidCommandSchema>;

export type LiveBidCommandResult =
  | { kind: 'accepted'; commandId: string; seq: number; envelope: BidEventEnvelope }
  | { kind: 'rejected'; commandId: string; code: string; currentSeq: number };
