import { BidDispositionSchema, FrozenLiveBidPolicySchema, LiveBidActionSchema } from '@mbfd/shared';
import { captureBidDefinitionSource } from '../../../src/lib/bid-definition-source.js';
import type { TestD1 } from './test-d1.js';

export const mockSeats = {
  dc: 'SYNTHETIC-DC',
  cpt: 'SYNTHETIC-CPT',
  lt: 'SYNTHETIC-LT',
  term: 'SYNTHETIC-TERM',
  specialty: 'SYNTHETIC-SPECIALTY',
  pool: ['SYNTHETIC-POOL-Z', 'SYNTHETIC-POOL-A', 'SYNTHETIC-POOL-M'] as [string, string, string],
  closed: 'SYNTHETIC-CLOSED-TERM',
};
export const mockMember = (ordinal: number) => 91000 + ordinal;
export const mockActor = mockMember(1);

/** Input facts only. This fixture never inserts a run, award, completion, or command receipt. */
export async function seedCanonicalMockInputs(h: TestD1) {
  const seatRows = [
    { id: mockSeats.dc, rank: 'DC', shift: 'A' },
    { id: mockSeats.cpt, rank: 'CPT', shift: 'A' },
    { id: mockSeats.lt, rank: 'LT', shift: 'A' },
    { id: mockSeats.term, rank: 'FF', shift: 'A' },
    { id: mockSeats.specialty, rank: 'FF', shift: 'B' },
    ...mockSeats.pool.map((id) => ({ id, rank: 'FF', shift: 'A' })),
    { id: mockSeats.closed, rank: 'FF', shift: 'A' },
  ];
  for (let ordinal = 1; ordinal <= 8; ordinal++) {
    const rank = ordinal === 1 ? 'DC' : ordinal === 2 ? 'CPT' : ordinal === 3 ? 'LT' : 'FF';
    h.sqlite
      .prepare(`INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,0,'active','2020-01-01',1,1)`)
      .run(
        mockMember(ordinal),
        `SYNTHETIC-MOCK-${ordinal}`,
        'Synthetic',
        `Member ${ordinal}`,
        rank,
        rank === 'FF' ? 'FF' : 'OFC',
        ordinal,
        ordinal,
      );
  }
  h.sqlite.exec(`
    INSERT INTO position_templates(version,effective_year) VALUES ('2027.1',2027);
    INSERT INTO rule_books(version,effective_year,status,revision) VALUES ('2027.1',2027,'draft',0);
    INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
    VALUES (2027,'configuring','2027.1','2027.1',1,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
    INSERT INTO credentials(id,name) VALUES(9101,'Synthetic admission'),(9102,'Synthetic advanced preference'),(9103,'Synthetic cumulative preference');
    INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date)
    VALUES (91005,9101,'2020-01-01',NULL),(91006,9101,'2020-01-01',NULL),(91006,9102,'2020-01-01',NULL),(91006,9103,'2020-01-01',NULL);
  `);
  for (const seat of seatRows) {
    h.sqlite
      .prepare(
        `INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name) VALUES (?,'2027.1',?,'1','Combat','Synthetic capacity',?,?)`,
      )
      .run(seat.id, seat.shift, seat.rank, seat.id);
    h.sqlite
      .prepare(
        `INSERT INTO staffing_positions(id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at) VALUES (?,?,?,'1','Synthetic capacity',?,?,'2020-01-01','approved',1,1)`,
      )
      .run(`slot-${seat.id}`, `synthetic/${seat.id}`, seat.shift, seat.id, seat.rank);
    h.sqlite
      .prepare(
        `INSERT INTO position_staffing_bindings(position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at) VALUES (?,'2027.1',?,'Synthetic reviewed topology','approved',1)`,
      )
      .run(seat.id, `slot-${seat.id}`);
    if (seat.id === mockSeats.closed) {
      h.sqlite
        .prepare(
          `INSERT INTO rule_book_position_participation(rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at) VALUES ('2027.1',?,'2027.1','ADMIN_ASSIGNED_NON_BIDDABLE','Synthetic protected incumbent term',1)`,
        )
        .run(seat.id);
    } else {
      h.sqlite
        .prepare(
          `INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain) VALUES ('2027.1',?,'2027.1',?,'{"max":0,"items":[]}','["rsc_seniority"]')`,
        )
        .run(
          seat.id,
          JSON.stringify({
            rank: [seat.rank],
            credentials: seat.id === mockSeats.specialty ? ['Synthetic admission'] : [],
            custom: [],
          }),
        );
    }
  }
  h.sqlite
    .prepare(
      `INSERT INTO staffing_tenure_evidence(id,staffing_position_id,revision,effective_on,status,source_ref,actor_subject,reason,idempotency_key,request_json,created_at) VALUES ('synthetic-open-term',?,1,'2020-01-01','UNPROTECTED','Synthetic reviewed vacant term','synthetic','Synthetic vacant position','synthetic-term-input','{}',1)`,
    )
    .run(`slot-${mockSeats.term}`);
  h.sqlite
    .prepare(
      `INSERT INTO member_assignments(id,member_id,staffing_position_id,origin_type,origin_ref,status,effective_from,effective_to,created_at,updated_at) VALUES ('synthetic-source-term-assignment',?,?,'ADMIN_TRANSFER','synthetic:prior-assignment','active','2026-01-01',NULL,1,1)`,
    )
    .run(mockMember(4), `slot-${mockSeats.closed}`);
  h.sqlite
    .prepare(
      `INSERT INTO staffing_tenure_evidence(id,staffing_position_id,revision,effective_on,status,member_id,protected_from,protected_through,source_ref,actor_subject,reason,idempotency_key,request_json,created_at,term_member_id,accumulated_service_months,consecutive_bid_cycles) VALUES ('synthetic-protected-term',?,1,'2026-01-01','PROTECTED',?,'2026-01-01','2028-12-31','Synthetic reviewed prior term','synthetic','Synthetic prior service facts','synthetic-protected-term-key','{}',1,?,36,1)`,
    )
    .run(`slot-${mockSeats.closed}`, mockMember(4), mockMember(4));
  const source = await captureBidDefinitionSource(h.env.DB, 2027);
  if (!source.ok) throw new Error(JSON.stringify(source));
  const content = structuredClone(source.content);
  const ffSeats = [mockSeats.term, mockSeats.specialty, ...mockSeats.pool];
  const policy = FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'synthetic-final-policy-primitives',
    stages: [
      {
        id: 'DC',
        label: 'Division Chief pre-Bid',
        order: 0,
        kind: 'MIXED',
        memberIds: [mockMember(1)],
        opportunityPositionIds: [mockSeats.dc],
      },
      {
        id: 'CPT',
        label: 'Captain',
        order: 1,
        kind: 'CAPTAIN',
        memberIds: [mockMember(2)],
        opportunityPositionIds: [mockSeats.cpt],
      },
      {
        id: 'LT',
        label: 'Lieutenant',
        order: 2,
        kind: 'LIEUTENANT',
        memberIds: [mockMember(3)],
        opportunityPositionIds: [mockSeats.lt],
      },
      {
        id: 'FF',
        label: 'Firefighter',
        order: 3,
        kind: 'FIREFIGHTER',
        memberIds: [4, 5, 6, 7, 8].map(mockMember),
        opportunityPositionIds: ffSeats,
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: disposition === 'DEFER',
      returnStageId: disposition === 'DEFER' ? 'FF' : null,
      retainsLaterSelectionRights: disposition === 'DEFER',
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [mockActor],
    })),
    specialtyCatalogReference: 'Synthetic reviewed specialty',
    aDayPolicyReference: 'Synthetic reviewed simultaneous A-Day',
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['DC', 'CPT', 'LT', 'FF'],
      requiredTopologyPositionIds: seatRows
        .filter((seat) => seat.id !== mockSeats.closed)
        .map((seat) => seat.id),
      contact: { minimumAttempts: 3, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 0,
        max: 3,
        captainDcMax: 1,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing: 'SIMULTANEOUS',
          officersPerGroup: null,
          sourceRef: 'Synthetic reviewed simultaneous A-Day',
          constraints: [],
        },
      },
      opportunityPools: [
        {
          id: 'station-pool',
          label: 'Synthetic station capacity',
          kind: 'STATION_POOL',
          sourceRef: 'Synthetic explicit station pool',
          sourceDecisionId: 'pool-source',
          positionIds: mockSeats.pool,
        },
      ],
      fallbackPolicies: [
        {
          id: 'pool-fallback',
          label: 'Synthetic unfilled station fallback',
          sourceRef: 'Synthetic reverse minimum-qualified fallback',
          sourceDecisionId: 'fallback-source',
          positionIds: mockSeats.pool,
          tiers: [
            {
              id: 'volunteer',
              label: 'Voluntary minimum qualified',
              mode: 'VOLUNTARY',
              eligibility: { kind: 'MINIMUM_QUALIFIED' },
              currentlyAssignedOnly: false,
              comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
            },
            {
              id: 'force',
              label: 'Forced minimum qualified',
              mode: 'FORCED',
              eligibility: { kind: 'MINIMUM_QUALIFIED' },
              currentlyAssignedOnly: false,
              comparator: [{ key: 'RSC_SENIORITY', direction: 'DESC' }],
            },
          ],
        },
      ],
      assignmentTerms: [
        {
          id: 'open-term',
          positionIds: [mockSeats.term],
          requiredServiceMonths: 36,
          reopenAfterConsecutiveCycles: 3,
          closedForThisBid: false,
          sourceRef: 'Synthetic reviewed vacant term',
        },
        {
          id: 'closed-term',
          positionIds: [mockSeats.closed],
          requiredServiceMonths: 36,
          reopenAfterConsecutiveCycles: 3,
          closedForThisBid: false,
          sourceRef: 'Synthetic protected incumbent term',
        },
      ],
      specialties: [
        {
          id: 'advanced',
          label: 'Synthetic preference specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: [mockSeats.specialty],
          requiredCredentialNames: ['Synthetic admission'],
          requiredSpecialtyCodes: [],
          points: [],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
          rankingChannel: 'total',
          scoring: {
            v: 1,
            total: [
              {
                id: 'conditional',
                cap: null,
                items: [
                  {
                    credential: 'Synthetic advanced preference',
                    alternatives: [],
                    requiresAll: ['Synthetic admission'],
                    points: 7,
                  },
                ],
              },
              {
                id: 'qualitative',
                cap: null,
                items: [],
                preference: {
                  mode: 'BINARY_CUMULATIVE',
                  sourceRef: 'Synthetic cumulative preference clause',
                  criteria: [
                    {
                      credential: 'Synthetic cumulative preference',
                      alternatives: [],
                      requiresAll: ['Synthetic admission'],
                    },
                  ],
                },
              },
            ],
            so: [],
            mo: [],
          },
        },
      ],
    },
  });
  content.settings = {
    v: 3,
    expectedDurationDays: 2,
    turnTimerSeconds: 180,
    credentialEvaluationOn: '2027-01-01',
    personnelEvaluationOn: '2027-01-01',
    livePolicy: policy,
  };
  content.policy = {
    policyText:
      'Synthetic final-policy primitives only; no real member facts or approval inferred.',
    executionPolicy: policy,
  };
  content.sourceDecisions = ['pool-source', 'fallback-source'].map((issueId) => ({
    issueId,
    title: `Synthetic ${issueId}`,
    question: 'Which explicit reviewed scope applies?',
    area: 'annual-policy' as const,
    status: 'RESOLVED' as const,
    decision: 'The synthetic configured scope applies only to this test.',
    sourceRef: `Synthetic ${issueId}`,
    effectiveOn: '2027-01-01',
  }));
  return { content, expected: { kind: 'legacy' as const, sourceToken: source.sourceToken } };
}
