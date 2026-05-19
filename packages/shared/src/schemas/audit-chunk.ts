// Plan 08 Task 4 — Audit chunk header.
//
// Each JSONL chunk in R2 begins with a single header line (a ChunkHeader)
// followed by one AuditEvent per line. The header carries:
//   - chunk_seq: monotone 1-based ordinal within the session
//   - prev_chunk_sha256: hex digest of the previous chunk's payload, or null
//     for the very first chunk in a session. This is the link in the chain.
//   - events_in_chunk: row count for fast verification.
//   - min_seq / max_seq: the AuditEvent.seq range covered by this chunk.
//   - signature / pubkey: ed25519 signature of the chunk payload, plus the
//     base64url-encoded public key so verifiers don't need an external lookup.
//   - signed_at: RFC 3339 timestamp at flush time.

import { z } from 'zod';

export const ChunkHeaderSchema = z.object({
  chunk_seq: z.number().int().nonnegative(),
  prev_chunk_sha256: z.string().length(64).nullable(),
  events_in_chunk: z.number().int().positive(),
  min_seq: z.number().int().nonnegative(),
  max_seq: z.number().int().nonnegative(),
  signature: z.string().min(1),
  pubkey: z.string().min(1),
  signed_at: z.string().min(1),
});
export type ChunkHeader = z.infer<typeof ChunkHeaderSchema>;
