// Plan 08 Task 10 — Audit chain verifier.
//
// Streams R2 chunks for a given (year, session) in seq order, validates the
// header, replays the hash chain, and verifies each chunk's ed25519 signature
// against its embedded pubkey. Returns a structured VerifyResult — useful as
// JSON for the /admin/audit/verify-chain endpoint and as a programmatic check
// for end-to-end tests.

import type { R2Bucket } from '@cloudflare/workers-types';
import { type AuditEvent, AuditEventSchema, ChunkHeaderSchema } from '@mbfd/shared';

import { computeChunkHash } from './hash-chain.js';
import { verifyChunkSignature } from './signer.js';

export interface VerifyResult {
  ok: boolean;
  /** Highest chunk_seq successfully verified (0 if none). */
  last_verified_seq: number;
  total_events_verified: number;
  failed_at_chunk?: number;
  reason?: string;
}

function fail(
  lastSeq: number,
  totalEvents: number,
  failedAtChunk: number,
  reason: string,
): VerifyResult {
  return {
    ok: false,
    last_verified_seq: lastSeq,
    total_events_verified: totalEvents,
    failed_at_chunk: failedAtChunk,
    reason,
  };
}

export async function verifyChain(
  r2: R2Bucket,
  bidSessionId: string,
  year: number,
): Promise<VerifyResult> {
  const prefix = `${year}/${bidSessionId}/chunks/`;
  const listed = await r2.list({ prefix });
  const keys = listed.objects.map((o) => o.key).sort((a, b) => a.localeCompare(b));

  if (keys.length === 0) {
    return { ok: true, last_verified_seq: 0, total_events_verified: 0 };
  }

  let prevHash: string | null = null;
  let lastSeq = 0;
  let totalEvents = 0;

  for (let i = 0; i < keys.length; i++) {
    const expectedSeq = i + 1;
    const expectedKey = `${prefix}${String(expectedSeq).padStart(4, '0')}.jsonl`;
    const k = keys[i];
    if (k !== expectedKey) {
      return fail(
        lastSeq,
        totalEvents,
        expectedSeq,
        `missing chunk: expected ${expectedKey}, found ${k ?? 'none'}`,
      );
    }
    const obj = await r2.get(k);
    if (!obj) {
      return fail(lastSeq, totalEvents, expectedSeq, `missing chunk body for ${k}`);
    }
    const txt = await obj.text();
    const lines = txt.trim().split('\n');
    if (lines.length < 2) {
      return fail(lastSeq, totalEvents, expectedSeq, 'chunk has no events');
    }
    const headerLine = lines[0] as string;
    let headerJson: unknown;
    try {
      headerJson = JSON.parse(headerLine);
    } catch (err) {
      return fail(
        lastSeq,
        totalEvents,
        expectedSeq,
        `invalid chunk header JSON: ${(err as Error).message}`,
      );
    }
    const headerParsed = ChunkHeaderSchema.safeParse(headerJson);
    if (!headerParsed.success) {
      return fail(
        lastSeq,
        totalEvents,
        expectedSeq,
        `invalid chunk header: ${headerParsed.error.message}`,
      );
    }
    const header = headerParsed.data;
    if (header.chunk_seq !== expectedSeq) {
      return fail(
        lastSeq,
        totalEvents,
        expectedSeq,
        `chunk_seq mismatch: header says ${header.chunk_seq}, expected ${expectedSeq}`,
      );
    }
    if (header.prev_chunk_sha256 !== prevHash) {
      return fail(lastSeq, totalEvents, expectedSeq, 'prev_chunk_sha256 mismatch (chain broken)');
    }
    const events: AuditEvent[] = [];
    for (let li = 1; li < lines.length; li++) {
      let eventJson: unknown;
      try {
        eventJson = JSON.parse(lines[li] as string);
      } catch (err) {
        return fail(
          lastSeq,
          totalEvents,
          expectedSeq,
          `event ${li} invalid JSON: ${(err as Error).message}`,
        );
      }
      const p = AuditEventSchema.safeParse(eventJson);
      if (!p.success) {
        return fail(
          lastSeq,
          totalEvents,
          expectedSeq,
          `event ${li} fails schema: ${p.error.message}`,
        );
      }
      events.push(p.data);
    }
    if (events.length !== header.events_in_chunk) {
      return fail(
        lastSeq,
        totalEvents,
        expectedSeq,
        `events_in_chunk header says ${header.events_in_chunk}, body has ${events.length}`,
      );
    }
    const computed = computeChunkHash(prevHash, events);
    const sigOk = await verifyChunkSignature(computed, header.signature, header.pubkey);
    if (!sigOk) {
      return fail(lastSeq, totalEvents, expectedSeq, 'signature does not verify (chunk tampered)');
    }
    prevHash = computed;
    lastSeq = expectedSeq;
    totalEvents += events.length;
  }

  return { ok: true, last_verified_seq: lastSeq, total_events_verified: totalEvents };
}
