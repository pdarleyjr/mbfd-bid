import {
  type BidSessionPolicySnapshot,
  BidSessionPolicySnapshotSchema,
  FrozenScoreReferenceEvidenceSchema,
} from '@mbfd/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import type { DB } from '../db/index.js';
import { bidContentHash } from './bid-definition-content.js';
import type { BidFormArchive, PublishedRankList } from './bid-form-source.js';

type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
export const RANK_SOURCE_OPERATION = 'bid-final-rank-source';
export const RankSourceRequestSchema = z
  .object({
    archiveSha256: Digest,
    expectedSnapshotSha256: Digest,
    expectedVersionSha256: Digest,
    expectedCanonicalSeq: z.number().int().safe().nonnegative().optional(),
    expectedCanonicalStateSha256: Digest.optional(),
  })
  .strict()
  .refine(
    (request) =>
      (request.expectedCanonicalSeq === undefined) ===
      (request.expectedCanonicalStateSha256 === undefined),
    {
      message: 'An active checkpoint requires both sequence and state digest',
    },
  );
const ActiveCheckpointSchema = z
  .object({
    phase: z.literal('position_bid'),
    canonicalSeq: z.number().int().safe().nonnegative(),
    canonicalStateSha256: Digest,
  })
  .strict();
const RecordSchema = z
  .object({
    v: z.literal(1),
    year: z.number().int().min(2000).max(2200),
    sessionId: z.string().min(1).max(200),
    versionId: z.string().min(1).max(200),
    versionSha256: Digest,
    baseSnapshotSha256: Digest,
    archiveSha256: Digest,
    appliedBy: z.string().min(1).max(200),
    appliedAt: z.number().int().positive(),
    activeCheckpoint: ActiveCheckpointSchema.optional(),
    members: z
      .array(
        z
          .object({
            memberId: z.number().int().positive(),
            employeeId: z.string().min(1).max(80),
            scoreReferenceEvidence: z.array(FrozenScoreReferenceEvidenceSchema).min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
const ReceiptSchema = z.object({ record: RecordSchema, sha256: Digest }).strict();
export type RankSourceRecord = z.infer<typeof RecordSchema>;
export type RankSourceReceipt = z.infer<typeof ReceiptSchema>;
const canonical = (value: unknown) => canonicalize(value as JsonValue);
export const rankSourceKey = (sessionId: string, archiveSha256: string) =>
  `bid-final-rank-source:${sessionId}:${archiveSha256}`;

/** Capture validated progress without exposing or rewriting any selections.
 * The raw bytes remain server-owned for the final transactional write guard. */
export async function loadActiveRankCheckpoint(database: D1Database, sessionId: string) {
  const row = await database
    .prepare(`SELECT c.current_seq,c.state_json,p.snapshot_json
    FROM canonical_bid_session_state c
    JOIN bid_session_policy_snapshots p ON p.bid_session_id=c.bid_session_id
    WHERE c.bid_session_id=?`)
    .bind(sessionId)
    .first<{ current_seq: number; state_json: string; snapshot_json: string }>();
  if (!row) return { ok: false as const, error: 'rank_source_active_state_invalid' };
  const state = await loadCanonicalBidSessionState(database, sessionId);
  const { bidDefinition: _pin, ...material } = JSON.parse(row.snapshot_json);
  const snapshot = BidSessionPolicySnapshotSchema.parse(material);
  // Canonical commands advance the bidder without rewriting the legacy session
  // projection. Membership and pool come from canonical progress and its pin.
  const currentRows = state?.bidOrder.filter((entry) => entry.memberId === state.currentBidderId);
  const currentMembers = snapshot.members.filter(
    (member) => member.memberId === state?.currentBidderId,
  );
  if (
    !state ||
    state.lastSeq !== row.current_seq ||
    canonical(state) !== canonical(JSON.parse(row.state_json)) ||
    state.currentPhase !== 'position_bid' ||
    (state.currentBidderId !== null &&
      (currentRows?.length !== 1 ||
        currentMembers.length !== 1 ||
        currentRows[0]?.pool !== currentMembers[0]?.pool)) ||
    state.frozenAt !== null ||
    state.turnPausedAtMs != null ||
    !state.live ||
    state.live.pausedPhase !== null
  )
    return { ok: false as const, error: 'rank_source_active_state_invalid' };
  if (state.live.specialty != null)
    return { ok: false as const, error: 'rank_source_specialty_in_progress' };
  return {
    ok: true as const,
    checkpoint: ActiveCheckpointSchema.parse({
      phase: 'position_bid',
      canonicalSeq: row.current_seq,
      canonicalStateSha256: bidContentHash(row.state_json),
    }),
    stateJson: row.state_json,
  };
}

type Stored = {
  idempotency_key: string;
  actor_subject: string;
  response_json: string;
  operation: string;
  created_at: number;
};
function validateStored(row: Stored): RankSourceReceipt {
  const receipt = ReceiptSchema.parse(JSON.parse(row.response_json));
  if (
    row.operation !== RANK_SOURCE_OPERATION ||
    row.idempotency_key !== rankSourceKey(receipt.record.sessionId, receipt.record.archiveSha256) ||
    row.actor_subject !== receipt.record.appliedBy ||
    row.created_at !== receipt.record.appliedAt ||
    bidContentHash(canonical(receipt.record)) !== receipt.sha256
  )
    throw new Error('rank_source_receipt_integrity_failed');
  return receipt;
}

export async function loadSessionRankSource(db: DB, sessionId: string) {
  const row =
    await db.get<Stored>(sql`SELECT idempotency_key,actor_subject,response_json,operation,created_at
    FROM admin_configuration_receipts WHERE operation=${RANK_SOURCE_OPERATION}
    AND json_extract(response_json,'$.record.sessionId')=${sessionId}
    ORDER BY created_at DESC,idempotency_key DESC LIMIT 1`);
  return row ? validateStored(row) : null;
}

export async function loadVersionRankSource(
  db: DB,
  year: number,
  versionId: string,
  versionSha256: string,
) {
  const row =
    await db.get<Stored>(sql`SELECT idempotency_key,actor_subject,response_json,operation,created_at
    FROM admin_configuration_receipts WHERE operation=${RANK_SOURCE_OPERATION}
    AND json_extract(response_json,'$.record.year')=${year}
    AND json_extract(response_json,'$.record.versionId')=${versionId}
    AND json_extract(response_json,'$.record.versionSha256')=${versionSha256}
    ORDER BY created_at DESC,idempotency_key DESC LIMIT 1`);
  return row ? validateStored(row) : null;
}

/** Apply scoring facts only. The original snapshot/pins are validated by the
 * caller first; its directory, qualifications, rules, seats and progress remain
 * intact. New runs serialize these facts into their own original snapshot. */
export function applyRankSource(
  snapshot: Snapshot,
  receipt: RankSourceReceipt,
  prospectiveVersion?: { versionId: string; versionSha256: string },
): Snapshot {
  const { record } = receipt;
  const pin =
    'bidDefinition' in snapshot
      ? (snapshot.bidDefinition as { versionId: string; versionSha256: string })
      : prospectiveVersion;
  if (
    bidContentHash(canonical(record)) !== receipt.sha256 ||
    pin?.versionId !== record.versionId ||
    pin?.versionSha256 !== record.versionSha256
  )
    throw new Error('rank_source_receipt_integrity_failed');
  const identities = new Map(
    (snapshot.operatorIdentityProjection ?? []).map((row) => [row.memberId, row]),
  );
  const scopes = new Set(snapshot.ruleBookMaterial.positions.map((row) => row.id));
  const evidence = new Map<number, RankSourceRecord['members'][number]>();
  for (const row of record.members) {
    if (
      evidence.has(row.memberId) ||
      identities.get(row.memberId)?.employeeId !== row.employeeId ||
      !snapshot.members.some((member) => member.memberId === row.memberId)
    )
      throw new Error('rank_source_identity_mismatch');
    const positions = new Set<string>();
    for (const reference of row.scoreReferenceEvidence) {
      for (const id of reference.positionIds) {
        if (!scopes.has(id) || positions.has(id)) throw new Error('rank_source_scope_mismatch');
        positions.add(id);
      }
    }
    evidence.set(row.memberId, row);
  }
  const { bidDefinition, ...material } = snapshot as Snapshot & { bidDefinition?: unknown };
  const derived = BidSessionPolicySnapshotSchema.parse({
    ...material,
    members: snapshot.members.map((member) => {
      const reviewed = evidence.get(member.memberId);
      if (!reviewed) return member;
      return { ...member, scoreReferenceEvidence: reviewed.scoreReferenceEvidence };
    }),
    scoreReferenceSource: {
      v: 1,
      archiveSha256: record.archiveSha256,
      receiptSha256: receipt.sha256,
      sourceVersionId: record.versionId,
    },
  }) as Snapshot;
  return bidDefinition === undefined ? derived : ({ ...derived, bidDefinition } as Snapshot);
}

export async function applyStoredSessionRankSource(
  db: DB,
  sessionId: string,
  snapshot: Snapshot,
  baseSnapshotSha256: string,
) {
  const receipt = await loadSessionRankSource(db, sessionId);
  if (!receipt) {
    if (snapshot.scoreReferenceSource) {
      const row =
        await db.get<Stored>(sql`SELECT idempotency_key,actor_subject,response_json,operation,created_at
        FROM admin_configuration_receipts WHERE operation=${RANK_SOURCE_OPERATION}
        AND json_extract(response_json,'$.sha256')=${snapshot.scoreReferenceSource.receiptSha256} LIMIT 1`);
      const inherited = row ? validateStored(row) : null;
      if (
        !inherited ||
        inherited.sha256 !== snapshot.scoreReferenceSource.receiptSha256 ||
        canonical(applyRankSource(snapshot, inherited)) !== canonical(snapshot)
      )
        throw new Error('rank_source_receipt_integrity_failed');
    } else if (snapshot.members.some((member) => member.scoreReferenceEvidence?.length)) {
      throw new Error('rank_source_receipt_integrity_failed');
    }
    return snapshot;
  }
  if (
    receipt.record.baseSnapshotSha256 !== baseSnapshotSha256 ||
    receipt.record.sessionId !== sessionId
  )
    throw new Error('rank_source_receipt_integrity_failed');
  return applyRankSource(snapshot, receipt);
}

// These are source document categories, scoped by exact executable profile,
// never station-name substrings or a guessed credential holding.
const anchors: Record<string, string> = {
  CAPTAIN_FIVE: 'A212',
  DRIVER_ENGINEER: 'A303',
  FIRE_INVESTIGATOR: 'A305',
  ORDINARY_FIREFIGHTER: 'A105',
  ORDINARY_LIEUTENANT: 'A102',
  PREVENTION_CAPTAIN: 'D101',
  PREVENTION_LIEUTENANT: 'D103',
  AIR_TECH: 'A203',
  STATION_TWO_CAPTAIN: 'A201',
  STATION_TWO_DRIVER_ENGINEER: 'A202',
  STATION_TWO_FIREFIGHTER: 'A204',
  STATION_TWO_LIEUTENANT: 'A205',
  MARINE_ENGINEER: 'A603',
  MARINE_OPERATOR: 'A602',
  MARINE_CAPTAIN: 'A601',
  MARINE_FIREFIGHTER: 'A604',
};
function number(_list: PublishedRankList, row: PublishedRankList['rows'][number], key: string) {
  const value = row.values[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('rank_source_numeric_value_invalid');
  return value;
}

export function buildRankSourceMembers(
  snapshot: Snapshot,
  archive: BidFormArchive,
): RankSourceRecord['members'] {
  if (archive.year !== 2026 || !archive.rankLists || archive.rankLists.length !== 16)
    throw new Error('rank_source_complete_final_lists_required');
  const identities = new Map(
    (snapshot.operatorIdentityProjection ?? []).map((row) => [row.employeeId, row]),
  );
  const members = new Map<number, RankSourceRecord['members'][number]>();
  const signature = (rule: Snapshot['ruleBookMaterial']['rules'][number]) =>
    canonical({
      required: JSON.parse(rule.requiredCriteriaJson),
      points: JSON.parse(rule.pointsPreferenceJson),
      tie: JSON.parse(rule.tieBreakChainJson),
    });
  const normalizedName = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  for (const list of archive.rankLists) {
    const anchor = snapshot.ruleBookMaterial.rules.find(
      (rule) => rule.positionId === anchors[list.listId],
    );
    if (!anchor) throw new Error('rank_source_profile_missing');
    const profile = signature(anchor);
    const positionIds = snapshot.ruleBookMaterial.rules
      .filter((rule) => signature(rule) === profile)
      .map((rule) => rule.positionId)
      .sort();
    for (const [index, row] of list.rows.entries()) {
      const identity = identities.get(row.employeeId);
      if (
        !identity ||
        normalizedName(`${identity.lastName}${identity.firstName}`) !==
          normalizedName(row.sourceMemberName) ||
        snapshot.members.find((member) => member.memberId === identity.memberId)?.rank !==
          row.sourceRank
      )
        throw new Error('rank_source_identity_mismatch');
      const location = row.provenance[0];
      if (!location) throw new Error('rank_source_location_missing');
      const literalTotal = typeof row.values.total === 'number' ? row.values.total : null;
      let points = 0;
      let soPoints = 0;
      if (list.listId === 'CAPTAIN_FIVE' || list.listId === 'PREVENTION_LIEUTENANT') {
        points = number(list, row, 'total');
      } else if (list.listId === 'FIRE_INVESTIGATOR') {
        points = number(list, row, 'preferences');
      } else if (list.listId === 'AIR_TECH') {
        points =
          number(list, row, 'total') -
          number(list, row, 'driverEngineer') -
          number(list, row, 'airTech');
        soPoints = points - number(list, row, 'carSeat');
      } else if (list.listId.startsWith('STATION_TWO_')) {
        points =
          number(list, row, 'total') -
          (list.listId === 'STATION_TWO_DRIVER_ENGINEER' ? number(list, row, 'driverEngineer') : 0);
        soPoints = points;
      } else if (list.listId.startsWith('MARINE_')) {
        points = number(list, row, 'total') - number(list, row, 'requiredTotal');
      }
      const reference = FrozenScoreReferenceEvidenceSchema.parse({
        v: 1,
        listId: list.listId,
        positionIds,
        points,
        soPoints,
        moPoints: 0,
        sourceName: list.source.name,
        sourceSha256: list.source.sha256,
        sourceLocation: { page: location.page, textLine: location.textLine },
        literalTotal,
        printedBidOrder: row.bidOrder,
        sourcePriority: index + 1,
      });
      const member = members.get(identity.memberId) ?? {
        memberId: identity.memberId,
        employeeId: identity.employeeId,
        scoreReferenceEvidence: [],
      };
      member.scoreReferenceEvidence.push(reference);
      members.set(identity.memberId, member);
    }
  }
  return [...members.values()].sort((left, right) => left.memberId - right.memberId);
}

export function createRankSourceReceipt(input: Omit<RankSourceRecord, 'v'>): RankSourceReceipt {
  const record = RecordSchema.parse({ v: 1, ...input });
  const receipt = ReceiptSchema.parse({ record, sha256: bidContentHash(canonical(record)) });
  if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > 1_800_000)
    throw new Error('rank_source_receipt_too_large');
  return receipt;
}
