import rulesFixture from '../../seed/fixtures/2026_rules.json';
import positionsFixture from '../../seed/fixtures/final_2026_positions.json';

export const REVIEWED_2026_SOURCE_TEMPLATE = '2026.final.1';
export const REVIEWED_2026_DRAFT_RULE_BOOK = '2026.final.2';

export const REVIEWED_2026_SOURCE_PROVENANCE = {
  policySha256: 'a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc',
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
  source?: {
    workbookSha256: string;
    sheet: string;
    row: number;
    sourceDivision: string;
    sourceOrdinal: number;
    correction: string | null;
  };
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

const NON_OPPORTUNITY_POSITION_IDS = new Set(['A801', 'D201', 'D301', 'D401', 'D402']);

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
    notes: 'Final July 2026 policy baseline; specialty overrides remain explicit rules',
  };
}

/**
 * Produces the immutable final 2026 source shape extracted from the exact
 * MASTER workbook. Raw workbook labels and the two approved Combat corrections
 * remain in the fixture provenance; the legacy 242-seat fixture remains
 * available only for historical snapshots.
 */
export function buildReviewed2026Source(): {
  positions: ReviewedPosition[];
  rules: ReviewedRule[];
  administrativePositionIds: string[];
} {
  const positions = positionsFixture as ReviewedPosition[];
  const explicitRules = new Map(
    (rulesFixture as FixtureRule[]).map((rule) => [rule.positionId, rule]),
  );
  const rules = positions
    .filter(
      (position) => !position.isExcludedFromCount && !NON_OPPORTUNITY_POSITION_IDS.has(position.id),
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
  const administrativePositionIds = [...NON_OPPORTUNITY_POSITION_IDS].sort((a, b) =>
    a.localeCompare(b),
  );

  if (positions.length !== 228 || rules.length !== 223) {
    throw new Error(
      `reviewed_2026_source_shape_invalid:positions=${positions.length}:rules=${rules.length}`,
    );
  }
  return { positions, rules, administrativePositionIds };
}
