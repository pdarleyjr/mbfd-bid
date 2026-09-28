import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import finalPositions from '../seed/fixtures/final_2026_positions.json';
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
    rawMasterValue: position.source?.correction
      ? (() => {
          const raw = finalPositions.find((item) => item.id === position.id);
          if (!raw) throw new Error(`missing_raw_master_position:${position.id}`);
          return { rank: raw.rankRequired, role: raw.positionName };
        })()
      : null,
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
  status: 'REVIEWED_APPLICATION_TOPOLOGY_PRE_CUTOFF',
  sourceHierarchy:
    'Final July 2026 policy; immutable MASTER workbook for source topology; administrator-approved B703-B706 correction from current assignments, B-shift roster, historical diagram, and rank reconciliation',
  bidderCohortReviewedBeforeCutoff: { CPT: 22, LT: 39, FF: 161 },
  biddableSeatCounts: { byShift: rankCounts, grand },
  expectedVacancies: { CPT: 1, LT: 0, FF: 0 },
  reviewedSourceCorrection:
    'B703-B706 raw MASTER labels are preserved in rawMasterValue. Administrator-approved application correction on 2026-09-27 makes B703 LT #3 and B704-B706 FF #1/#2/#3.',
  rows,
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output, rows: rows.length, rankCounts, grand })}\n`);
