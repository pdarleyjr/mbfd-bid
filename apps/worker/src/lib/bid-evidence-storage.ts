import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { Inflate, deflate } from 'pako';
import { z } from 'zod';

const FORMAT = 'mbfd-bid-evidence-deflate-v1';
const MAX_DOCUMENT_BYTES = 32_000_000;
const Envelope = z
  .object({
    format: z.literal(FORMAT),
    uncompressedBytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    data: z
      .string()
      .max(1_900_000)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();

function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(''));
}

/** Keep the exact canonical document and its existing digest while fitting
 * the immutable capture into D1's two-million-byte row limit. Small legacy
 * documents remain readable without conversion or a database migration. */
export function encodeBidEvidenceDocument(json: string) {
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('bid_evidence_document_too_large');
  if (bytes.length < 128_000) return json;
  return JSON.stringify(
    Envelope.parse({
      format: FORMAT,
      uncompressedBytes: bytes.length,
      sha256: bytesToHex(sha256(bytes)),
      data: base64(deflate(bytes)),
    }),
  );
}

/** Bound decompression before collecting the complete document. The caller
 * still checks canonical content and all immutable evidence digests. */
export function decodeBidEvidenceDocument(stored: string) {
  const value: unknown = JSON.parse(stored);
  if (typeof value !== 'object' || value === null || !('format' in value)) return stored;
  const envelope = Envelope.parse(value);
  const compressed = Uint8Array.from(atob(envelope.data), (character) => character.charCodeAt(0));
  const chunks: string[] = [];
  let decodedBytes = 0;
  const inflater = new Inflate({ to: 'string', chunkSize: 64 * 1024 });
  inflater.onData = (chunk: unknown) => {
    if (typeof chunk !== 'string') throw new Error('bid_evidence_document_encoding_invalid');
    const text = chunk;
    decodedBytes += new TextEncoder().encode(text).length;
    if (decodedBytes > envelope.uncompressedBytes)
      throw new Error('bid_evidence_document_size_invalid');
    chunks.push(text);
  };
  inflater.push(compressed, true);
  if (inflater.err || decodedBytes !== envelope.uncompressedBytes)
    throw new Error('bid_evidence_document_size_invalid');
  const json = chunks.join('');
  if (bytesToHex(sha256(new TextEncoder().encode(json))) !== envelope.sha256)
    throw new Error('bid_evidence_document_integrity_failed');
  return json;
}
