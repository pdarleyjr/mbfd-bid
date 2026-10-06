import {
  type PortalPayloadV2,
  PortalPayloadV2Schema,
  RankLabelSchema,
  ShiftLabelSchema,
} from '@mbfd/shared';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { bidContentHash } from '../lib/bid-definition-content.js';

export const FINAL_WORKBOOK_SHA256 =
  '67885033bd9b4ee9de5be5b6806c64b3744befc5ecf61bfedb69cc471a0843e5';
export const RETAINED_POSITION_IDS = [
  'A211',
  'B211',
  'C211',
  'A801',
  'D201',
  'D301',
  'D401',
  'D402',
];
export const UNAWARDED_POSITION_IDS = ['A717', 'C717', 'A718', 'B718', 'C718'];
const text = z.string().trim().min(1).max(200);
const DAY_LABELS: Record<string, string> = {
  G1: 'Group 1',
  G2: 'Group 2',
  G3: 'Group 3',
  G4: 'Group 4',
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};
export const FinalSourceRowSchema = z
  .object({
    source_worksheet: z.literal('Bid Pick'),
    source_row: z.number().int().min(2),
    employee_id: text,
    position_id: text,
    rank_label: RankLabelSchema,
    shift_label: ShiftLabelSchema,
    station_label: text,
    division_label: text,
    unit_label: text,
    position_label: text,
    bid_selection_label: text,
    assignment_type: z.enum(['Assigned', 'Floating']),
    assignment_source: z.enum(['bid_award', 'retained_nonbiddable']),
    a_day_code: PortalPayloadV2Schema.innerType().shape.a_day_code,
    a_day_label: text,
    // A final workbook label may correct saved topology wording without changing it.
    frozen_position_label: text.optional(),
    metadata_override_reason: z.string().trim().min(12).max(2000).optional(),
  })
  .strict();
export type FinalSourceRow = z.infer<typeof FinalSourceRowSchema>;
export const FinalPublicationBodySchema = z
  .object({
    workbook_sha256: z.literal(FINAL_WORKBOOK_SHA256),
    expected_sequence: z.number().int().nonnegative(),
    expected_result_hash: z.string().regex(/^[a-f0-9]{64}$/),
    hub_identity_receipt_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    hub_matched_employee_ids: z.array(text).length(226),
    rows: z.array(FinalSourceRowSchema).length(226),
    confirmation_phrase: z.string().optional(),
  })
  .strict();
export type FinalPublicationBody = z.infer<typeof FinalPublicationBodySchema>;

export const publicationJson = (value: unknown) => canonicalize(value as JsonValue);
export const RANK_LABELS: Record<string, z.infer<typeof RankLabelSchema>> = {
  FF: 'Firefighter',
  LT: 'Lieutenant',
  CPT: 'Captain',
  DC: 'Division Chief',
  DEP_CHIEF: 'Deputy Fire Chief',
  CHIEF: 'Fire Chief',
};
export function validateFinalSourceRows(body: FinalPublicationBody) {
  const issues: string[] = [];
  for (const key of ['employee_id', 'position_id', 'source_row'] as const)
    if (new Set(body.rows.map((row) => row[key])).size !== 226) issues.push(`duplicate_${key}`);
  const hubIds = new Set(body.hub_matched_employee_ids);
  if (hubIds.size !== 226 || body.rows.some((row) => !hubIds.has(row.employee_id)))
    issues.push('hub_identity_coverage_mismatch');
  const retained = body.rows.filter((row) => row.assignment_source === 'retained_nonbiddable');
  const awards = body.rows.filter((row) => row.assignment_source === 'bid_award');
  if (
    retained.length !== 8 ||
    RETAINED_POSITION_IDS.some((id) => !retained.some((row) => row.position_id === id))
  )
    issues.push('retained_coverage_mismatch');
  if (
    awards.length !== 218 ||
    awards.some((row) => RETAINED_POSITION_IDS.includes(row.position_id))
  )
    issues.push('award_coverage_mismatch');
  if (body.rows.some((row) => UNAWARDED_POSITION_IDS.includes(row.position_id)))
    issues.push('unawarded_position_occupied');
  for (const row of body.rows) {
    if (row.a_day_label !== DAY_LABELS[row.a_day_code])
      issues.push(`a_day_label_mismatch:${row.source_row}`);
    if (row.bid_selection_label !== row.unit_label)
      issues.push(`selection_unit_mismatch:${row.source_row}`);
  }
  for (const [field, expected] of [
    ['rank_label', { Captain: 20, Lieutenant: 38, Firefighter: 160 }],
    ['shift_label', { 'A Shift': 71, 'B Shift': 72, 'C Shift': 71, 'D Shift': 4 }],
    ['a_day_code', { G1: 55, G2: 53, G3: 53, G4: 53, MON: 3, FRI: 1 }],
  ] as const) {
    const counts: Record<string, number> = {};
    for (const row of awards) counts[row[field]] = (counts[row[field]] ?? 0) + 1;
    if (publicationJson(counts) !== publicationJson(expected))
      issues.push(`${field}_checksum_mismatch`);
  }
  return issues;
}

export function buildFinalPortalPayload(input: {
  row: FinalSourceRow;
  sessionId: string;
  sequence: number;
  resultHash: string;
  pickedAt: string | null;
  forcedActorEmployeeId: string | null;
}): PortalPayloadV2 {
  const { row } = input;
  const payload = {
    payload_version: 2 as const,
    bid_year: 2026,
    term_label: '2026–2027',
    bid_session_id: input.sessionId,
    employee_id: row.employee_id,
    rank_label: row.rank_label,
    station_label: row.station_label,
    shift_label: row.shift_label,
    division_label: row.division_label,
    unit_label: row.unit_label,
    position_id: row.position_id,
    position_label: row.position_label,
    bid_selection_label: row.bid_selection_label,
    assignment_type: row.assignment_type,
    assignment_source: row.assignment_source,
    a_day_code: row.a_day_code,
    a_day_label: row.a_day_label,
    picked_at: input.pickedAt,
    is_forced: input.forcedActorEmployeeId !== null,
    admin_actor_employee_id: input.forcedActorEmployeeId,
    source_sequence: input.sequence,
    source_result_hash: input.resultHash,
    source_workbook_sha256: FINAL_WORKBOOK_SHA256,
  };
  return PortalPayloadV2Schema.parse({
    ...payload,
    idempotency_key: `final_${bidContentHash(publicationJson(payload))}`,
  });
}
