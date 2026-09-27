import type { PositionRule } from '@mbfd/eligibility';
import type { ConfiguredScoring } from '@mbfd/shared';
import { buildCorrected2026SemanticRoles } from './corrected-2026-semantic-roles.js';
import { buildCorrected2026Topology } from './corrected-2026-topology.js';

const OPERATIONS = [
  'Hazardous Materials Operations',
  'Rope Rescue Operations',
  'Vehicle & Machinery Rescue Operations',
  'Confined Space Operations',
  'Structural Collapse Operations',
  'Trench Rescue Operations',
];
const TECHNICIANS = [
  'State Certified Hazardous Materials Technician',
  'Rope Rescue Technician',
  'Vehicle & Machinery Rescue Technician',
  'Confined Space Technician',
  'Structural Collapse Technician',
  'Trench Rescue Technician',
];
const MARINE_COMMON = [
  'Merchant Mariner Credential (MMC)',
  'IADRS Swim Evaluation',
  'Open Water Diver Certified',
  'Hazardous Materials Awareness',
];

type ScoreItem = ConfiguredScoring['total'][number]['items'][number];
const scoreItem = (credential: string, requiresAll: string[] = []): ScoreItem => ({
  credential,
  alternatives: [],
  requiresAll,
  points: 1,
});

function scoring(
  groups: ConfiguredScoring['total'] = [],
  so: ConfiguredScoring['so'] = [],
  orderedPreference?: ConfiguredScoring['orderedPreference'],
): ConfiguredScoring {
  return { v: 1, total: groups, so, mo: [], ...(orderedPreference ? { orderedPreference } : {}) };
}

function specialtyScoring(): ConfiguredScoring['total'][number] {
  return {
    id: 'special-operations-2026',
    cap: 13,
    items: [
      ...OPERATIONS.map((credential) => scoreItem(credential)),
      ...TECHNICIANS.map((credential) => scoreItem(credential, OPERATIONS)),
      scoreItem('Drone Operator Qualified-Part 107 sUAS'),
    ],
  };
}

function preferenceGroup(id: string, credentials: string[]): ConfiguredScoring['total'][number] {
  return { id, cap: credentials.length, items: credentials.map((name) => scoreItem(name)) };
}

export interface Corrected2026DraftRuleSet {
  status: 'DRAFT_BLOCKED_NOT_FOR_PRODUCTION';
  rules: PositionRule[];
  blockingIssues: string[];
}

/** Construct new rules from final semantic roles. This intentionally does not
 * read 2026_rules.json or inherit any rule by a coincident numeric identity.
 * Source credential/evidence gaps below remain explicit production blockers. */
export function buildCorrected2026DraftRules(): Corrected2026DraftRuleSet {
  const byId = new Map(buildCorrected2026Topology().map((position) => [position.id, position]));
  const roles = buildCorrected2026SemanticRoles();
  const rules: PositionRule[] = [];
  for (const role of roles) {
    if (role.bidParticipation !== 'BIDDABLE') continue;
    const position = byId.get(role.positionId);
    if (!position) throw new Error(`corrected_2026_position_missing:${role.positionId}`);
    const credentials: string[] = [];
    const custom: PositionRule['requiredCriteria']['custom'] = [];
    const service: NonNullable<PositionRule['requiredCriteria']['service']> = [];
    const groups: ConfiguredScoring['total'] = [];
    let orderedPreference: ConfiguredScoring['orderedPreference'];
    const isStationTwo = position.station === 'Station #2';
    if (isStationTwo) groups.push(specialtyScoring());

    switch (role.roleFamily) {
      case 'DAYS_OPEN': {
        // The four open Days roles are resolved by their current final role,
        // never by the old A/B/C rule IDs.
        credentials.push('Firesafety Inspector I');
        if (position.unit === 'Special Events' && position.rankRequired === 'CPT')
          groups.push(
            preferenceGroup('special-events', ['NFPA 1123', 'NFPA 1126', 'RN 8312', 'RN 8313']),
          );
        if (position.unit === 'Public Education' && position.rankRequired === 'LT')
          groups.push({
            id: 'fire-prevention',
            cap: null,
            items: [],
            preference: {
              mode: 'BINARY_CUMULATIVE',
              sourceRef: 'Final July 2026 Bid Policy Procedure 3(c)',
              criteria: [
                ...[
                  'Instructor I',
                  'Firesafety Inspector I',
                  'Fire & Life Safety Educator I',
                  'Car Seat Technician',
                ].map((credential) => ({ credential, alternatives: [], requiresAll: [] })),
                { credential: 'RN8977 I', alternatives: [], requiresAll: ['RN8977 II'] },
              ],
            },
          });
        break;
      }
      case 'CAPTAIN_5':
        custom.push('paramedic');
        service.push({ serviceCode: 'RESCUE_DIVISION', minimumMonths: 36 });
        groups.push(
          preferenceGroup('captain-five', [
            'Instructor I',
            'Advance Cardiac Life Support (ACLS) INSTRUCTOR AHA',
            'Pediatric Advanced Life Support (PALS) INSTRUCTOR AHA',
            'Basic Life Support (BLS) INSTRUCTOR AHA',
            'State of Florida Incident Safety Officer',
          ]),
        );
        break;
      case 'FIRE_INVESTIGATOR':
        credentials.push(
          'Fire Investigator (FL cert issued 2015 or later)',
          'Firesafety Inspector I',
        );
        groups.push({
          id: 'investigator-non-cfi-preferences',
          cap: 3,
          excludesAny: ['Certified Fire Investigator (IAAI-CFI)'],
          items: [
            scoreItem('IAAI Expert Witness Courtroom Testimony'),
            scoreItem('Criminal Interview and Interrogation Techniques'),
            scoreItem('Certified Fire and Explosion Investigator'),
          ],
        });
        orderedPreference = {
          mode: 'ORDERED_QUALIFICATIONS',
          sourceRef: 'Final July 2026 Bid Policy Procedure 3(e)',
          criteria: [
            {
              credential: 'Certified Fire Investigator (IAAI-CFI)',
              alternatives: [],
              requiresAll: [],
            },
          ],
        };
        break;
      case 'AIR_TECH':
        credentials.push(
          'Driver Engineer Qualified',
          'SCOTT SCBA Technician',
          'Cylinder Hazmat & FSO Compliance (AIR TECH REQUIREMENT)',
        );
        groups.push(preferenceGroup('air-tech-car-seat', ['Car Seat Technician']));
        break;
      case 'MARINE_OFFICER':
      case 'MARINE_OPERATOR':
      case 'MARINE_ENGINEER':
      case 'MARINE_DECKHAND':
      case 'MARINE_FLOAT': {
        const marineCredential = {
          MARINE_OFFICER: 'Metal Craft Officer Credential',
          MARINE_OPERATOR: 'Metal Craft Boat Operator Credential',
          MARINE_ENGINEER: 'Metal Craft Engineer Credential',
          MARINE_DECKHAND: 'Metal Craft Deckhand Credential',
          MARINE_FLOAT: 'Metal Craft Deckhand Credential',
        }[role.roleFamily];
        credentials.push(...MARINE_COMMON, marineCredential);
        if (role.roleFamily === 'MARINE_OPERATOR' || role.roleFamily === 'MARINE_ENGINEER')
          credentials.push('Driver Engineer Qualified');
        groups.push(
          preferenceGroup(
            'marine-preferences',
            role.roleFamily === 'MARINE_OFFICER'
              ? ['Public Safety Diver']
              : ['Public Safety Diver', 'Car Seat Technician'],
          ),
        );
        break;
      }
      case 'RESCUE_FLOAT_LT':
      case 'RESCUE_FLOAT_FF':
      case 'ORDINARY_RESCUE':
      case 'SPECIAL_OPS_RESCUE':
        custom.push('paramedic');
        break;
      case 'DRIVER_ENGINEER':
      case 'COMBAT_FLOAT_DE':
        credentials.push('Driver Engineer Qualified');
        break;
      case 'SPECIAL_OPS_COMBAT':
      case 'COMBAT_FLOAT_CAPTAIN':
      case 'COMBAT_FLOAT_FF':
      case 'ORDINARY_COMBAT':
        break;
      default:
        throw new Error(`corrected_2026_rule_family_unhandled:${role.roleFamily}`);
    }
    rules.push({
      positionId: role.positionId,
      ruleBookVersion: '2026.corrected.draft',
      requiredCriteria: {
        rank: [position.rankRequired as 'CPT' | 'LT' | 'FF'],
        credentials,
        custom,
        ...(service.length > 0 ? { service } : {}),
      },
      pointsPreference: {
        max: 0,
        items: [],
        scoring: scoring(groups, isStationTwo ? [specialtyScoring()] : [], orderedPreference),
      },
      tieBreakChain: [
        'points',
        ...(isStationTwo ? (['so_points'] as const) : []),
        position.rankRequired === 'FF'
          ? 'department_service_bid_ordinal'
          : 'time_in_grade_bid_ordinal',
      ],
    });
  }
  return {
    status: 'DRAFT_BLOCKED_NOT_FOR_PRODUCTION',
    rules,
    blockingIssues: [
      'DAYS_SOURCE_CREDENTIALS_AND_OPEN_ROLE_SCORING_REVIEW_REQUIRED',
      'INVESTIGATOR_STATE_CERTIFICATION_AND_IAAI_CFI_MAPPING_REVIEW_REQUIRED',
      'MARINE_VALID_MMC_OUPV_PASSING_IADRS_AND_PSD_ISSUER_EVIDENCE_REVIEW_REQUIRED',
      'MARINE_DRI_THREE_MONTHS_FROM_APPROVED_BID_START_DATE_NOT_YET_CONFIGURED',
      'ORDINARY_RESCUE_PARAMEDIC_REQUIREMENT_SOURCE_REVIEW_REQUIRED',
      'SPECIAL_OPS_POINTS_PRIORITY_AND_FINAL_ROLE_SCORING_REVIEW_REQUIRED',
    ],
  };
}
