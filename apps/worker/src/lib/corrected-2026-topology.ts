import legacyPositions from '../../seed/fixtures/2026_positions.json';
import finalPositions from '../../seed/fixtures/final_2026_positions.json';
import {
  FINAL_2026_TOPOLOGY_DECISION_ID,
  FINAL_2026_TOPOLOGY_SOURCE_REF,
} from './2026-opportunity-inventory.js';
import type { ReviewedPosition } from './reviewed-2026-source.js';

/** The July MASTER remains an immutable 228-row extraction. These three IDs
 * identify reviewed roles added by the application, never workbook rows. */
export const CORRECTED_2026_FLOAT_CAPTAIN_IDS = ['A718', 'B718', 'C718'] as const;

/** Include this reviewed decision in the successor's sealed sourceDecisions.
 * Versions 7/8 remain unchanged, and only the corrected successor opts into
 * the strict final-topology inventory contract. */
export const CORRECTED_2026_TOPOLOGY_SOURCE_DECISION = {
  issueId: FINAL_2026_TOPOLOGY_DECISION_ID,
  title: 'Reviewed final 2026 counted shift topology',
  question: 'Which counted role restores 73 biddable non-Chief seats on each shift?',
  area: 'positions',
  status: 'RESOLVED',
  decision:
    'Add application-canonical A718/B718/C718 as Station #2 / Float 2 / Combat-track Floating Captain #1 (C); protect A/B/C211 Division Chiefs and A801 Union President; preserve closed Days seats.',
  sourceRef: FINAL_2026_TOPOLOGY_SOURCE_REF,
  effectiveOn: '2026-09-27',
} as const;

export const CORRECTED_2026_FLOAT_CAPTAIN_PROVENANCE = {
  role: 'Station #2 / Float 2 / Combat-track Floating Captain #1 (C)',
  identityOrigin: 'APPLICATION_CANONICAL',
  evidence: [
    '2025 A/B/C shift diagrams: administrator directly reviewed counted Station #2 / Float 2 Captain #1 (C) on each shift',
    'Legacy 2026 positions: A213/B213/C213 floating CPT Captain #1 (C)',
    'Daily Shift Staffing Guidelines 1.13 (2025-12-01): Bid Floating Captain with Certs',
    'July 2026 Bid Policy Procedures 7 and 11: all Station #2 Special Ops positions receive preference scoring; Special Ops Floats are excepted from ordinary pools',
    'Final MASTER: 72 non-DC/non-Union seats per shift and no floating CPT',
  ],
  discrepancy:
    'Final MASTER omits the counted Captain; legacy A213/B213/C213 now belong to different final roles. Application IDs A718/B718/C718 preserve the reviewed Station #2 / Float 2 placement without reusing occupied IDs.',
} as const;

export interface Corrected2026Position extends ReviewedPosition {
  canonicalIdentity?: typeof CORRECTED_2026_FLOAT_CAPTAIN_PROVENANCE;
}

export function buildCorrected2026Topology(): Corrected2026Position[] {
  const positions = structuredClone(finalPositions) as Corrected2026Position[];
  const occupiedIds = new Set([...positions, ...legacyPositions].map((position) => position.id));
  for (const shift of ['A', 'B', 'C'] as const) {
    const id = `${shift}718`;
    if (occupiedIds.has(id)) throw new Error(`corrected_2026_canonical_id_collision:${id}`);
    occupiedIds.add(id);
    positions.push({
      id,
      shift,
      station: 'Station #2',
      division: 'Combat',
      unit: 'Float 2',
      rankRequired: 'CPT',
      positionName: 'Floating Captain #1 (C)',
      isFloating: true,
      isVacantByDesign: false,
      isExcludedFromCount: false,
      canonicalIdentity: CORRECTED_2026_FLOAT_CAPTAIN_PROVENANCE,
    });
  }
  return positions;
}
