import legacyPositions from '../../seed/fixtures/2026_positions.json';
import finalPositions from '../../seed/fixtures/final_2026_positions.json';
import type { ReviewedPosition } from './reviewed-2026-source.js';

/** The July MASTER remains an immutable 228-row extraction. These three IDs
 * identify reviewed roles added by the application, never workbook rows. */
export const CORRECTED_2026_FLOAT_CAPTAIN_IDS = ['A718', 'B718', 'C718'] as const;

export const CORRECTED_2026_FLOAT_CAPTAIN_PROVENANCE = {
  role: 'Combat Floating Captain / Captain #1 (C)',
  identityOrigin: 'APPLICATION_CANONICAL',
  evidence: [
    '2025 A/B/C shift diagrams: administrator-described counted Captain #1 (C) on each shift',
    'Legacy 2026 positions: A213/B213/C213 floating CPT Captain #1 (C)',
    'Daily Shift Staffing Guidelines 1.13 (2025-12-01): Bid Floating Captain with Certs',
    'July 2026 Bid Policy Procedure 11: Combat and Rescue Float Pools',
    'Final MASTER: 72 non-DC/non-Union seats per shift and no floating CPT',
  ],
  discrepancy:
    'Legacy role was grouped under Station #2 / Rescue / Float 2; July policy places ordinary floats in Combat or Rescue pools. Combat is supported by the (C) role label, but direct 2025 image inspection remains outstanding.',
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
      station: 'Combat Float Pool',
      division: 'Combat',
      unit: 'Combat Float',
      rankRequired: 'CPT',
      positionName: 'Combat Floating Captain #1 (C)',
      isFloating: true,
      isVacantByDesign: false,
      isExcludedFromCount: false,
      canonicalIdentity: CORRECTED_2026_FLOAT_CAPTAIN_PROVENANCE,
    });
  }
  return positions;
}
