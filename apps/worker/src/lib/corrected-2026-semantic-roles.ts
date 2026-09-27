import { buildCorrected2026Topology } from './corrected-2026-topology.js';
import type { ReviewedPosition } from './reviewed-2026-source.js';

export const CLOSED_2026_POSITION_IDS = new Set(['D201', 'D301', 'D401', 'D402']);
export const PROTECTED_2026_POSITION_IDS = new Set(['A211', 'B211', 'C211', 'A801']);

export interface Corrected2026SemanticRole {
  positionId: string;
  roleFamily: string;
  policyRef: string;
  bidParticipation: 'BIDDABLE' | 'ADMIN_ASSIGNED' | 'CLOSED';
  rank: string;
  identityOrigin: 'MASTER_WORKBOOK' | 'APPLICATION_CANONICAL';
  ruleReview: 'REQUIRED' | 'NOT_APPLICABLE';
}

/** Classify by reviewed role attributes, never by a legacy rule's numeric ID. */
export function corrected2026Role(position: ReviewedPosition): Corrected2026SemanticRole {
  const name = position.positionName.toUpperCase();
  const unit = String(position.unit).toUpperCase();
  const id = position.id;
  const isCanonicalFloatCaptain = /^[ABC]718$/.test(id);
  let roleFamily: string;
  let policyRef: string;
  if (['A211', 'B211', 'C211'].includes(id)) {
    roleFamily = 'DIVISION_CHIEF';
    policyRef = 'Protected administrative assignment; not an ordinary Bid opportunity';
  } else if (id === 'A801') {
    roleFamily = 'UNION_PRESIDENT';
    policyRef = 'MASTER count exclusion; legacy A701 organizational role';
  } else if (position.shift === 'D') {
    roleFamily = CLOSED_2026_POSITION_IDS.has(id) ? 'DAYS_CLOSED' : 'DAYS_OPEN';
    policyRef = 'Final July 2026 Bid Policy Procedures 3-6 and Bid Selection 5';
  } else if (isCanonicalFloatCaptain) {
    roleFamily = 'COMBAT_FLOAT_CAPTAIN';
    policyRef = 'Legacy Captain #1 (C); staffing guideline; final policy Procedure 11';
  } else if (position.station === 'Station #6') {
    const marineRole = id.endsWith('01')
      ? 'MARINE_OFFICER'
      : id.endsWith('02')
        ? 'MARINE_OPERATOR'
        : id.endsWith('03')
          ? 'MARINE_ENGINEER'
          : id.endsWith('04')
            ? 'MARINE_DECKHAND'
            : position.isFloating
              ? 'MARINE_FLOAT'
              : null;
    if (!marineRole) throw new Error(`unclassified_2026_marine_position:${id}`);
    roleFamily = marineRole;
    policyRef = 'Final July 2026 Bid Policy Procedure 8';
  } else if (unit === 'CAPTAIN 5') {
    roleFamily = 'CAPTAIN_5';
    policyRef = 'Final July 2026 Bid Policy Procedures 6(b) and 7';
  } else if (name.includes('INV')) {
    roleFamily = 'FIRE_INVESTIGATOR';
    policyRef = 'Final July 2026 Bid Policy Procedure 3(e) and Procedure 13';
  } else if (/\bAT\b/.test(name)) {
    roleFamily = 'AIR_TECH';
    policyRef = 'Final July 2026 Bid Policy Procedure 7(a)';
  } else if (position.isFloating && position.division === 'Rescue') {
    roleFamily = position.rankRequired === 'LT' ? 'RESCUE_FLOAT_LT' : 'RESCUE_FLOAT_FF';
    policyRef = 'Final July 2026 Bid Policy Procedure 11(b)';
  } else if (position.isFloating && name.includes('DE')) {
    roleFamily = 'COMBAT_FLOAT_DE';
    policyRef = 'Final July 2026 Bid Policy Procedures 11(a) and 12';
  } else if (position.isFloating) {
    roleFamily = 'COMBAT_FLOAT_FF';
    policyRef = 'Final July 2026 Bid Policy Procedure 11(a)';
  } else if (name.includes('DE')) {
    roleFamily = 'DRIVER_ENGINEER';
    policyRef = 'Final July 2026 Bid Policy Procedures 12-13';
  } else if (position.station === 'Station #2') {
    roleFamily = position.division === 'Rescue' ? 'SPECIAL_OPS_RESCUE' : 'SPECIAL_OPS_COMBAT';
    policyRef = 'Final July 2026 Bid Policy Procedure 7';
  } else if (position.division === 'Rescue') {
    roleFamily = 'ORDINARY_RESCUE';
    policyRef = 'Final July 2026 Bid Policy rank and qualification procedures';
  } else if (position.division === 'Combat') {
    roleFamily = 'ORDINARY_COMBAT';
    policyRef = 'Final July 2026 Bid Policy Bid Selection 4 and Procedure 13';
  } else {
    throw new Error(`unclassified_2026_position:${id}`);
  }
  const bidParticipation = CLOSED_2026_POSITION_IDS.has(id)
    ? 'CLOSED'
    : PROTECTED_2026_POSITION_IDS.has(id)
      ? 'ADMIN_ASSIGNED'
      : 'BIDDABLE';
  return {
    positionId: id,
    roleFamily,
    policyRef,
    bidParticipation,
    rank: position.rankRequired,
    identityOrigin: isCanonicalFloatCaptain ? 'APPLICATION_CANONICAL' : 'MASTER_WORKBOOK',
    ruleReview: bidParticipation === 'BIDDABLE' ? 'REQUIRED' : 'NOT_APPLICABLE',
  };
}

export function buildCorrected2026SemanticRoles(): Corrected2026SemanticRole[] {
  return buildCorrected2026Topology().map(corrected2026Role);
}
