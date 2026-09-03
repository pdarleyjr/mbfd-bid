import { z } from 'zod';
import type { BidEventEnvelope } from './bid-events.js';

const CommandIdSchema = z.string().uuid();
const ExpectedSeqSchema = z.number().int().nonnegative();
const ReasonSchema = z.string().min(1).max(500);

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
 * The only mutating envelope for a real session.  The browser supplies a
 * command id and sequence expectation; the authenticated Worker adapter owns
 * the actor and never accepts it from the browser.  `evidenceReference` is an
 * opaque provenance pointer, not copied evidence or a source-system payload.
 */
const LiveCommandBase = z.object({
  v: z.literal(1),
  commandId: CommandIdSchema,
  bidSessionId: z.string().min(1),
  expectedSeq: ExpectedSeqSchema,
  actor: z.object({ id: z.number().int().positive(), role: z.literal('admin') }).strict(),
  reason: ReasonSchema,
  evidenceReference: z.string().trim().min(1).max(200).nullable(),
});

export const LiveBidCommandSchema = z.discriminatedUnion('type', [
  LiveCommandBase.extend({
    type: z.literal('live.record_selection'),
    memberId: z.number().int().positive(),
    positionId: z.string().min(1),
    /** Frozen sheet provenance only; it never changes a command into auto-award. */
    preferenceSheetId: z.string().min(1).nullable().optional(),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.amend_selection'),
    memberId: z.number().int().positive(),
    fromPositionId: z.string().min(1),
    toPositionId: z.string().min(1),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.disposition'),
    disposition: z.enum(['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE']),
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.force_selection'),
    memberId: z.number().int().positive(),
    positionId: z.string().min(1),
  }).strict(),
  LiveCommandBase.extend({ type: z.literal('live.pause') }).strict(),
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
  }).strict(),
  LiveCommandBase.extend({
    type: z.literal('live.alter_order'),
    orderedRemainingMemberIds: z.array(z.number().int().positive()).min(1).max(2_000),
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
    memberId: z.number().int().positive(),
    outcome: z.enum(['ACCEPT', 'DECLINE', 'PASS', 'UNREACHABLE']),
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
