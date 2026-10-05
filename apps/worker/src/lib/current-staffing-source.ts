import Papa from 'papaparse';
import { z } from 'zod';
import type { WorkerEnv } from '../types/env.js';
import {
  loadDepartmentOrganization,
  resolveDepartmentPositionOrganization,
} from './department-organization.js';
import { canonicalRosterShift, isCalendarDate } from './department-roster.js';
import { operationalDate } from './operational-date.js';

export const CURRENT_STAFFING_KEY = 'current-staffing/v1/current.json';
const shiftSchema = z.enum(['A', 'B', 'C', 'D']);
const groupSchema = z.enum(['G1', 'G2', 'G3', 'G4']);
const labelSchema = z.string().trim().min(1).max(200).nullable();
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Only placement columns are retained. Contact columns never enter this archive. */
export const CurrentStaffingArchiveSchema = z
  .object({
    v: z.literal(1),
    source: z.object({ name: z.string().trim().min(1).max(200), sha256: shaSchema }).strict(),
    snapshotAt: z.string().datetime(),
    rows: z
      .array(
        z
          .object({
            employeeId: z.string().trim().min(1).max(80),
            sourceRank: labelSchema,
            shift: shiftSchema,
            aDayGroup: groupSchema.nullable(),
            station: labelSchema,
            unit: labelSchema,
            positionLabel: labelSchema,
            sourceRow: z.number().int().min(2),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
export type CurrentStaffingArchive = z.infer<typeof CurrentStaffingArchiveSchema>;
export const CurrentStaffingReceiptSchema = z
  .object({
    archive: CurrentStaffingArchiveSchema,
    sha256: shaSchema,
    publishedAt: z.string().datetime(),
    publishedBy: z.string().trim().min(1).max(100),
  })
  .strict();
export type CurrentStaffingReceipt = z.infer<typeof CurrentStaffingReceiptSchema>;

export type CurrentStaffingContext = {
  evidenceStatus: 'RECORDED' | 'UNLINKED' | 'UNAVAILABLE';
  positionId: string | null;
  positionLabel: string | null;
  shift: 'A' | 'B' | 'C' | 'D' | null;
  station: string | null;
  unit: string | null;
  aDayGroup: 'G1' | 'G2' | 'G3' | 'G4' | null;
  sourceRank: string | null;
  sourceName: string | null;
  sourceSha256: string | null;
  sourceRow: number | null;
  snapshotAt: string | null;
  source: 'DIRECTORY_CSV' | 'REVIEWED_STAFFING' | null;
};

export function currentStaffingHasIdentityConflict(archive: CurrentStaffingArchive): boolean {
  return new Set(archive.rows.map((row) => row.employeeId)).size !== archive.rows.length;
}

export async function currentStaffingArchiveHash(archive: CurrentStaffingArchive): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(CurrentStaffingArchiveSchema.parse(archive))),
  );
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

const DIRECTORY_HEADERS = [
  'Name',
  'Employee ID',
  'Email Address',
  'Rank / Position',
  'Shift',
  'A Day',
  'Station / Division',
  'Seat / Unit',
  'Bid Position',
  'Email Match Status',
];

/** Parse source values exactly; numeric Employee IDs are deliberately kept as strings. */
export async function currentStaffingArchiveFromCsv(
  csv: string,
  sourceName: string,
  sourceSha256: string,
  snapshotAt: string,
): Promise<CurrentStaffingArchive> {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  if (
    parsed.errors.length ||
    parsed.meta.fields?.length !== DIRECTORY_HEADERS.length ||
    DIRECTORY_HEADERS.some((header, index) => parsed.meta.fields?.[index] !== header)
  ) {
    throw new Error('current_staffing_csv_headers_or_rows_invalid');
  }
  const label = (value: string | undefined) => value?.trim() || null;
  const archive = CurrentStaffingArchiveSchema.parse({
    v: 1,
    source: { name: sourceName, sha256: sourceSha256 },
    snapshotAt,
    rows: parsed.data.map((row, index) => ({
      employeeId: row['Employee ID']?.trim(),
      sourceRank: label(row['Rank / Position']),
      shift: row.Shift?.trim(),
      aDayGroup: row['A Day']?.trim() ? `G${row['A Day'].trim()}` : null,
      station: label(row['Station / Division']),
      unit: label(row['Seat / Unit']),
      positionLabel: label(row['Bid Position']),
      sourceRow: index + 2,
    })),
  });
  if (currentStaffingHasIdentityConflict(archive))
    throw new Error('current_staffing_identity_conflict');
  if (archive.rows.some((row) => row.shift === 'D' && row.aDayGroup !== null))
    throw new Error('current_staffing_days_group_invalid');
  return archive;
}

/** Private documentary failures never alter execution, eligibility, history or awards. */
export async function loadCurrentStaffingReceipt(
  bucket: Pick<WorkerEnv['R2_EXPORTS'], 'get'> | undefined,
): Promise<CurrentStaffingReceipt | null> {
  try {
    const object = await bucket?.get(CURRENT_STAFFING_KEY);
    if (!object) return null;
    const parsed = CurrentStaffingReceiptSchema.safeParse(await object.json());
    if (
      !parsed.success ||
      currentStaffingHasIdentityConflict(parsed.data.archive) ||
      parsed.data.archive.rows.some((row) => row.shift === 'D' && row.aDayGroup !== null) ||
      (await currentStaffingArchiveHash(parsed.data.archive)) !== parsed.data.sha256
    )
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function projectDirectoryCurrentStaffing(
  receipt: CurrentStaffingReceipt | null,
  employeeId: string | undefined,
): CurrentStaffingContext {
  const empty: CurrentStaffingContext = {
    evidenceStatus: receipt ? 'UNLINKED' : 'UNAVAILABLE',
    positionId: null,
    positionLabel: null,
    shift: null,
    station: null,
    unit: null,
    aDayGroup: null,
    sourceRank: null,
    sourceName: null,
    sourceSha256: null,
    sourceRow: null,
    snapshotAt: null,
    source: null,
  };
  if (!receipt || !employeeId) return empty;
  const matches = receipt.archive.rows.filter((row) => row.employeeId === employeeId);
  if (matches.length !== 1) return empty;
  const row = matches[0];
  if (!row) return empty;
  return {
    ...empty,
    evidenceStatus: 'RECORDED',
    positionId: null,
    positionLabel: row.positionLabel,
    shift: row.shift,
    station: row.station,
    unit: row.unit,
    aDayGroup: row.aDayGroup,
    sourceRank: row.sourceRank,
    sourceRow: row.sourceRow,
    sourceName: receipt.archive.source.name,
    sourceSha256: receipt.archive.source.sha256,
    snapshotAt: receipt.archive.snapshotAt,
    source: 'DIRECTORY_CSV',
  };
}

type ReviewedAssignment = {
  member_id: number;
  position_id: string;
  position_name: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
  division: string | null;
  created_at: number;
  updated_at: number;
  effective_from: string;
  source_a_r_day: string | null;
};

function recordedGroup(value: string | null): CurrentStaffingContext['aDayGroup'] {
  const match = /^(?:GR|G)?([1-4])$/.exec(value?.trim().toUpperCase() ?? '');
  return match ? groupSchema.parse(`G${match[1]}`) : null;
}

/** Shared by operator member details and the presentation header. The supplied
 * directory wins over older roster imports. A later effective reviewed placement
 * or correction takes precedence so this snapshot cannot freeze staffing forever. */
export async function loadCurrentStaffingContexts(
  db: D1Database,
  bucket: Pick<WorkerEnv['R2_EXPORTS'], 'get'> | undefined,
  identities: ReadonlyArray<{ memberId: number; employeeId: string }>,
  asOf: string,
): Promise<Map<number, CurrentStaffingContext>> {
  let receipt = await loadCurrentStaffingReceipt(bucket);
  if (
    !isCalendarDate(asOf) ||
    (receipt && operationalDate(new Date(receipt.archive.snapshotAt)) > asOf)
  )
    receipt = null;
  const contexts = new Map(
    identities.map((identity) => [
      identity.memberId,
      projectDirectoryCurrentStaffing(receipt, identity.employeeId),
    ]),
  );
  if (!isCalendarDate(asOf) || !identities.length) return contexts;
  try {
    const rows = await db
      .prepare(`SELECT a.member_id,p.id AS position_id,p.position_name,
      p.shift,p.station,p.unit,p.division,a.created_at,a.updated_at,a.effective_from,
      observation.source_a_r_day FROM member_assignments a
      JOIN staffing_positions p ON p.id=a.staffing_position_id
      LEFT JOIN assignment_observations observation ON observation.id=a.source_observation_id
      WHERE p.review_status IN ('approved','retired')
        AND a.id=(SELECT candidate.id FROM member_assignments candidate
          WHERE candidate.staffing_position_id=p.id
          AND (candidate.status IN ('planned','active') OR
            (candidate.status IN ('ended','superseded') AND candidate.effective_to IS NOT NULL))
          AND candidate.effective_from<=? AND (candidate.effective_to IS NULL OR candidate.effective_to>=?)
          ORDER BY candidate.effective_from DESC,candidate.created_at DESC,candidate.id DESC LIMIT 1)
        AND a.effective_from<=? AND (a.effective_to IS NULL OR a.effective_to>=?)
        AND (p.active_from IS NULL OR p.active_from<=?) AND (p.active_to IS NULL OR p.active_to>=?)`)
      .bind(asOf, asOf, asOf, asOf, asOf, asOf)
      .all<ReviewedAssignment>();
    const byMember = new Map<number, ReviewedAssignment[]>();
    for (const row of rows.results)
      byMember.set(row.member_id, [...(byMember.get(row.member_id) ?? []), row]);
    const snapshotMs = receipt ? new Date(receipt.archive.snapshotAt).getTime() : null;
    const snapshotDate = receipt ? operationalDate(new Date(receipt.archive.snapshotAt)) : null;
    const laterChanges = new Set<number>();
    if (snapshotMs !== null) {
      const changes = await db
        .prepare(`SELECT DISTINCT a.member_id FROM member_assignments a
        JOIN staffing_positions p ON p.id=a.staffing_position_id
        WHERE p.review_status IN ('approved','retired') AND a.effective_from<=?
          AND (a.effective_to IS NULL OR a.effective_to>=?)
          AND (a.created_at>? OR a.updated_at>?)`)
        .bind(asOf, snapshotDate, snapshotMs, snapshotMs)
        .all<{ member_id: number }>();
      for (const change of changes.results) laterChanges.add(change.member_id);
    }
    const fallbacks = identities.flatMap(({ memberId }) => {
      const context = contexts.get(memberId);
      const assignments = byMember.get(memberId) ?? [];
      const newer =
        laterChanges.has(memberId) ||
        assignments.some(
          (row) =>
            snapshotMs !== null &&
            snapshotDate !== null &&
            (row.created_at > snapshotMs ||
              row.updated_at > snapshotMs ||
              row.effective_from > snapshotDate),
        );
      if (context?.source === 'DIRECTORY_CSV' && !newer) return [];
      if (assignments.length !== 1) {
        // A later removal or ambiguous placement cannot be concealed by the old directory.
        if (newer) contexts.set(memberId, projectDirectoryCurrentStaffing(null, undefined));
        return [];
      }
      const assignment = assignments[0];
      return assignment ? [{ memberId, assignment }] : [];
    });
    if (!fallbacks.length) return contexts;
    const organization = await loadDepartmentOrganization(db, asOf);
    for (const { memberId, assignment } of fallbacks) {
      const topology = resolveDepartmentPositionOrganization(
        { ...assignment, id: assignment.position_id },
        organization,
      );
      const shift = shiftSchema.safeParse(canonicalRosterShift(assignment.shift));
      contexts.set(memberId, {
        evidenceStatus: 'RECORDED',
        positionId: assignment.position_id,
        positionLabel: assignment.position_name,
        shift: shift.success ? shift.data : null,
        station: topology.station,
        unit: topology.unit,
        aDayGroup: recordedGroup(assignment.source_a_r_day),
        sourceRank: null,
        sourceName: 'Reviewed staffing',
        sourceSha256: null,
        sourceRow: null,
        snapshotAt: `${assignment.effective_from}T00:00:00.000Z`,
        source: 'REVIEWED_STAFFING',
      });
    }
  } catch {
    // The verified directory remains usable even when the auxiliary roster is unavailable.
  }
  return contexts;
}
