// Plan 08 Task 5 — SHA-256 hash chain.
//
//   chunk_hash[0] = SHA-256(0x00 || canonical_json(events))
//   chunk_hash[k] = SHA-256(hexToBytes(chunk_hash[k-1]) || canonical_json(events))
//
// The single-byte 0x00 sentinel for the genesis chunk distinguishes "no
// previous chunk" from a hypothetical chunk whose prev hash happens to be 32
// zero bytes — without the sentinel those would collide.
//
// Crypto choice: `@noble/hashes` is pure JS, audited, and works on the
// Cloudflare Workers runtime (Node's `crypto` is not always compatible).

import type { AuditEvent } from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { type JsonValue, canonicalize } from './canonical-json.js';

/** Sentinel marking the head of a session's chain. Used in chunk headers. */
export const GENESIS_PREV: string | null = null;

/** Single-byte 0x00 marker prepended only for the genesis chunk. */
const GENESIS_SENTINEL = new Uint8Array([0x00]);

/**
 * Compute the SHA-256 over (prev-bytes || canonical-json(events)).
 *
 * - `prev` is the previous chunk's hex digest, or `null` for the genesis
 *   chunk. The function picks the sentinel automatically.
 * - `events` is the ordered list of `AuditEvent`s that make up this chunk;
 *   order is significant — the canonicalizer preserves array order.
 *
 * Returns a 64-char lowercase hex string.
 */
export function computeChunkHash(prev: string | null, events: AuditEvent[]): string {
  if (events.length === 0) throw new Error('Cannot hash empty events array');
  const prevBytes = prev === null ? GENESIS_SENTINEL : hexToBytes(prev);
  const payload = canonicalize(events as unknown as JsonValue);
  const payloadBytes = new TextEncoder().encode(payload);
  const combined = new Uint8Array(prevBytes.length + payloadBytes.length);
  combined.set(prevBytes, 0);
  combined.set(payloadBytes, prevBytes.length);
  return bytesToHex(sha256(combined));
}
