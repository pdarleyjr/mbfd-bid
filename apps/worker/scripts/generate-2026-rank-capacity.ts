import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCorrected2026SemanticRoles } from '../src/lib/corrected-2026-semantic-roles.js';
import { buildCorrected2026Topology } from '../src/lib/corrected-2026-topology.js';

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/unified-platform/2026-rank-capacity-candidate.json',
);
const positions = buildCorrected2026Topology();
const roles = new Map(buildCorrected2026SemanticRoles().map((role) => [role.positionId, role]));
const rows = positions.map((position) => {
  const role = roles.get(position.id);
  if (!role) throw new Error(`unclassified_2026_rank_position:${position.id}`);
  return {
    canonicalPositionId: position.id,
    sourceIdentity: position.source
      ? `MASTER Positions row ${position.source.row}; source ID ${position.id}`
      : `Application canonical role ${position.id}`,
    shift: position.shift,
    station: position.station,
    unit: position.unit,
    role: position.positionName,
    rank: position.rankRequired,
    specialtyContext: role.roleFamily,
    biddable: role.bidParticipation === 'BIDDABLE',
    participation: role.bidParticipation,
    authority: position.source
      ? `MASTER 2026 Bid Positions Selection V2.xlsx sha256:${position.source.workbookSha256}`
      : role.policyRef,
    sourceCorrection:
      position.source?.correction ?? position.canonicalIdentity?.discrepancy ?? null,
  };
});
const rankCounts = Object.fromEntries(
  ['A', 'B', 'C', 'D'].map((shift) => [
    shift,
    Object.fromEntries(
      ['CPT', 'LT', 'FF'].map((rank) => [
        rank,
        rows.filter((row) => row.biddable && row.shift === shift && row.rank === rank).length,
      ]),
    ),
  ]),
);
const grand = Object.fromEntries(
  ['CPT', 'LT', 'FF'].map((rank) => [
    rank,
    rows.filter((row) => row.biddable && row.rank === rank).length,
  ]),
);
const result = {
  status: 'CANDIDATE_BLOCKED_BY_RANK_CAPACITY_SOURCE_CONFLICT',
  sourceHierarchy:
    'Final July 2026 policy; MASTER workbook for topology; calculation workbook and historical diagrams as reconciliation evidence; assignment export for occupancy only',
  bidderCohortReviewedBeforeCutoff: { CPT: 22, LT: 39, FF: 161 },
  biddableSeatCounts: { byShift: rankCounts, grand },
  unresolvedSourceConflict:
    'B703 is Firefighter #1 in final MASTER Positions row 134 and 2026 Shift Template; historical B-shift diagram and September staffing export show a third B Rescue Float Lieutenant. No approved 2026 rank correction is established by these sources.',
  rows,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output, rows: rows.length, rankCounts, grand })}\n`);
