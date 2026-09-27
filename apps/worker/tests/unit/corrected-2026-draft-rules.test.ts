import { type Member, compare, evaluateEligibility } from '@mbfd/eligibility';
import { describe, expect, it } from 'vitest';
import { buildCorrected2026DraftRules } from '../../src/lib/corrected-2026-draft-rules.js';
import {
  obligationDueOn,
  postAwardObligationApplies,
} from '../../src/lib/post-award-obligations.js';

const candidate = buildCorrected2026DraftRules();
const rule = (id: string) => {
  const found = candidate.rules.find((item) => item.positionId === id);
  if (!found) throw new Error(`Missing candidate rule ${id}`);
  return found;
};
const operations = [
  'Hazardous Materials Operations',
  'Rope Rescue Operations',
  'Vehicle & Machinery Rescue Operations',
  'Confined Space Operations',
  'Structural Collapse Operations',
  'Trench Rescue Operations',
];
const technicians = [
  'State Certified Hazardous Materials Technician',
  'Rope Rescue Technician',
  'Vehicle & Machinery Rescue Technician',
  'Confined Space Technician',
  'Structural Collapse Technician',
  'Trench Rescue Technician',
];
function candidateMember(rank: Member['rank'], names: string[], ordinal: number): Member {
  return {
    employeeId: `synthetic-${ordinal}`,
    firstName: '',
    lastName: '',
    rank,
    rscSeniority: ordinal,
    rankSeniority: ordinal,
    bidOrdinalEvidence: {
      datasetId: 'synthetic-golden',
      sourceSha256: 'a'.repeat(64),
      timeInGrade: ordinal,
      departmentService: ordinal,
    },
    isProbationary: false,
    credentials: names.map((name) => ({ name })),
  };
}

describe('corrected 2026 draft rules from semantic roles', () => {
  it('covers exactly the 223 current Bid opportunities and excludes all Chiefs', () => {
    expect(candidate.status).toBe('DRAFT_BLOCKED_NOT_FOR_PRODUCTION');
    expect(candidate.blockingIssues.length).toBeGreaterThan(0);
    expect(candidate.rules).toHaveLength(223);
    expect(new Set(candidate.rules.map((item) => item.positionId)).size).toBe(223);
    for (const id of ['A211', 'B211', 'C211', 'A801', 'D201', 'D301', 'D401', 'D402']) {
      expect(candidate.rules.map((item) => item.positionId)).not.toContain(id);
    }
  });

  it('creates independent CPT Float rules while retaining Rescue LT and Combat FF ranks', () => {
    for (const shift of ['A', 'B', 'C']) {
      expect(rule(`${shift}718`).requiredCriteria).toMatchObject({
        rank: ['CPT'],
        credentials: [],
      });
      expect(rule(`${shift}213`).requiredCriteria.rank).toEqual(['LT']);
      expect(rule(`${shift}214`).requiredCriteria.rank).toEqual(['FF']);
      expect(rule(`${shift}707`).requiredCriteria.credentials).toContain(
        'Driver Engineer Qualified',
      );
    }
  });

  it('limits the July policy Paramedic minimum to explicit Rescue Float and Captain 5 roles', () => {
    for (const id of ['A109', 'A110', 'A205', 'A206']) {
      expect(
        rule(id).requiredCriteria.custom,
        `${id} is ordinary or Station 2 Rescue`,
      ).not.toContain('paramedic');
    }
    for (const id of ['A212', 'A213', 'A215'])
      expect(rule(id).requiredCriteria.custom, `${id} has an explicit policy minimum`).toContain(
        'paramedic',
      );
  });

  it('gives every Station #2 Float 2 seat Special Ops scoring and gates Technician points', () => {
    for (const shift of ['A', 'B', 'C']) {
      for (const suffix of ['213', '214', '215', '718']) {
        const candidateRule = rule(`${shift}${suffix}`);
        const scoring = candidateRule.pointsPreference.scoring;
        const group = scoring?.so.find((item) => item.id === 'special-operations-2026');
        expect(group, `${shift}${suffix} needs Station #2 scoring`).toBeDefined();
        expect(group?.cap).toBe(13);
        expect(group?.items).toHaveLength(13);
        expect(group?.items.slice(0, 6).every((item) => item.points === 1)).toBe(true);
        expect(group?.items.slice(6, 12).every((item) => item.requiresAll.length === 6)).toBe(true);
        expect(group?.items[12]?.credential).toBe('Drone Operator Qualified-Part 107 sUAS');
        expect(candidateRule.tieBreakChain).toContain('so_points');
      }
    }
  });

  it('combines Station #2 scoring exactly once with each role-specific preference', () => {
    const cases: { id: string; rank: Member['rank']; extra: string[] }[] = [
      { id: 'A201', rank: 'CPT', extra: [] }, // ordinary Combat
      { id: 'A205', rank: 'LT', extra: [] }, // ordinary Rescue
      { id: 'A202', rank: 'FF', extra: [] }, // Driver Engineer
      {
        id: 'A212',
        rank: 'CPT',
        extra: [
          'Instructor I',
          'Advance Cardiac Life Support (ACLS) INSTRUCTOR AHA',
          'Pediatric Advanced Life Support (PALS) INSTRUCTOR AHA',
          'Basic Life Support (BLS) INSTRUCTOR AHA',
          'State of Florida Incident Safety Officer',
        ],
      }, // Captain 5
      { id: 'A203', rank: 'FF', extra: ['Car Seat Technician'] }, // Air Tech
      { id: 'A213', rank: 'LT', extra: [] }, // Rescue Float Lieutenant
      { id: 'A214', rank: 'FF', extra: [] }, // Combat Float Firefighter
      { id: 'A215', rank: 'FF', extra: [] }, // Rescue Float Firefighter
      { id: 'A718', rank: 'CPT', extra: [] }, // Float 2 Captain
    ];
    for (const item of cases) {
      const candidateRule = rule(item.id);
      const scoring = candidateRule.pointsPreference.scoring;
      const so = scoring?.so.find((group) => group.id === 'special-operations-2026');
      expect(so?.cap, item.id).toBe(13);
      expect(
        scoring?.total.map((group) => group.id),
        item.id,
      ).toEqual([
        'special-operations-2026',
        ...(item.id === 'A212'
          ? ['captain-five']
          : item.id === 'A203'
            ? ['air-tech-car-seat']
            : []),
      ]);
      expect(candidateRule.tieBreakChain, item.id).toEqual([
        'points',
        'so_points',
        item.rank === 'FF' ? 'department_service_bid_ordinal' : 'time_in_grade_bid_ordinal',
      ]);
      const credentials = [
        ...new Set([
          ...candidateRule.requiredCriteria.credentials,
          ...operations,
          ...technicians,
          'Drone Operator Qualified-Part 107 sUAS',
          'Paramedic',
          ...item.extra,
        ]),
      ];
      const member = candidateMember(item.rank, credentials, 1);
      if (item.id === 'A212')
        member.serviceCredits = [
          {
            serviceCode: 'RESCUE_DIVISION',
            verifiedMonths: 36,
            effectiveOn: '2026-01-01',
            recordId: 'synthetic-service',
            sourceRef: 'synthetic reviewed service',
            actorSubject: 'synthetic-actor',
          },
        ];
      expect(evaluateEligibility(member, candidateRule), item.id).toMatchObject({
        eligible: true,
        points: 13 + item.extra.length,
        soPoints: 13,
      });
    }
  });

  it('ranks the corrected Float Captain by 6 Operations, gated Technicians and Part 107', () => {
    const captainRule = rule('A718');
    const partial = candidateMember(
      'CPT',
      [...operations.slice(1), ...technicians, 'Drone Operator Qualified-Part 107 sUAS'],
      1,
    );
    const allOps = candidateMember('CPT', operations, 2);
    const allPoints = candidateMember(
      'CPT',
      [...operations, ...technicians, 'Drone Operator Qualified-Part 107 sUAS'],
      3,
    );
    const partialResult = evaluateEligibility(partial, captainRule);
    const allOpsResult = evaluateEligibility(allOps, captainRule);
    const allPointsResult = evaluateEligibility(allPoints, captainRule);
    expect(partialResult).toMatchObject({ eligible: true, points: 6, soPoints: 6 });
    expect(allOpsResult).toMatchObject({ eligible: true, points: 6, soPoints: 6 });
    expect(allPointsResult).toMatchObject({ eligible: true, points: 13, soPoints: 13 });
    const comparable = (member: Member, result: typeof allPointsResult) => ({
      ...result,
      rscSeniority: member.rscSeniority,
      rankSeniority: member.rankSeniority ?? 0,
      bidOrdinalEvidence: member.bidOrdinalEvidence,
    });
    expect(
      compare(
        comparable(allPoints, allPointsResult),
        comparable(allOps, allOpsResult),
        captainRule.tieBreakChain,
      ),
    ).toBe(-1);
    expect(
      compare(
        comparable(partial, partialResult),
        comparable(allOps, allOpsResult),
        captainRule.tieBreakChain,
      ),
    ).toBe(-1); // Equal points: reviewed time-in-grade ordinal wins.
  });

  it('keeps Air Tech minimums separate from Special Ops and car-seat preferences', () => {
    const airTech = rule('A203');
    const minimums = [
      'Driver Engineer Qualified',
      'SCOTT SCBA Technician',
      'Cylinder Hazmat & FSO Compliance (AIR TECH REQUIREMENT)',
    ];
    const full = evaluateEligibility(
      candidateMember(
        'FF',
        [
          ...minimums,
          ...operations,
          ...technicians,
          'Drone Operator Qualified-Part 107 sUAS',
          'Car Seat Technician',
        ],
        1,
      ),
      airTech,
    );
    expect(full).toMatchObject({ eligible: true, points: 14, soPoints: 13 });
    expect(
      evaluateEligibility(candidateMember('FF', [...minimums, ...operations], 2), airTech),
    ).toMatchObject({ eligible: true, points: 6, soPoints: 6 });
    for (const missing of minimums) {
      const result = evaluateEligibility(
        candidateMember(
          'FF',
          minimums.filter((name) => name !== missing),
          3,
        ),
        airTech,
      );
      expect(result.eligible, `Air Tech must require ${missing}`).toBe(false);
    }
  });

  it('data-blocks Marine eligibility when the baseline has only generic MMC and IADRS labels', () => {
    const marine = rule('A602');
    const generic = candidateMember(
      'FF',
      [
        'Merchant Mariner Credential (MMC)',
        'IADRS Swim Evaluation',
        'Open Water Diver Certified',
        'Hazardous Materials Awareness',
        'Metal Craft Boat Operator Credential',
        'Driver Engineer Qualified',
        'Public Safety Diver',
      ],
      1,
    );
    const result = evaluateEligibility(generic, marine);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'CRED_MISSING',
          label: 'Missing required: Valid OUPV / Six Pack Authority',
        }),
        expect.objectContaining({
          code: 'CRED_MISSING',
          label: 'Missing required: Passing IADRS Watermanship Test',
        }),
      ]),
    );
    expect(
      evaluateEligibility(
        {
          ...generic,
          credentials: [
            ...generic.credentials,
            { name: 'Valid OUPV / Six Pack Authority' },
            { name: 'Passing IADRS Watermanship Test' },
          ],
        },
        marine,
      ).eligible,
    ).toBe(true);
  });

  it('freezes the DRI transition against an explicit approved Bid start date', () => {
    expect(() => buildCorrected2026DraftRules({ approvedBidStartOn: '2026-02-30' })).toThrow(
      'approved_2026_bid_start_date_invalid',
    );
    const configured = buildCorrected2026DraftRules({ approvedBidStartOn: '2026-10-24' });
    expect(configured.blockingIssues).not.toContain(
      'MARINE_DRI_THREE_MONTHS_FROM_APPROVED_BID_START_DATE_NOT_YET_CONFIGURED',
    );
    for (const shift of ['A', 'B', 'C']) {
      for (const suffix of ['601', '602', '603', '604', '605', '606']) {
        expect(
          configured.rules.find((item) => item.positionId === `${shift}${suffix}`)?.requiredCriteria
            .postAward,
        ).toEqual([
          {
            id: '2026-marine-open-water-to-dri',
            credential: 'DRI Public Safety Diver',
            sourceRef: 'Final July 2026 Bid Policy Procedure 8(f)(i)',
            appliesWhenMissingAll: ['DRI Public Safety Diver', 'PADI Public Safety Diver'],
            deadline: {
              basis: 'APPROVED_BID_START_DATE',
              startOn: '2026-10-24',
              unit: 'CALENDAR_MONTHS',
              count: 3,
              timeZone: 'America/New_York',
            },
          },
          {
            id: '2026-marine-padi-to-dri-continuing-training',
            credential: 'DRI Public Safety Diver',
            sourceRef: 'Final July 2026 Bid Policy Procedure 8(f)(ii)',
            appliesWhenMissingAll: ['DRI Public Safety Diver'],
            appliesWhenHoldingAny: ['PADI Public Safety Diver'],
            deadline: null,
          },
        ]);
      }
    }
  });

  it('separates Open Water deadline from PADI continuing-training transition without changing Marine minimums', () => {
    const marine = buildCorrected2026DraftRules({ approvedBidStartOn: '2026-10-24' }).rules.find(
      (item) => item.positionId === 'A602',
    );
    if (!marine) throw new Error('Missing Marine rule');
    const terms = marine.requiredCriteria.postAward ?? [];
    const minimums = marine.requiredCriteria.credentials;
    const cases = [
      { additional: [], expected: ['2026-marine-open-water-to-dri'] },
      {
        additional: ['PADI Public Safety Diver'],
        expected: ['2026-marine-padi-to-dri-continuing-training'],
      },
      { additional: ['DRI Public Safety Diver'], expected: [] },
      { additional: ['PADI Public Safety Diver', 'DRI Public Safety Diver'], expected: [] },
    ];
    for (const item of cases) {
      const credentials = [...minimums, ...item.additional];
      expect(evaluateEligibility(candidateMember('FF', credentials, 1), marine).eligible).toBe(
        true,
      );
      const applicable = terms.filter((term) => postAwardObligationApplies(term, credentials));
      expect(applicable.map((term) => term.id)).toEqual(item.expected);
      expect(
        applicable.map((term) =>
          obligationDueOn(Date.parse('2026-10-25T12:00:00Z'), term.deadline),
        ),
      ).toEqual(
        item.expected.length === 0 ? [] : item.additional.length === 0 ? ['2027-01-24'] : [null],
      );
    }
    expect(
      evaluateEligibility(
        candidateMember(
          'FF',
          minimums.filter((name) => name !== 'Valid OUPV / Six Pack Authority'),
          2,
        ),
        marine,
      ).eligible,
    ).toBe(false);
  });

  it('maps Investigator, Captain 5, Air Tech and Marine requirements by current roles', () => {
    for (const shift of ['A', 'B', 'C']) {
      expect(rule(`${shift}305`).requiredCriteria.credentials).toEqual([
        'Fire Investigator (FL cert issued 2015 or later)',
        'Firesafety Inspector I',
      ]);
      expect(
        rule(`${shift}305`).pointsPreference.scoring?.orderedPreference?.criteria[0]?.credential,
      ).toBe('Certified Fire Investigator (IAAI-CFI)');
      expect(rule(`${shift}303`).requiredCriteria.credentials).toEqual([
        'Driver Engineer Qualified',
      ]);
      expect(rule(`${shift}212`).requiredCriteria).toMatchObject({
        rank: ['CPT'],
        custom: ['paramedic'],
        service: [{ serviceCode: 'RESCUE_DIVISION', minimumMonths: 36 }],
      });
      expect(rule(`${shift}212`).requiredCriteria.postAward).toBeUndefined();
      expect(rule(`${shift}203`).requiredCriteria.credentials).toEqual([
        'Driver Engineer Qualified',
        'SCOTT SCBA Technician',
        'Cylinder Hazmat & FSO Compliance (AIR TECH REQUIREMENT)',
      ]);
      expect(rule(`${shift}601`).requiredCriteria.rank).toEqual(['CPT']);
      for (const suffix of ['601', '602', '603', '604', '605', '606']) {
        expect(rule(`${shift}${suffix}`).requiredCriteria.credentials).toEqual(
          expect.arrayContaining([
            'Merchant Mariner Credential (MMC)',
            'Valid OUPV / Six Pack Authority',
            'Passing IADRS Watermanship Test',
            'Open Water Diver Certified',
            'Hazardous Materials Awareness',
          ]),
        );
        expect(rule(`${shift}${suffix}`).requiredCriteria.credentials).not.toContain(
          'IADRS Swim Evaluation',
        );
        const marinePreference = rule(`${shift}${suffix}`).pointsPreference.scoring?.total.find(
          (group) => group.id === 'marine-preferences',
        );
        expect(marinePreference?.items[0]).toMatchObject({
          credential: 'DRI Public Safety Diver',
          alternatives: ['PADI Public Safety Diver'],
        });
      }
      expect(rule(`${shift}602`).requiredCriteria.credentials).toContain(
        'Metal Craft Boat Operator Credential',
      );
      expect(rule(`${shift}603`).requiredCriteria.credentials).toContain(
        'Metal Craft Engineer Credential',
      );
      for (const suffix of ['604', '605', '606'])
        expect(rule(`${shift}${suffix}`).requiredCriteria.credentials).toContain(
          'Metal Craft Deckhand Credential',
        );
    }
  });
});
