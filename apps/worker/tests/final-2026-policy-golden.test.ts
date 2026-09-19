import { type Member, type PositionRule, type Rank, evaluateEligibility } from '@mbfd/eligibility';
import {
  type AnnualRuleProfile,
  AnnualRuleProfilesSchema,
  type ConfiguredScoring,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { compileAnnualRules } from '../src/lib/annual-rule-compiler.js';

// Synthetic, test-only profiles derived from the final July 2026 policy and
// consistent numeric portions of the final calculation oracle. These tests do
// not establish published configuration, personnel evidence, catalog mapping,
// current credential validity, or deployment/Live acceptance.
// Policy SHA-256: a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc.
// Calculation oracle: 2026 Annual Bid Calculations v3.xlsx, SHA-256
// dcd5d13e91a4889157a54074335b87105765e6e0cd8aa1828542bec313133f58.
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
const drone = 'Drone Operator Qualified-Part 107 sUAS';
const de = 'Driver Engineer Qualified';
const paramedic = 'FL State - Paramedic';
const carSeat = 'Car Seat Technician';
const scott = 'SCOTT SCBA Technician';
const cylinder = 'Cylinder Hazmat & FSO Compliance';

function item(credential: string, requiresAll: string[] = [], alternatives: string[] = []) {
  return { credential, alternatives, requiresAll, points: 1 };
}

function scoring(items: ConfiguredScoring['total'][number]['items']): ConfiguredScoring {
  return {
    v: 1,
    total: [{ id: 'synthetic-source-preferences', cap: null, items }],
    so: [],
    mo: [],
  };
}

// PDF p4 Procedure7: six one-point Operations certificates; one additional
// point per Technician only after ALL six Operations; Part107 independently1.
// Points!CJ5:CL5 agrees. Points!DL5 is deliberately not reproduced: its
// incomplete-Operations branch incorrectly awards Technician points.
const specialOpsScoring = scoring([
  ...operations.map((name) => item(name)),
  ...technicians.map((name) => item(name, operations)),
  item(drone),
]);

function syntheticMember(credentials: string[], rank: Rank = 'FF'): Member {
  return {
    employeeId: 'synthetic-final-policy-member',
    firstName: '',
    lastName: '',
    rank,
    rscSeniority: 1,
    rankSeniority: 1,
    isProbationary: false,
    credentials: credentials.map((name) => ({ name })),
  };
}

function profile(
  id: string,
  rank: Rank,
  credentials: string[],
  points: ConfiguredScoring,
  sourceRef: string,
): AnnualRuleProfile {
  return {
    id,
    name: `Synthetic ${id}`,
    sourceRef,
    scope: { kind: 'position', positionId: id },
    requirements: { ranks: [rank], credentials, custom: [] },
    scoring: points,
    // These cases test eligibility/scoring, not seniority or unresolved ties.
    tieBreakChain: ['points'],
  };
}

function compile(source: AnnualRuleProfile, inherited: AnnualRuleProfile[] = []): PositionRule {
  const rank = source.requirements.ranks?.[0];
  if (!rank) throw new Error('Synthetic profile must declare its position rank');
  const result = compileAnnualRules(
    [{ id: source.id, rank, station: 'synthetic-station', shift: 'A' }],
    AnnualRuleProfilesSchema.parse([...inherited, source]),
    'synthetic-final-july-2026',
  );
  expect(result.conflicts).toEqual([]);
  expect(result.ok).toBe(true);
  const compiled = result.compiled[0];
  if (!compiled) throw new Error('Synthetic source profile did not compile');
  return compiled.rule;
}

function expectRejected(member: Member, rule: PositionRule) {
  expect(evaluateEligibility(member, rule)).toMatchObject({
    eligible: false,
    points: 0,
    soPoints: 0,
    moPoints: 0,
    breakdown: { itemized: [] },
  });
}

describe('final July2026 source golden cases through the profile compiler', () => {
  describe('six Operations prerequisites', () => {
    const rule = compile(
      profile('synthetic-special-ops', 'FF', [], specialOpsScoring, 'PDF p4 Procedure7'),
    );

    it('awards exactly13 for six Operations, six Technicians and Part107', () => {
      expect(
        evaluateEligibility(syntheticMember([...operations, ...technicians, drone]), rule),
      ).toMatchObject({ eligible: true, points: 13 });
    });

    it.each(operations)('withholds every Technician point when %s is missing', (missing) => {
      const result = evaluateEligibility(
        syntheticMember([...operations.filter((name) => name !== missing), ...technicians, drone]),
        rule,
      );
      expect(result).toMatchObject({ eligible: true, points: 6 });
      for (const credential of technicians)
        expect(result.breakdown.itemized).toContainEqual(
          expect.objectContaining({ credential, awarded: 0 }),
        );
    });

    it('awards one Technician increment after all six Operations, without inventing drone credit', () => {
      expect(
        evaluateEligibility(syntheticMember([...operations, 'Rope Rescue Technician']), rule),
      ).toMatchObject({ eligible: true, points: 7 });
      expect(evaluateEligibility(syntheticMember(technicians), rule)).toMatchObject({
        eligible: true,
        points: 0,
      });
    });
  });

  describe('Captain5 minimums and bounded preference alternatives', () => {
    // PDF p3 Procedure6(b) requires CPT, State Paramedic and36 cumulative
    // Rescue Division months. Rules & Points!B5 and Points!CF5 omit the last
    // two minimums; the omission is an intentional oracle divergence here.
    // Numeric preferences: Rules & Points!A8:C12; Points!BZ5:CE5, five groups1.
    const preferences = [
      item('Instructor I', [], ['Instructor II', 'Instructor III']),
      item('ACLS Instructor AHA', [], ['ACLS Instructor Course']),
      item('PALS Instructor AHA', [], ['PALS Instructor Course']),
      item('BLS Healthcare Provider Instructor', [], ['BLS Instructor Course']),
      item(
        'State of Florida Incident Safety Officer',
        [],
        ['Incident Safety Officer 40-hour Course'],
      ),
    ];
    const source = profile(
      'synthetic-captain5',
      'CPT',
      [paramedic],
      scoring(preferences),
      'PDF p3 Procedure6(b); Rules & Points!A8:C12',
    );
    source.requirements.service = [{ serviceCode: 'RESCUE_DIVISION', minimumMonths: 36 }];
    const rule = compile(source);
    const allPreferences = preferences.flatMap((preference) => [
      preference.credential,
      ...preference.alternatives,
    ]);

    function candidate(months: number | null): Member {
      return {
        ...syntheticMember([paramedic, ...allPreferences], 'CPT'),
        serviceCredits: [
          {
            serviceCode: 'RESCUE_DIVISION',
            verifiedMonths: months,
            effectiveOn: '2026-07-01',
            recordId: 'synthetic-service-record',
            sourceRef: 'Synthetic verified Rescue service',
            actorSubject: 'synthetic-reviewer',
          },
        ],
      };
    }

    it('accepts36 months and caps alternative certificates at one point per category', () => {
      expect(evaluateEligibility(candidate(36), rule)).toMatchObject({ eligible: true, points: 5 });
    });

    it.each([35, null])('rejects %s months despite every preferred certificate', (months) => {
      expectRejected(candidate(months), rule);
    });

    it('requires Captain rank and Paramedic independently of reviewed service', () => {
      expectRejected({ ...candidate(36), rank: 'LT' }, rule);
      expectRejected(
        { ...candidate(36), credentials: allPreferences.map((name) => ({ name })) },
        rule,
      );
    });

    it('does not infer Rescue service from qualification or duplicate reviewed credits', () => {
      expectRejected(syntheticMember([paramedic, ...allPreferences], 'CPT'), rule);
      const member = candidate(18);
      expectRejected(
        {
          ...member,
          serviceCredits: [...(member.serviceCredits ?? []), ...(member.serviceCredits ?? [])],
        },
        rule,
      );
    });
  });

  describe('main AirTech all-of requirements', () => {
    // PDF p4 Procedure7(a): Scott AND Cylinder/FSO AND DE. Car seat is preferred.
    // Points!CY5's OR and Rules & Points!B80's required car seat conflict with
    // the PDF. Optional car-seat weight1 is from Rules & Points!A88:C88.
    const minimums = [de, scott, cylinder];
    const rule = compile(
      profile(
        'synthetic-main-airtech',
        'FF',
        minimums,
        scoring([...specialOpsScoring.total.flatMap((group) => group.items), item(carSeat)]),
        'PDF p4 Procedure7(a); Rules & Points!A88:C88',
      ),
    );

    it.each(minimums)(
      'requires %s even with all other qualifications and preferences',
      (missing) => {
        expectRejected(
          syntheticMember([
            ...minimums.filter((name) => name !== missing),
            ...operations,
            ...technicians,
            drone,
            carSeat,
          ]),
          rule,
        );
      },
    );

    it('allows a qualified member without car seat and awards it only as an optional point', () => {
      expect(evaluateEligibility(syntheticMember(minimums), rule)).toMatchObject({
        eligible: true,
        points: 0,
      });
      expect(evaluateEligibility(syntheticMember([...minimums, carSeat]), rule)).toMatchObject({
        eligible: true,
        points: 1,
      });
    });

    it('does not substitute component driver courses for the required DE certificate', () => {
      expectRejected(
        syntheticMember([
          scott,
          cylinder,
          'Fire Apparatus Operations (FFP-1302)',
          'Fire Service Hydraulics (FFP1301)',
          'Florida Pump Operator',
        ]),
        rule,
      );
    });
  });

  describe('Marine role-specific minimums before any optional score', () => {
    // PDF pp4-6 Procedure8: Awareness, valid MMC/OUPV, passing watermanship,
    // Open Water and role-specific Metal Craft. Semantic evidence labels here
    // represent reviewed facts; this does not approve aliases in a live catalog.
    // Oracle Points!ET5/FQ5 tests preference-inclusive totals; never reproduce
    // their ability to compensate for a missing minimum. Operations is not an
    // automatically approved substitute for the PDF's Awareness requirement.
    const awareness = 'HazMat Awareness';
    const common = [
      'Valid MMC with OUPV / Six Pack endorsement',
      'Passing IADRS Watermanship Test',
      'Open Water Diver Certified',
      awareness,
    ];
    const psd = 'DRI Public Safety Diver';
    const optional = [psd, 'PADI Public Safety Diver', carSeat];
    const roles = [
      {
        name: 'officer',
        rank: 'CPT',
        craft: 'Metal Craft Officer',
        needsDE: false,
        carSeat: false,
      },
      { name: 'operator', rank: 'FF', craft: 'Metal Craft Operator', needsDE: true, carSeat: true },
      { name: 'engineer', rank: 'FF', craft: 'Metal Craft Engineer', needsDE: true, carSeat: true },
      {
        name: 'deckhand',
        rank: 'FF',
        craft: 'Metal Craft Deckhand',
        needsDE: false,
        carSeat: true,
      },
      { name: 'float', rank: 'FF', craft: 'Metal Craft Deckhand', needsDE: false, carSeat: true },
    ] as const;

    describe.each(roles)('$name', (role) => {
      const id = `synthetic-marine-${role.name}`;
      const minimums = [...common, role.craft, ...(role.needsDE ? [de] : [])];
      const inherited: AnnualRuleProfile = {
        id: `synthetic-marine-minimums-${role.name}`,
        name: 'Synthetic shared Marine minimums',
        sourceRef: 'PDF pp4-6 Procedure8',
        scope: { kind: 'family', name: 'Synthetic Marine', positionIds: [id] },
        requirements: { credentials: common, custom: [] },
      };
      // Optional weights1, with a single PSD credit across issuer alternatives:
      // Rules & Points!A108:C108, A129:C130, A151:C152, A171:C172.
      const rule = compile(
        profile(
          id,
          role.rank,
          [role.craft, ...(role.needsDE ? [de] : [])],
          scoring([
            item(psd, [], ['PADI Public Safety Diver']),
            ...(role.carSeat ? [item(carSeat)] : []),
          ]),
          'PDF pp5-6 Procedure8(a-e); Rules & Points!A93:C174',
        ),
        [inherited],
      );

      it('qualifies on listed minimums with no PSD and does not require unlisted DE', () => {
        expect(evaluateEligibility(syntheticMember(minimums, role.rank), rule)).toMatchObject({
          eligible: true,
          points: 0,
        });
      });

      it('awards only role-applicable preferences without double-counting PSD issuers', () => {
        expect(
          evaluateEligibility(syntheticMember([...minimums, ...optional], role.rank), rule),
        ).toMatchObject({ eligible: true, points: role.carSeat ? 2 : 1 });
      });

      it.each(minimums)('cannot replace missing %s with optional preference points', (missing) => {
        expectRejected(
          syntheticMember([...minimums.filter((name) => name !== missing), ...optional], role.rank),
          rule,
        );
      });

      it('requires the specified Metal Craft role rather than another role certificate', () => {
        const otherCraft =
          role.craft === 'Metal Craft Officer' ? 'Metal Craft Engineer' : 'Metal Craft Officer';
        expectRejected(syntheticMember([...common, de, otherCraft, ...optional], role.rank), rule);
      });

      it('does not silently replace Awareness with the spreadsheet Operations requirement', () => {
        expectRejected(
          syntheticMember(
            [
              ...minimums.filter((name) => name !== awareness),
              'Hazardous Materials Operations',
              ...optional,
            ],
            role.rank,
          ),
          rule,
        );
      });

      it('requires the role rank even when every credential is held', () => {
        expectRejected(syntheticMember([...minimums, ...optional], 'LT'), rule);
      });
    });
  });

  describe('Fire Investigator minimums', () => {
    // PDF p2 Procedure3(e) requires BOTH State Investigator and State Inspector.
    // Points!DT5 omits the Inspector condition; that omission is not parity.
    // IAAI-CFI's preferred tier has no numeric multiplier in the PDF, so these
    // minimum tests deliberately make no invented CFI scoring assertion.
    const minimums = ['State Certified Fire Investigator', 'FL State Certified Fire Inspector'];
    const rule = compile(
      profile('synthetic-investigator', 'FF', minimums, scoring([]), 'PDF p2 Procedure3(e)'),
    );

    it('accepts a Firefighter holding both required certificates', () => {
      expect(evaluateEligibility(syntheticMember(minimums), rule).eligible).toBe(true);
    });

    it.each(minimums)('requires %s even from an IAAI-CFI holder', (missing) => {
      expectRejected(
        syntheticMember([...minimums.filter((name) => name !== missing), 'IAAI-CFI']),
        rule,
      );
    });

    it('does not qualify an officer merely because the required certificates are held', () => {
      expectRejected(syntheticMember(minimums, 'CPT'), rule);
    });
  });
});

describe('final2026 qualitative cumulative preferences through compiled rules', () => {
  // PDF p4 Procedure7(a) explicitly separates backup preferred Scott/Cylinder
  // from required DE. Points!CY5 OR-as-two is not a backup preference schedule.
  const cumulative = (
    id: string,
    names: string[],
    sourceRef: string,
  ): ConfiguredScoring['total'][number] => ({
    id,
    cap: null,
    items: [],
    preference: {
      mode: 'BINARY_CUMULATIVE',
      sourceRef,
      criteria: names.map((credential) => ({ credential, alternatives: [], requiresAll: [] })),
    },
  });
  const backupScoring: ConfiguredScoring = {
    ...specialOpsScoring,
    total: [
      ...specialOpsScoring.total,
      { id: 'car-seat', cap: null, items: [item(carSeat)] },
      cumulative(
        'backup-preferences',
        [scott, cylinder],
        'PDF p4 Procedure7(a), backup preferred certificates',
      ),
    ],
  };
  const backup = compile(
    profile('synthetic-backup-airtech', 'FF', [de], backupScoring, 'PDF p4 Procedure7(a)'),
  );
  it.each([
    [[], 0],
    [[scott], 1],
    [[cylinder], 1],
    [[scott, cylinder], 2],
  ] as [string[], number][])(
    'backup accepts DE with preferences %j and counts each once',
    (held, credits) => {
      expect(evaluateEligibility(syntheticMember([de, ...held]), backup)).toMatchObject({
        eligible: true,
        points: credits,
      });
    },
  );
  it('backup preferences never compensate for missing DE or wrong rank', () => {
    expectRejected(
      syntheticMember([scott, cylinder, ...operations, ...technicians, drone, carSeat]),
      backup,
    );
    expectRejected(syntheticMember([de, scott, cylinder], 'LT'), backup);
  });
  it('combines numeric and binary credits without weakening the six-Operations gate', () => {
    expect(
      evaluateEligibility(
        syntheticMember([
          de,
          scott,
          cylinder,
          ...operations.slice(1),
          ...technicians,
          drone,
          carSeat,
        ]),
        backup,
      ).points,
    ).toBe(9);
    expect(
      evaluateEligibility(
        syntheticMember([de, scott, cylinder, ...operations, ...technicians, drone, carSeat]),
        backup,
      ).points,
    ).toBe(16);
  });
  // PDF p1 Procedure3(b), omitted by Rules & Points!A29:C35. Bullet order is
  // not a lexicographic tier; each distinct completed criterion adds one credit.
  const eventsCriteria = ['NFPA1123', 'NFPA1126', 'RN8312', 'RN8313'];
  const inspector = 'Current State of Florida Fire Inspector';
  const events = compile(
    profile(
      'synthetic-events-captain',
      'CPT',
      [inspector],
      {
        v: 1,
        total: [cumulative('events', eventsCriteria, 'PDF p1 Procedure3(b)')],
        so: [],
        mo: [],
      },
      'PDF p1 Procedure3(b)',
    ),
  );
  it.each([0, 1, 2, 3, 4])('Events Captain receives %s equal cumulative credits', (count) => {
    expect(
      evaluateEligibility(
        syntheticMember([inspector, ...eventsCriteria.slice(0, count)], 'CPT'),
        events,
      ).points,
    ).toBe(count);
  });
  it('requires current Inspector despite all Events preferences', () =>
    expectRejected(syntheticMember(eventsCriteria, 'CPT'), events));
  const preventionGroup = cumulative(
    'prevention',
    [
      'Fire Inspector I',
      'Fire Instructor I',
      'Fire and Life Safety Educator I',
      carSeat,
      'RN8977 I',
    ],
    'PDF p1 Procedure3(c); Rules & Points!A50:C53 omit RN8977',
  );
  const rn = preventionGroup.preference?.criteria[4];
  if (!rn) throw new Error('Synthetic RN8977 criterion required');
  rn.requiresAll = ['RN8977 II'];
  const prevention = compile(
    profile(
      'synthetic-prevention-lt',
      'LT',
      [inspector],
      { v: 1, total: [preventionGroup], so: [], mo: [] },
      'PDF p1 Procedure3(c)',
    ),
  );
  it.each([
    [[], 0],
    [['RN8977 I'], 0],
    [['RN8977 II'], 0],
    [['RN8977 I', 'RN8977 II'], 1],
  ] as [string[], number][])('RN8977 I and II form one combined criterion %j', (courses, credits) =>
    expect(
      evaluateEligibility(syntheticMember([inspector, ...courses], 'LT'), prevention).points,
    ).toBe(credits),
  );
});
