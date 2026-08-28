import { and, eq } from 'drizzle-orm';

import type { DB } from '../db/index.js';
import { bidYearStaffingBaselines } from '../db/schema.js';
import {
  type TeleStaffImportCompleteness,
  evaluateTeleStaffImportCompleteness,
} from './authoritative-staffing-baseline.js';

export type AuthoritativeBaselineAcceptanceResult =
  | {
      ok: true;
      acceptanceId: string;
      importId: string;
      idempotent: boolean;
      baseline: TeleStaffImportCompleteness;
    }
  | {
      ok: false;
      code:
        | 'INVALID_ACCEPTANCE_REQUEST'
        | 'SOURCE_IMPORT_NOT_COMPLETE'
        | 'NON_OFFICIAL_SOURCE'
        | 'BASELINE_ALREADY_ACCEPTED'
        | 'ACCEPTANCE_PAYLOAD_CONFLICT'
        | 'ACCEPTANCE_WRITE_FAILED';
      baseline?: TeleStaffImportCompleteness;
    };

export interface AcceptAuthoritativeStaffingBaselineOptions {
  acceptanceId: string;
  bidYear: number;
  importId: string;
  actorMemberId: number;
  reason: string;
  acceptedAtMs: number;
}

function isOpaqueId(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 128;
}

function validRequest(options: AcceptAuthoritativeStaffingBaselineOptions): boolean {
  return (
    isOpaqueId(options.acceptanceId) &&
    isOpaqueId(options.importId) &&
    Number.isSafeInteger(options.bidYear) &&
    Number.isSafeInteger(options.actorMemberId) &&
    options.actorMemberId > 0 &&
    Number.isSafeInteger(options.acceptedAtMs) &&
    options.reason.trim().length > 0
  );
}

type ExistingAcceptance = {
  id: string;
  importId: string;
  acceptedAt: Date;
  acceptedByMemberId: number;
  acceptanceReason: string;
};

function matchesExistingAcceptance(
  existing: ExistingAcceptance,
  options: AcceptAuthoritativeStaffingBaselineOptions,
): boolean {
  return (
    existing.id === options.acceptanceId &&
    existing.importId === options.importId &&
    existing.acceptedAt.getTime() === options.acceptedAtMs &&
    existing.acceptedByMemberId === options.actorMemberId &&
    existing.acceptanceReason === options.reason.trim()
  );
}

/**
 * Local-only acceptance control. There is deliberately no HTTP endpoint for
 * this operation: an authorized workflow must provide the operator identity
 * and reason, both of which are immutably recorded by the ledger. The D1
 * trigger independently repeats the material completeness invariants so a
 * direct caller cannot accept an empty, partial, or synthetic manifest.
 */
export async function acceptAuthoritativeStaffingBaseline(
  d1: D1Database,
  db: DB,
  options: AcceptAuthoritativeStaffingBaselineOptions,
): Promise<AuthoritativeBaselineAcceptanceResult> {
  if (!validRequest(options)) return { ok: false, code: 'INVALID_ACCEPTANCE_REQUEST' };

  const existing = await db
    .select({
      id: bidYearStaffingBaselines.id,
      importId: bidYearStaffingBaselines.assignmentImportId,
      acceptedAt: bidYearStaffingBaselines.acceptedAt,
      acceptedByMemberId: bidYearStaffingBaselines.acceptedByMemberId,
      acceptanceReason: bidYearStaffingBaselines.acceptanceReason,
    })
    .from(bidYearStaffingBaselines)
    .where(
      and(
        eq(bidYearStaffingBaselines.bidYear, options.bidYear),
        eq(bidYearStaffingBaselines.status, 'accepted'),
      ),
    )
    .get();
  if (existing !== undefined) {
    if (existing.id === options.acceptanceId && existing.importId === options.importId) {
      if (!matchesExistingAcceptance(existing, options)) {
        return { ok: false, code: 'ACCEPTANCE_PAYLOAD_CONFLICT' };
      }
      const baseline = await evaluateTeleStaffImportCompleteness(db, options.importId);
      if (baseline.sourceKind !== 'official')
        return { ok: false, code: 'NON_OFFICIAL_SOURCE', baseline };
      if (baseline.status !== 'PASS')
        return { ok: false, code: 'SOURCE_IMPORT_NOT_COMPLETE', baseline };
      return {
        ok: true,
        acceptanceId: existing.id,
        importId: existing.importId,
        idempotent: true,
        baseline,
      };
    }
    return { ok: false, code: 'BASELINE_ALREADY_ACCEPTED' };
  }

  const baseline = await evaluateTeleStaffImportCompleteness(db, options.importId);
  if (baseline.sourceKind !== 'official') {
    return { ok: false, code: 'NON_OFFICIAL_SOURCE', baseline };
  }
  if (baseline.status !== 'PASS') {
    return { ok: false, code: 'SOURCE_IMPORT_NOT_COMPLETE', baseline };
  }

  try {
    await d1
      .prepare(
        `INSERT INTO bid_year_staffing_baselines
           (id, bid_year, assignment_import_id, status, accepted_at, accepted_by_member_id,
            acceptance_reason, created_at)
         VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)`,
      )
      .bind(
        options.acceptanceId,
        options.bidYear,
        options.importId,
        options.acceptedAtMs,
        options.actorMemberId,
        options.reason.trim(),
        options.acceptedAtMs,
      )
      .run();
  } catch {
    const concurrent = await db
      .select({
        id: bidYearStaffingBaselines.id,
        importId: bidYearStaffingBaselines.assignmentImportId,
        acceptedAt: bidYearStaffingBaselines.acceptedAt,
        acceptedByMemberId: bidYearStaffingBaselines.acceptedByMemberId,
        acceptanceReason: bidYearStaffingBaselines.acceptanceReason,
      })
      .from(bidYearStaffingBaselines)
      .where(
        and(
          eq(bidYearStaffingBaselines.bidYear, options.bidYear),
          eq(bidYearStaffingBaselines.status, 'accepted'),
        ),
      )
      .get();
    if (concurrent?.id === options.acceptanceId && concurrent.importId === options.importId) {
      if (!matchesExistingAcceptance(concurrent, options)) {
        return { ok: false, code: 'ACCEPTANCE_PAYLOAD_CONFLICT' };
      }
      const currentBaseline = await evaluateTeleStaffImportCompleteness(db, options.importId);
      if (currentBaseline.sourceKind !== 'official') {
        return { ok: false, code: 'NON_OFFICIAL_SOURCE', baseline: currentBaseline };
      }
      if (currentBaseline.status !== 'PASS') {
        return { ok: false, code: 'SOURCE_IMPORT_NOT_COMPLETE', baseline: currentBaseline };
      }
      return {
        ok: true,
        acceptanceId: concurrent.id,
        importId: concurrent.importId,
        idempotent: true,
        baseline: currentBaseline,
      };
    }
    return {
      ok: false,
      code: concurrent === undefined ? 'ACCEPTANCE_WRITE_FAILED' : 'BASELINE_ALREADY_ACCEPTED',
    };
  }

  return {
    ok: true,
    acceptanceId: options.acceptanceId,
    importId: options.importId,
    idempotent: false,
    baseline,
  };
}
