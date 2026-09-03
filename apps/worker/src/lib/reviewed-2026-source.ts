import positionsFixture from '../../seed/fixtures/2026_positions.json';
import rulesFixture from '../../seed/fixtures/2026_rules.json';

export const REVIEWED_2026_SOURCE_TEMPLATE = '2026.1';
export const REVIEWED_2026_DRAFT_RULE_BOOK = '2026.2';

export const REVIEWED_2026_SOURCE_PROVENANCE = {
  policySha256: '1009c5bf47c05136c939fc61db1fa3147f902f263b466904c0567907f3bb374a',
  staffingGuidelinesSha256: 'c13364c0ea9333383b70e3c8578640fc097a2af4dddfde863170383db1328659',
  assignmentsSha256: '85e44bfe271b1fed45bd22f974547200c2c6ff5015aa7c58878eca7aca520b39',
  credentialsPackageSha256: 'c27bc799c45310d1073593b1258dbca5d3f1f534d06f8b73f4e707f600fb55d7',
  workbookPackageSha256: '87cdf8d4499d1e7cec0baeeb7dcd1eb0fc207350f3b9a4057bba352b7c5b3878',
} as const;

export interface ReviewedPosition {
  id: string;
  shift: 'A' | 'B' | 'C' | 'D';
  station: string;
  division: string;
  unit: string;
  rankRequired: 'FF' | 'LT' | 'CPT' | 'DC';
  positionName: string;
  isFloating: boolean;
  isVacantByDesign: boolean;
  isExcludedFromCount: boolean;
}

interface FixtureRule {
  positionId: string;
  requiredCriteria: { rank: string[]; credentials: string[]; custom: string[] };
  pointsPreference: { max: number; items: unknown[] };
  tieBreakChain: string[];
  notes?: string | null;
}

export interface ReviewedRule {
  positionId: string;
  requiredCriteria: string;
  pointsPreference: string;
  tieBreakChain: string;
  notes: string | null;
}

const ADMINISTRATIVE_POSITION_IDS = new Set(['A211', 'B211', 'C211']);
const NEW_MARINE_POSITION_ID = /^[ABC]61[456]$/;

function defaultRule(position: ReviewedPosition): FixtureRule {
  const isRescue =
    position.division === 'Rescue' || position.unit.toLocaleLowerCase('en-US').includes('rescue');
  const credentials =
    isRescue && position.rankRequired !== 'LT' && position.rankRequired !== 'CPT'
      ? ['Paramedic']
      : [];
  return {
    positionId: position.id,
    requiredCriteria: { rank: [position.rankRequired], credentials, custom: [] },
    pointsPreference: { max: 0, items: [] },
    tieBreakChain: ['points', 'rsc_seniority', 'rank_seniority'],
    notes: 'Source-derived placeholder retained for administrator review before publication',
  };
}

/**
 * Produces the immutable 2026.1 source shape consumed by the reviewed
 * Station 6 reconciliation. The checked-in fixture is the reconciled 242-seat
 * candidate; removing the nine new 614-616 Marine roles recovers the 233-seat
 * source snapshot without inventing data absent from the supplied package.
 */
export function buildReviewed2026Source(): {
  positions: ReviewedPosition[];
  rules: ReviewedRule[];
  administrativePositionIds: string[];
} {
  const positions = (positionsFixture as ReviewedPosition[]).filter(
    (position) => !NEW_MARINE_POSITION_ID.test(position.id),
  );
  const explicitRules = new Map(
    (rulesFixture as FixtureRule[]).map((rule) => [rule.positionId, rule]),
  );
  const rules = positions
    .filter(
      (position) => !position.isExcludedFromCount && !ADMINISTRATIVE_POSITION_IDS.has(position.id),
    )
    .map((position) => {
      const rule = explicitRules.get(position.id) ?? defaultRule(position);
      return {
        positionId: position.id,
        requiredCriteria: JSON.stringify(rule.requiredCriteria),
        pointsPreference: JSON.stringify(rule.pointsPreference),
        tieBreakChain: JSON.stringify(rule.tieBreakChain),
        notes: rule.notes ?? null,
      };
    });
  const administrativePositionIds = [...ADMINISTRATIVE_POSITION_IDS].sort((a, b) =>
    a.localeCompare(b),
  );

  if (positions.length !== 233 || rules.length !== 229) {
    throw new Error(
      `reviewed_2026_source_shape_invalid:positions=${positions.length}:rules=${rules.length}`,
    );
  }
  return { positions, rules, administrativePositionIds };
}
