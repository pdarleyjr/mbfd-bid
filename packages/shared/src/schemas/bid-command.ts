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
