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

export const CORRECTED_2026_B_RESCUE_FLOAT_DECISION_ID = '2026-b-rescue-float-rank-correction';
export const CORRECTED_2026_B_RESCUE_FLOAT_PROVENANCE =
  'MASTER B703-B706 source rows conflict with reviewed B-shift operational topology. Current assignment evidence, B-shift roster evidence, historical B-shift diagram, and final rank-capacity reconciliation establish a 3 LT / 3 FF Rescue Float Pool. Raw MASTER remains preserved; application semantics are corrected through an audited 2026 source decision.';
export const CORRECTED_2026_B_RESCUE_FLOAT_SOURCE_DECISION = {
  issueId: CORRECTED_2026_B_RESCUE_FLOAT_DECISION_ID,
  title: 'Reviewed B-shift Rescue Float Pool rank and numbering',
  question: 'What are the approved ranks and labels for B703-B706?',
  area: 'positions',
  status: 'RESOLVED',
  decision:
    'B701/B702/B703 are Rescue Float Lieutenants #1/#2/#3; B704/B705/B706 are Rescue Float Firefighters #1/#2/#3. B703 is an LT opportunity and B704-B706 are FF opportunities.',
  sourceRef: CORRECTED_2026_B_RESCUE_FLOAT_PROVENANCE,
  effectiveOn: '2026-09-27',
} as const;

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
  const corrected = new Map([
    ['B703', { rank: 'LT', name: 'Lieutenant #3 (R)', rawRank: 'FF', rawName: 'Firefighter #1' }],
    ['B704', { rank: 'FF', name: 'Firefighter #1', rawRank: 'FF', rawName: 'Firefighter #2' }],
    ['B705', { rank: 'FF', name: 'Firefighter #2', rawRank: 'FF', rawName: 'Firefighter #3' }],
    ['B706', { rank: 'FF', name: 'Firefighter #3', rawRank: 'FF', rawName: 'Firefighter #4' }],
  ] as const);
  for (const position of positions) {
    const correction = corrected.get(position.id as 'B703' | 'B704' | 'B705' | 'B706');
    if (!correction) continue;
    if (
      position.shift !== 'B' ||
      position.station !== 'Rescue Float Pool' ||
      position.division !== 'Rescue' ||
      !position.isFloating ||
      position.rankRequired !== correction.rawRank ||
      position.positionName !== correction.rawName ||
      !position.source ||
      position.source.correction !== null
    )
      throw new Error(`corrected_2026_b_rescue_float_source_changed:${position.id}`);
    position.rankRequired = correction.rank;
    position.positionName = correction.name;
    position.source.correction = `${CORRECTED_2026_B_RESCUE_FLOAT_DECISION_ID}: raw MASTER ${correction.rawRank} ${correction.rawName}; reviewed application ${correction.rank} ${correction.name}. ${CORRECTED_2026_B_RESCUE_FLOAT_PROVENANCE}`;
  }
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
