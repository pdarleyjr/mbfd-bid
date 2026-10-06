import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { bidContentHash } from '../lib/bid-definition-content.js';
import { loadCanonicalBidResultPackage } from '../lib/bid-result-package.js';
import { projectFrozenNonBidAssignments } from '../lib/frozen-nonbid-assignments.js';
import { loadOfficialAnnualCompletion } from '../lib/official-annual-completion.js';
import {
  type FinalPublicationBody,
  RANK_LABELS,
  buildFinalPortalPayload,
  publicationJson,
  validateFinalSourceRows,
} from './final-source.js';

/** Read-only validation. Never replays awards or writes a preview receipt. */
export async function previewFinalPublication(
  db: D1Database,
  sessionId: string,
  body: FinalPublicationBody,
) {
  const issues = validateFinalSourceRows(body);
  const official = await loadOfficialAnnualCompletion(db, sessionId);
  if (!official.ok) return { ok: false as const, issues: [...issues, official.error] };
  const result = await loadCanonicalBidResultPackage(db, sessionId);
  if (!result.ok) return { ok: false as const, issues: [...issues, result.error] };
  const state = await loadCanonicalBidSessionState(db, sessionId);
  if (state === null || official.snapshot.v !== 3)
    return { ok: false as const, issues: [...issues, 'canonical_frozen_material_required'] };
  if (result.document.bidYear !== 2026) issues.push('final_2026_session_required');
  if (state.lastSeq !== body.expected_sequence) issues.push('stale_sequence');
  if (result.packageSha256 !== body.expected_result_hash) issues.push('result_hash_mismatch');
  if (official.completion.participants.length !== 218) issues.push('canonical_218_awards_required');
  if (['A718', 'B718', 'C718'].some((id) => !state.live?.withdrawnPositionIds?.includes(id)))
    issues.push('withdrawn_float_2_required');
  if (['A717', 'C717', 'A718', 'B718', 'C718'].some((id) => state.fills[id]))
    issues.push('open_or_withdrawn_position_occupied');
  const retained = projectFrozenNonBidAssignments(official.snapshot);
  const identities = official.snapshot.operatorIdentityProjection ?? [];
  const events = (
    await db
      .prepare(`SELECT e.event_json,e.created_at,e.seq
    FROM bid_command_events e JOIN bid_command_receipts r ON r.command_id=e.command_id
      AND r.bid_session_id=e.bid_session_id
    WHERE e.bid_session_id=? AND r.outcome='accepted' AND r.result_seq=e.seq AND e.seq<=?
    ORDER BY e.seq`)
      .bind(sessionId, state.lastSeq)
      .all<{ event_json: string; created_at: number; seq: number }>()
  ).results;
  const parsedEvents = events.map((event) => ({
    ...event,
    value: JSON.parse(event.event_json) as Record<string, unknown>,
  }));
  const payloads = [];
  const overrides = [];
  for (const row of [...body.rows].sort((a, b) => a.source_row - b.source_row)) {
    const matches = identities.filter((member) => member.employeeId === row.employee_id);
    const member = matches.length === 1 ? matches[0] : undefined;
    const positions = official.snapshot.ruleBookMaterial.positions.filter(
      (position) => position.id === row.position_id,
    );
    const position = positions.length === 1 ? positions[0] : undefined;
    if (!member || !position) {
      issues.push(`frozen_identity_or_position_missing:${row.source_row}`);
      continue;
    }
    const station = (value: string) => value.replace(/^Station\s*#?\s*/i, '').trim();
    if (
      RANK_LABELS[member.rank] !== row.rank_label ||
      `${position.shift} Shift` !== row.shift_label ||
      station(position.station) !== station(row.station_label) ||
      position.unit !== row.unit_label ||
      (position.division !== undefined && position.division !== row.division_label) ||
      (position.isFloating !== undefined &&
        position.isFloating !== (row.assignment_type === 'Floating'))
    )
      issues.push(`frozen_metadata_mismatch:${row.source_row}`);
    if (position.positionName !== row.position_label) {
      if (row.frozen_position_label !== position.positionName || !row.metadata_override_reason)
        issues.push(`reviewed_position_label_override_required:${row.source_row}`);
      else
        overrides.push({
          position_id: row.position_id,
          source_row: row.source_row,
          before: position.positionName,
          after: row.position_label,
          reason: row.metadata_override_reason,
        });
    } else if (
      row.frozen_position_label !== undefined ||
      row.metadata_override_reason !== undefined
    )
      issues.push(`unnecessary_metadata_override:${row.source_row}`);
    let pickedAt: string | null = null;
    let forcedActorEmployeeId: string | null = null;
    if (row.assignment_source === 'retained_nonbiddable') {
      if (
        retained.get(row.position_id)?.memberId !== member.memberId ||
        position.bidParticipation === 'BIDDABLE'
      )
        issues.push(`retained_assignment_mismatch:${row.source_row}`);
    } else {
      const award = official.completion.participants.find(
        (entry) => entry.memberId === member.memberId,
      );
      const fill = state.fills[row.position_id];
      if (
        !award ||
        award.positionId !== row.position_id ||
        award.aDay !== row.a_day_code ||
        !fill ||
        fill.memberId !== member.memberId ||
        position.bidParticipation !== 'BIDDABLE'
      ) {
        issues.push(`canonical_award_mismatch:${row.source_row}`);
        continue;
      }
      const sourceEvent = parsedEvents.find((event) => {
        const value = event.value;
        const after = value.after as
          | { positionId?: string; fill?: { bidId?: string; memberId?: number } }
          | null
          | undefined;
        return (
          (value.bidId === fill.bidId || value.replacementBidId === fill.bidId) &&
          value.memberId === member.memberId &&
          (after?.positionId ?? value.toPositionId ?? value.positionId) === row.position_id
        );
      });
      if (
        !sourceEvent ||
        !Number.isSafeInteger(sourceEvent.created_at) ||
        sourceEvent.created_at <= 0
      ) {
        issues.push(`canonical_award_timestamp_required:${row.source_row}`);
        continue;
      }
      pickedAt = new Date(sourceEvent.created_at).toISOString();
      if (fill.forced) {
        const actors = identities.filter(
          (identity) => identity.memberId === fill.forced?.actorMemberId,
        );
        forcedActorEmployeeId = actors.length === 1 ? (actors[0]?.employeeId ?? null) : null;
        if (forcedActorEmployeeId === null) {
          issues.push(`forced_actor_identity_required:${row.source_row}`);
          continue;
        }
      }
    }
    payloads.push(
      buildFinalPortalPayload({
        row,
        sessionId,
        sequence: state.lastSeq,
        resultHash: result.packageSha256,
        pickedAt,
        forcedActorEmployeeId,
      }),
    );
  }
  if (issues.length > 0) return { ok: false as const, issues };
  const manifest = {
    workbook_sha256: body.workbook_sha256,
    hub_identity_receipt_sha256: body.hub_identity_receipt_sha256,
    hub_matched_employee_ids: [...body.hub_matched_employee_ids].sort(),
    rows: [...body.rows].sort((a, b) => a.source_row - b.source_row),
  };
  const manifestJson = publicationJson(manifest);
  const manifestHash = bidContentHash(manifestJson);
  return {
    ok: true as const,
    sessionId,
    sequence: state.lastSeq,
    resultHash: result.packageSha256,
    manifestJson,
    manifestHash,
    payloads,
    overrides,
    publicationId: `final_publication_${bidContentHash(`${sessionId}:${state.lastSeq}:${manifestHash}`)}`,
    confirmationPhrase: `PUBLISH FINAL 2026–2027 ${sessionId} ${state.lastSeq}`,
    counts: { bid_award: 218, retained_nonbiddable: 8, total: 226, hub_matched: 226 },
  };
}
