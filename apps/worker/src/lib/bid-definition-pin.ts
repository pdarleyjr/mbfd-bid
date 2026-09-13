import { type BidSessionPolicySnapshot, BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { z } from 'zod';

const Identity = z
  .string()
  .min(1)
  .refine((value) => value === value.trim());
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const BidYear = z.number().int().min(2024).max(2100);

/** New V3 body metadata. The exact-byte snapshot digest belongs only in the row:
 * putting it inside the hashed body would create a self-referential digest. */
export const BidDefinitionSnapshotPinSchema = z
  .object({
    v: z.literal(1),
    bidSessionId: Identity,
    bidYear: BidYear,
    versionId: Identity,
    versionSha256: Digest,
    contextSha256: Digest,
  })
  .strict();
export type BidDefinitionSnapshotPin = z.infer<typeof BidDefinitionSnapshotPinSchema>;

/** SQL adapters must explicitly select all four columns. Undefined/omitted is
 * not NULL and must never turn an incomplete adapter into a legacy assertion. */
export const BidDefinitionSnapshotColumnsSchema = z
  .object({
    bidVersionId: Identity.nullable(),
    bidVersionSha256: Digest.nullable(),
    snapshotSha256: Digest.nullable(),
    contextSha256: Digest.nullable(),
  })
  .strict();
export type BidDefinitionSnapshotColumns = z.infer<typeof BidDefinitionSnapshotColumnsSchema>;

export interface BidDefinitionSnapshotRow extends BidDefinitionSnapshotColumns {
  bidSessionId: string;
  bidYear: number;
  ruleBookVersion: string;
  positionTemplateVersion: string;
  ruleBookRevision: number | null;
  capturedAtMs: number;
  snapshotJson: string;
}

/** Identity supplied by the immutable-version loader, selected by the stored
 * version ID. This primitive does not authenticate the version content itself. */
export const FrozenBidDefinitionIdentitySchema = z.object({
  id: Identity,
  bidYear: BidYear,
  contentSha256: Digest,
  ruleBookVersion: Identity,
  ruleBookRevision: z.number().int().nonnegative(),
  positionTemplateVersion: Identity,
});
export type FrozenBidDefinitionIdentity = z.infer<typeof FrozenBidDefinitionIdentitySchema>;

export type PinnedBidSessionPolicySnapshot = Extract<BidSessionPolicySnapshot, { v: 3 }> & {
  bidDefinition: BidDefinitionSnapshotPin;
};

export type BidDefinitionPinFailureReason =
  | 'pin_columns_invalid'
  | 'pin_columns_incomplete'
  | 'snapshot_json_invalid'
  | 'legacy_body_has_pin'
  | 'snapshot_schema_invalid'
  | 'snapshot_row_mismatch'
  | 'snapshot_digest_mismatch'
  | 'body_pin_invalid'
  | 'body_pin_mismatch'
  | 'version_identity_missing'
  | 'version_identity_invalid'
  | 'version_identity_mismatch'
  | 'context_digest_mismatch';

export type BidDefinitionPinValidation =
  | { ok: true; kind: 'legacy'; snapshot: BidSessionPolicySnapshot; bidDefinition: null }
  | {
      ok: true;
      kind: 'pinned';
      snapshot: PinnedBidSessionPolicySnapshot;
      bidDefinition: BidDefinitionSnapshotPin;
      contextDigestChecked: boolean;
    }
  | {
      ok: false;
      code: 'session_policy_snapshot_invalid' | 'session_policy_snapshot_integrity_invalid';
      reason: BidDefinitionPinFailureReason;
    };

/** SHA-256 of the exact UTF-8 JSON bytes, without parse/stringify normalization. */
export function bidSnapshotSha256(serialized: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

function failure(
  reason: BidDefinitionPinFailureReason,
  legacy = false,
): Extract<BidDefinitionPinValidation, { ok: false }> {
  return {
    ok: false,
    code: legacy ? 'session_policy_snapshot_invalid' : 'session_policy_snapshot_integrity_invalid',
    reason,
  };
}

function matchesSnapshotRow(
  snapshot: BidSessionPolicySnapshot,
  row: BidDefinitionSnapshotRow,
  expectedBidSessionId: string,
) {
  return (
    row.bidSessionId === expectedBidSessionId &&
    snapshot.ruleBookVersion === row.ruleBookVersion &&
    snapshot.positionTemplateVersion === row.positionTemplateVersion &&
    snapshot.capturedAtMs === row.capturedAtMs &&
    (snapshot.v === 1
      ? row.ruleBookRevision === null
      : snapshot.ruleBookRevision === row.ruleBookRevision)
  );
}

/** Validate BEFORE loading/projecting canonical state. This is a pure structural
 * and snapshot-byte guard, not Live readiness or complete policy integrity.
 * The caller must authenticate immutable version content/material and recompute
 * the runtime context. It may supply that independently computed context digest
 * here; contextDigestChecked records whether this additional check happened.
 * No current head, mutable Department reads, provenance backfill, or writes. */
export function validateBidDefinitionSnapshotPin(input: {
  row: BidDefinitionSnapshotRow;
  expectedBidSessionId: string;
  version: FrozenBidDefinitionIdentity | null;
  expectedContextSha256?: string;
}): BidDefinitionPinValidation {
  const { row } = input;
  const columns = BidDefinitionSnapshotColumnsSchema.safeParse({
    bidVersionId: row.bidVersionId,
    bidVersionSha256: row.bidVersionSha256,
    snapshotSha256: row.snapshotSha256,
    contextSha256: row.contextSha256,
  });
  if (!columns.success) return failure('pin_columns_invalid');
  const nullCount = Object.values(columns.data).filter((value) => value === null).length;
  if (nullCount !== 0 && nullCount !== 4) return failure('pin_columns_incomplete');
  const legacy = nullCount === 4;
  let body: unknown;
  try {
    body = JSON.parse(row.snapshotJson);
  } catch {
    return failure('snapshot_json_invalid', legacy);
  }
  const object = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (legacy) {
    if (object !== null && Object.hasOwn(object, 'bidDefinition'))
      return failure('legacy_body_has_pin');
    // Preserve the existing strict V1/V2/V3 parse, including its refinements and
    // defaults. The caller's original serialized bytes are never rewritten.
    const parsed = BidSessionPolicySnapshotSchema.safeParse(body);
    if (!parsed.success) return failure('snapshot_schema_invalid', true);
    if (!matchesSnapshotRow(parsed.data, row, input.expectedBidSessionId))
      return failure('snapshot_row_mismatch', true);
    return { ok: true, kind: 'legacy', snapshot: parsed.data, bidDefinition: null };
  }
  if (bidSnapshotSha256(row.snapshotJson) !== row.snapshotSha256)
    return failure('snapshot_digest_mismatch');
  if (object === null || !('bidDefinition' in object)) return failure('body_pin_invalid');
  const { bidDefinition: rawPin, ...snapshotBody } = object;
  const pin = BidDefinitionSnapshotPinSchema.safeParse(rawPin);
  if (!pin.success) return failure('body_pin_invalid');
  const parsed = BidSessionPolicySnapshotSchema.safeParse(snapshotBody);
  if (!parsed.success || parsed.data.v !== 3) return failure('snapshot_schema_invalid');
  if (!matchesSnapshotRow(parsed.data, row, input.expectedBidSessionId))
    return failure('snapshot_row_mismatch');
  if (
    pin.data.bidSessionId !== row.bidSessionId ||
    pin.data.bidYear !== row.bidYear ||
    pin.data.versionId !== row.bidVersionId ||
    pin.data.versionSha256 !== row.bidVersionSha256 ||
    pin.data.contextSha256 !== row.contextSha256
  )
    return failure('body_pin_mismatch');
  if (input.version === null) return failure('version_identity_missing');
  const version = FrozenBidDefinitionIdentitySchema.safeParse(input.version);
  if (!version.success) return failure('version_identity_invalid');
  if (
    version.data.id !== row.bidVersionId ||
    version.data.bidYear !== row.bidYear ||
    version.data.contentSha256 !== row.bidVersionSha256 ||
    version.data.ruleBookVersion !== row.ruleBookVersion ||
    version.data.ruleBookRevision !== row.ruleBookRevision ||
    version.data.positionTemplateVersion !== row.positionTemplateVersion
  )
    return failure('version_identity_mismatch');
  if (
    input.expectedContextSha256 !== undefined &&
    (!Digest.safeParse(input.expectedContextSha256).success ||
      input.expectedContextSha256 !== row.contextSha256)
  )
    return failure('context_digest_mismatch');
  return {
    ok: true,
    kind: 'pinned',
    snapshot: { ...parsed.data, bidDefinition: pin.data },
    bidDefinition: pin.data,
    contextDigestChecked: input.expectedContextSha256 !== undefined,
  };
}
