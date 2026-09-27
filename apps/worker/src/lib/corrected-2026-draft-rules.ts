import type { PositionRule } from '@mbfd/eligibility';
import { type ConfiguredScoring, CredentialEvaluationDateSchema } from '@mbfd/shared';
import { buildCorrected2026SemanticRoles } from './corrected-2026-semantic-roles.js';
import { buildCorrected2026Topology } from './corrected-2026-topology.js';
import {
  MARINE_OUPV_AUTHORITY,
  MARINE_PASSING_WATERMANSHIP,
  MARINE_PSD_DRI,
  MARINE_PSD_PADI,
} from './policy-2026-credentials.js';

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
  MARINE_OUPV_AUTHORITY,
  MARINE_PASSING_WATERMANSHIP,
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
  blockerReview: {
    issue: string;
    classification:
      | 'SOURCE_CAN_RESOLVE'
      | 'DATA_EVIDENCE_MISSING'
      | 'ADMIN_SETTING_REQUIRED'
      | 'TRUE_POLICY_AMBIGUITY';
    finding: string;
  }[];
}

/** Construct new rules from final semantic roles. This intentionally does not
 * read 2026_rules.json or inherit any rule by a coincident numeric identity.
 * Source credential/evidence gaps below remain explicit production blockers. */
export function buildCorrected2026DraftRules(
  options: {
    approvedBidStartOn?: string;
  } = {},
): Corrected2026DraftRuleSet {
  if (
    options.approvedBidStartOn !== undefined &&
    !CredentialEvaluationDateSchema.safeParse(options.approvedBidStartOn).success
  )
    throw new Error('approved_2026_bid_start_date_invalid');
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
    const postAward: NonNullable<PositionRule['requiredCriteria']['postAward']> = [];
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
            preferenceGroup('special-events', [
              'NFPA1123 Outdoor Fireworks',
              'NFPA1126 Indoor Pyrotechnics',
              'RN8312 Assembly Occupancies',
              'Crowd Manager Certificate (RN8313)',
            ]),
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
                {
                  credential: 'RN8977 Youth Fire Setter Prevention and Intervention course I',
                  alternatives: [],
                  requiresAll: ['RN8977 Youth Fire Setter Prevention and Intervention course II'],
                },
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
        groups.push({
          id: 'marine-preferences',
          cap: role.roleFamily === 'MARINE_OFFICER' ? 1 : 2,
          items: [
            { ...scoreItem(MARINE_PSD_DRI), alternatives: [MARINE_PSD_PADI] },
            ...(role.roleFamily === 'MARINE_OFFICER' ? [] : [scoreItem('Car Seat Technician')]),
          ],
        });
        if (options.approvedBidStartOn)
          postAward.push({
            id: '2026-marine-dri-transition',
            credential: MARINE_PSD_DRI,
            sourceRef: 'Final July 2026 Bid Policy Procedure 8(f)(i-ii)',
            appliesWhenMissingAll: [MARINE_PSD_DRI, MARINE_PSD_PADI],
            deadline: {
              basis: 'APPROVED_BID_START_DATE',
              startOn: options.approvedBidStartOn,
              unit: 'CALENDAR_MONTHS',
              count: 3,
              timeZone: 'America/New_York',
            },
          });
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
        ...(postAward.length > 0 ? { postAward } : {}),
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
      'POLICY_2026_CATALOG_DEFINITIONS_NOT_YET_CONFIRMED_IN_RUNTIME',
      'MARINE_PERSON_SPECIFIC_OUPV_PASSING_IADRS_AND_PSD_ISSUER_EVIDENCE_MISSING',
      ...(options.approvedBidStartOn
        ? []
        : ['MARINE_DRI_THREE_MONTHS_FROM_APPROVED_BID_START_DATE_NOT_YET_CONFIGURED']),
      'CORRECTED_VERSION_EVALUATION_AS_OF_DATE_AND_PERSONNEL_EVIDENCE_NOT_YET_REVIEWED',
    ],
    blockerReview: [
      {
        issue: 'Days and Investigator catalog names',
        classification: 'SOURCE_CAN_RESOLVE',
        finding:
          'Final July policy Procedures 3(b), 3(c), and 3(e) define the names. Create missing identities through the audited credential catalog; this does not assign member evidence.',
      },
      {
        issue: 'Ordinary and Float Rescue paramedic minimum',
        classification: 'SOURCE_CAN_RESOLVE',
        finding:
          'July policy Procedure 11(b) explicitly requires Rescue Float paramedics; the historical 2026 Rules and Points source requires Paramedic for the Rescue track and the final policy has no contrary ordinary-Rescue exception.',
      },
      {
        issue: 'Station #2 Special Ops cumulative scoring and Float 2 Captain placement',
        classification: 'SOURCE_CAN_RESOLVE',
        finding:
          'Direct administrator diagram review establishes Station #2 / Float 2; July policy Procedures 7 and 11 establish the 6+6+Part107 preference and Float exception. Golden tests verify gating and ranking.',
      },
      {
        issue: 'Marine OUPV, passing IADRS, and diver issuer per member',
        classification: 'DATA_EVIDENCE_MISSING',
        finding:
          'The approved baseline contains generic MMC, IADRS Swim Evaluation, and Public Safety Diver labels. Those labels do not prove OUPV authority, passing result, or DRI/PADI issuer.',
      },
      {
        issue: 'Marine DRI three-month deadline',
        classification: 'ADMIN_SETTING_REQUIRED',
        finding:
          'The policy fixes three calendar months from the approved Bid start date; that date must be explicitly configured before the post-award obligation can be frozen.',
      },
      {
        issue: 'Eligibility as-of date and current personnel evidence',
        classification: 'ADMIN_SETTING_REQUIRED',
        finding:
          'The administrator must select an eligibility evaluation date independent of the 2026-09-24 credential baseline revision; qualifications and personnel must be reviewed as of that date.',
      },
    ],
  };
}
