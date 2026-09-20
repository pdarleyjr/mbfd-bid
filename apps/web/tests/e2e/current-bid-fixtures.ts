import { deepStrictEqual } from 'node:assert';
import {
  type BidDefinitionContent,
  BidDispositionSchema,
  type BidImpactResponse,
  BidImpactResponseSchema,
  BidStageParticipantPreviewResponseSchema,
  type ConfiguredScoring,
  type FrozenLiveBidPolicy,
  LiveBidActionSchema,
} from '@mbfd/shared';
import type { BrowserContext, Page } from '@playwright/test';
import { CompactSign } from 'jose';
import { z } from 'zod';
import { canonicalBidDefinition } from '../../../worker/src/lib/bid-definition-content.js';
import {
  bidDefinitionDiff,
  bidDefinitionSummary,
  loadCurrentBidDefinition,
} from '../../../worker/src/lib/bid-definition-facade.js';
import {
  type BidImpactRequest,
  BidImpactRequestSchema,
  previewBidDefinitionImpact,
} from '../../../worker/src/lib/bid-definition-impact.js';
import {
  type BidStageParticipantPreviewRequest,
  BidStageParticipantPreviewRequestSchema,
  previewBidStageParticipantMembership,
} from '../../../worker/src/lib/bid-definition-stage-participant-preview.js';
import type { TestD1 } from '../../../worker/tests/integration/helpers/test-d1.js';
import {
  BidExpectedSchema,
  BidPreviewSchema,
  BidSaveResultSchema,
  type BidVersion,
  BidVersionsSchema,
  type CurrentBid,
  CurrentBidSchema,
  type HistoricalBid,
  HistoricalBidSchema,
} from '../../app/admin/current-bid/bid-client';

// Default browser fixtures cover presentation/protocol only. The opt-in impact
// fixture seeds isolated synthetic Department evidence in migrated SQLite and
// calls the actual Worker impact entry point; it creates no Mock or Live run.
export const BID_YEAR = 2027;
export const BID_COUNT = 521;
export const BID_HISTORY_COUNT = 25;
export const BID_ACTOR_SCOPE = '901:901:1';
export const BID_RECORDED_AT = Date.UTC(2026, 8, 12, 14, 30);
export const BID_STAGE_LABEL = 'Synthetic opening stage';
export const BID_SPECIALTY_LABEL = 'Synthetic rescue specialty';
export const BID_LAST_POSITION_LABEL = 'Synthetic opportunity beyond five hundred';
export const BID_LAST_MEMBER_LABEL = 'Synthetic Beyond Five Hundred';
export const BID_LAST_CREDENTIAL_LABEL = 'Synthetic certification beyond five hundred';
export const MISSING_MEMBER_ID = 989999;
export const MISSING_CREDENTIAL_NAME = 'Synthetic retained catalog reference';
export const BID_CSRF = 'csrf_11111111-1111-4111-8111-111111111111';
export const memberId = (ordinal: number) => 982000 + ordinal;
export const positionId = (ordinal: number) =>
  `synthetic-bid-position-${String(ordinal).padStart(4, '0')}`;
export const staffingPositionId = (ordinal: number) =>
  `synthetic-bid-staffing-${String(ordinal).padStart(4, '0')}`;
export const credentialName = (ordinal: number) =>
  ordinal === 1
    ? 'Synthetic advanced coastal rescue and emergency operations qualification with extended interagency training and assessment requirements'
    : ordinal === BID_COUNT
      ? BID_LAST_CREDENTIAL_LABEL
      : `Synthetic certification ${String(ordinal).padStart(4, '0')}`;

const members = Array.from({ length: BID_COUNT }, (_, index) => {
  const ordinal = index + 1;
  return {
    id: memberId(ordinal),
    employeeId: `SYNTHETIC-BID-${String(ordinal).padStart(4, '0')}`,
    firstName: 'Synthetic',
    lastName:
      ordinal === 1
        ? 'Alexandria Catherine Montgomery Wellington Emergency Operations Training and Interagency Rescue Coordination'
        : ordinal === BID_COUNT
          ? 'Beyond Five Hundred'
          : `Member ${String(ordinal).padStart(4, '0')}`,
    rank: 'FF',
    bidCategory: 'FF',
    rscSeniority: ordinal,
    rankSeniority: ordinal + 10,
    hiredAt: '2017-05-01',
    isProbationary: false,
    createdAt: BID_RECORDED_AT,
    updatedAt: BID_RECORDED_AT,
  };
});
const credentials = Array.from({ length: BID_COUNT }, (_, index) => ({
  id: 983000 + index + 1,
  name: credentialName(index + 1),
  policyName: credentialName(index + 1),
  fyPointsDefault: 0,
  holderCount: 1,
  revision: 1,
  retiredOn: index === 1 ? '2026-08-01' : null,
}));

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Synthetic fixture is incomplete');
  return value;
}

function scoring(): ConfiguredScoring {
  return {
    v: 1,
    total: [
      {
        id: 'synthetic-total-training',
        cap: 37,
        items: [
          {
            credential: credentialName(3),
            alternatives: [credentialName(4)],
            requiresAll: [credentialName(5)],
            points: 23,
            completionCredit: {
              sourceRef: 'SYNTHETIC QA completion-credit authority',
              effectiveFrom: '2027-01-01',
              effectiveThrough: '2027-12-31',
              memberIds: [memberId(1), memberId(BID_COUNT)],
            },
          },
        ],
      },
    ],
    so: [
      {
        id: 'synthetic-special-operations',
        cap: null,
        items: [{ credential: credentialName(6), alternatives: [], requiresAll: [], points: 11 }],
      },
    ],
    mo: [
      {
        id: 'synthetic-marine-operations',
        cap: 19,
        items: [{ credential: credentialName(7), alternatives: [], requiresAll: [], points: 7 }],
      },
    ],
  };
}

function policy(): FrozenLiveBidPolicy {
  return {
    v: 1,
    policyRevision: 'SYNTHETIC-QA-2027-25',
    stages: [
      {
        id: 'synthetic-opening',
        label: BID_STAGE_LABEL,
        order: 0,
        memberIds: [memberId(1), memberId(BID_COUNT), MISSING_MEMBER_ID],
        opportunityPositionIds: [positionId(1), positionId(BID_COUNT)],
        kind: 'FIREFIGHTER',
      },
      {
        id: 'synthetic-following',
        label: 'Synthetic following stage',
        order: 1,
        memberIds: [memberId(2)],
        opportunityPositionIds: [positionId(2)],
        kind: 'FIREFIGHTER',
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: disposition !== 'HOLD',
      returns: disposition === 'DEFER',
      returnStageId: disposition === 'DEFER' ? 'synthetic-following' : null,
      retainsLaterSelectionRights: disposition === 'DEFER' || disposition === 'HOLD',
      terminal: disposition === 'DECLINED',
      requiresReason: disposition !== 'HOLD',
      requiresEvidence: disposition === 'UNREACHABLE',
      contactPolicyReference:
        disposition === 'UNREACHABLE' ? 'SYNTHETIC contact evidence authority' : null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [memberId(1), memberId(BID_COUNT), MISSING_MEMBER_ID],
    })),
    specialtyCatalogReference: 'SYNTHETIC specialty catalog authority',
    aDayPolicyReference: 'SYNTHETIC A-Day authority',
    transitionPolicyReference: 'SYNTHETIC transition authority',
    publicationPolicyReference: 'SYNTHETIC publication authority',
    annualOperations: {
      v: 1,
      stageOrder: ['synthetic-opening', 'synthetic-following'],
      requiredTopologyPositionIds: [positionId(1), positionId(BID_COUNT)],
      contact: {
        minimumAttempts: 3,
        timingMode: 'TARGET',
        durationSeconds: 90,
        evidenceRequired: true,
      },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: 3,
        max: 8,
        captainDcMax: 2,
        specialtyMaximums: { MARINE_ASSIGNED: 2, MARINE_FLOAT: 3, DE: 4, SWAT: 1 },
      },
      specialties: [
        {
          id: 'synthetic-rescue-specialty',
          label: BID_SPECIALTY_LABEL,
          mode: 'PRIORITY_ONLY',
          opportunityPositionIds: [positionId(1), positionId(BID_COUNT)],
          requiredCredentialNames: [
            credentialName(1),
            credentialName(BID_COUNT),
            MISSING_CREDENTIAL_NAME,
          ],
          requiredSpecialtyCodes: ['SYNTHETIC_RESCUE', 'SYNTHETIC_RETAINED_SPECIALTY'],
          scoring: scoring(),
          rankingChannel: 'so',
          points: [],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY', 'RANK_SENIORITY'],
        },
        {
          id: 'synthetic-flat-specialty',
          label: 'Synthetic flat-point specialty',
          mode: 'INTERRUPTING',
          opportunityPositionIds: [positionId(2)],
          requiredCredentialNames: [credentialName(8)],
          requiredSpecialtyCodes: ['SYNTHETIC_MARINE'],
          points: [{ credentialName: credentialName(8), value: 13 }],
          tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
        },
      ],
    },
  };
}

/** Missing catalog options are captured references, not invented current evidence. */
export function currentBidContent(): BidDefinitionContent {
  const livePolicy = policy();
  const rules: BidDefinitionContent['rules'] = Array.from({ length: BID_COUNT }, (_, index) => ({
    positionId: positionId(index + 1),
    requiredCriteriaJson: JSON.stringify({ rank: ['FF'], credentials: [], custom: [] }),
    pointsPreferenceJson: JSON.stringify({ max: 0, items: [] }),
    tieBreakChainJson: JSON.stringify(['rsc_seniority', 'rank_seniority']),
    notes: `Synthetic final rule ${index + 1}`,
  }));
  const advanced = {
    positionId: positionId(1),
    requiredCriteriaJson: JSON.stringify({
      rank: ['FF'],
      credentials: [credentialName(1), credentialName(BID_COUNT), MISSING_CREDENTIAL_NAME],
      custom: ['non_probationary'],
      anyOfCredentials: [[credentialName(3), credentialName(4)]],
      service: [{ serviceCode: 'SYNTHETIC_RESCUE_SERVICE', minimumMonths: 18 }],
      postAward: [
        {
          id: 'synthetic-post-award',
          credential: credentialName(9),
          sourceRef: 'SYNTHETIC post-award source authority',
          deadline: {
            basis: 'APPROVED_BID_START_DATE',
            startOn: '2027-01-01',
            unit: 'CALENDAR_MONTHS',
            count: 6,
            timeZone: 'America/New_York',
          },
        },
      ],
    }),
    pointsPreferenceJson: JSON.stringify({ max: 0, items: [], scoring: scoring() }),
    tieBreakChainJson: JSON.stringify([
      'points',
      'so_points',
      'mo_points',
      'rsc_seniority',
      'rank_seniority',
    ]),
    notes: 'Synthetic advanced final rule preserved independently from captured compilation',
  };
  rules[0] = advanced;
  rules[1] = {
    ...required(rules[1]),
    pointsPreferenceJson: JSON.stringify({
      max: 30,
      items: [
        {
          credential: credentialName(10),
          points: 17,
          requiresOpsPair: true,
          opsGate: 'paired_operation',
        },
        {
          credential: credentialName(11),
          points: 13,
          requiresOpsPair: false,
          opsGate: 'all_operations',
        },
      ],
    }),
  };
  const material: BidDefinitionContent = {
    v: 1,
    bidYear: BID_YEAR,
    settings: {
      v: 3,
      expectedDurationDays: 3,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
      livePolicy,
    },
    notes: {
      bid: 'Synthetic saved Bid notes\nSecond line retained.',
      positions: 'Synthetic saved opportunity notes',
    },
    policy: {
      policyText:
        'SYNTHETIC source policy language\nPreserve verbatim while editing typed controls.',
      executionPolicy: structuredClone(livePolicy),
    },
    planning: {
      effectiveOn: '2027-01-01',
      sourceSessionId: 'synthetic-source-session-2026',
      sourcePolicyText: 'SYNTHETIC captured planning source language',
    },
    authoring: {
      profiles: [
        {
          id: 'synthetic-captured-profile',
          name: 'Synthetic captured department profile',
          sourceRef: 'SYNTHETIC captured profile authority',
          scope: { kind: 'department' },
          requirements: { ranks: ['FF'], credentials: [credentialName(1)], custom: [] },
          scoring: scoring(),
          tieBreakChain: ['points', 'rsc_seniority'],
        },
      ],
      compiled: [
        {
          rule: { ...advanced, notes: 'Synthetic captured compilation, distinct from final notes' },
          provenance: {
            requirements: ['synthetic-captured-profile'],
            scoring: ['synthetic-captured-profile'],
            priorities: ['synthetic-captured-profile'],
            matched: ['synthetic-captured-profile'],
          },
        },
      ],
      reconciliation: 'RULES_CHANGED_AFTER_COMPILATION',
    },
    positions: Array.from({ length: BID_COUNT }, (_, index) => ({
      id: positionId(index + 1),
      positionName:
        index === 0
          ? 'Synthetic coastal emergency operations and interagency rescue training firefighter opportunity with extended assignment responsibilities'
          : index + 1 === BID_COUNT
            ? BID_LAST_POSITION_LABEL
            : `Synthetic firefighter opportunity ${String(index + 1).padStart(4, '0')}`,
      shift: required((['A', 'B', 'C'] as const)[index % 3]),
      station: `Synthetic station ${Math.floor(index / 20) + 1}`,
      unit: `Synthetic unit ${String(index + 1).padStart(4, '0')}`,
      division: 'Synthetic Combat Operations',
      rankRequired: 'FF',
      isFloating: index === 2,
      isVacantByDesign: index === 3,
      isExcludedFromCount: false,
    })),
    rules,
    participation: [
      {
        positionId: positionId(1),
        bidParticipation: 'BIDDABLE',
        authoritativeSourceRef: 'SYNTHETIC reviewed participation authority',
      },
    ],
    staffingBindings: [
      {
        positionId: positionId(1),
        staffingPositionId: staffingPositionId(1),
        authoritativeSourceRef: 'SYNTHETIC reviewed staffing link authority',
        reviewStatus: 'approved',
      },
    ],
    sourceDecisions: [
      {
        issueId: 'synthetic-source-decision',
        title: 'Synthetic reviewed source decision',
        question: 'Which synthetic source controls this opportunity?',
        area: 'positions',
        status: 'RESOLVED',
        decision: 'Use the explicitly captured synthetic source.',
        sourceRef: 'SYNTHETIC decision source authority',
        effectiveOn: '2027-01-01',
      },
    ],
  };
  const candidate = canonicalBidDefinition(material);
  if (!candidate.ok)
    throw new Error(
      `Synthetic Bid is not canonical-compatible: ${JSON.stringify(candidate.issues)}`,
    );
  return candidate.content;
}

/** An isolated unsaved draft with complete typed sources. The service must
 * evaluate this browser payload against the underlying legacy source without
 * writing the authoring fields back to the TestD1 database. */
function participantPreviewDraft(source: BidDefinitionContent): BidDefinitionContent {
  const content = structuredClone(source);
  if (content.settings?.v !== 3 || content.policy === null)
    throw new Error('Synthetic participant preview requires a V3 policy document');
  const comparator = [{ key: 'RSC_SENIORITY' as const, direction: 'ASC' as const }];
  const memberIds = members.map((member) => member.id);
  const midpoint = Math.ceil(memberIds.length / 2);
  content.policy = {
    ...content.policy,
    executionPolicy: structuredClone(content.settings.livePolicy),
    orderingAuthority: {
      v: 1,
      sourceDecisionId: 'synthetic-open-annual-ordering-decision',
      comparator,
    },
    stageParticipantSources: content.settings.livePolicy.stages.map((stage, index) => ({
      stageId: stage.id,
      sourceRef: `SYNTHETIC participant preview source for ${stage.label}`,
      participantSource: {
        type: 'EXPLICIT_MEMBERS',
        memberIds: index === 0 ? memberIds.slice(0, midpoint) : memberIds.slice(midpoint),
      },
      ordering: comparator,
    })),
  };
  content.sourceDecisions = [
    ...content.sourceDecisions,
    {
      issueId: 'synthetic-open-annual-ordering-decision',
      title: 'Synthetic annual ordering decision',
      question: 'Which reviewed comparator governs this isolated annual Bid?',
      area: 'annual-policy',
      status: 'OPEN',
      decision: '',
      sourceRef: 'SYNTHETIC annual-policy comparator review evidence',
      effectiveOn: '2027-01-01',
    },
  ];
  const candidate = canonicalBidDefinition(content);
  if (!candidate.ok)
    throw new Error(
      `Synthetic participant preview draft is invalid: ${JSON.stringify(candidate.issues)}`,
    );
  return candidate.content;
}

async function createImpactDatabase(source: BidDefinitionContent) {
  // Keep database initialization out of the existing presentation-only cases.
  const { setupTestD1 } = await import('../../../worker/tests/integration/helpers/test-d1.js');
  const database = await setupTestD1();
  const { sqlite } = database;
  try {
    sqlite.pragma('foreign_keys = ON');
    const content = structuredClone(source);
    const advanced = required(content.rules.find((rule) => rule.positionId === positionId(1)));
    const criteria = z
      .object({ credentials: z.array(z.string()) })
      .passthrough()
      .parse(JSON.parse(advanced.requiredCriteriaJson));
    criteria.credentials = criteria.credentials.filter((name) => name !== MISSING_CREDENTIAL_NAME);
    advanced.requiredCriteriaJson = JSON.stringify(criteria);
    // The impact cases start from real designated legacy rows, without a
    // fabricated version, captured planning session, or compilation history.
    content.planning = null;
    content.authoring = null;
    const template = '2027.1';
    const book = '2027.1';
    const commonCredentialOrdinals = [1, 3, 5, 6, 7, 10, BID_COUNT];
    sqlite.transaction(() => {
      const insertMember = sqlite.prepare(`INSERT INTO members
        (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,
         hired_at,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,0,'active','2020-01-01',?,?)`);
      for (const member of members)
        insertMember.run(
          member.id,
          member.employeeId,
          member.firstName,
          member.lastName,
          member.rank,
          member.bidCategory,
          member.rscSeniority,
          member.rankSeniority,
          member.hiredAt,
          member.createdAt,
          member.updatedAt,
        );

      const insertCredential = sqlite.prepare(
        'INSERT INTO credentials(id,name,fy_points_default) VALUES (?,?,?)',
      );
      for (const credential of credentials)
        insertCredential.run(credential.id, credential.name, credential.fyPointsDefault);
      const insertMetadata = sqlite.prepare(`INSERT INTO credential_catalog_metadata
        (credential_id,display_name,revision,retired_on) VALUES (?,?,?,?)`);
      for (const credential of credentials.filter((row) => row.retiredOn !== null))
        insertMetadata.run(
          credential.id,
          credential.name,
          credential.revision,
          credential.retiredOn,
        );
      const insertHeldCredential = sqlite.prepare(`INSERT INTO member_credentials
        (member_id,credential_id,start_date,expiration_date) VALUES (?,?,'2026-01-01',NULL)`);
      for (const [index, member] of members.entries())
        for (const ordinal of new Set([...commonCredentialOrdinals, index + 1]))
          insertHeldCredential.run(member.id, required(credentials[ordinal - 1]).id);

      sqlite
        .prepare(`INSERT INTO service_credit_types(id,name,source_ref,actor_subject,created_at)
        VALUES (?,?,?,?,?)`)
        .run(
          'SYNTHETIC_RESCUE_SERVICE',
          'Synthetic verified rescue service',
          'SYNTHETIC reviewed service authority',
          String(memberId(1)),
          BID_RECORDED_AT,
        );
      const insertService = sqlite.prepare(`INSERT INTO member_service_evidence
        (id,member_id,service_code,revision,effective_on,verified_months,source_ref,
         actor_subject,reason,idempotency_key,request_json,created_at)
        VALUES (?,?,'SYNTHETIC_RESCUE_SERVICE',1,'2026-01-01',24,?,?,?,?,?,?)`);
      for (const member of members)
        insertService.run(
          `synthetic-impact-service-${member.id}`,
          member.id,
          'SYNTHETIC reviewed cumulative service',
          String(memberId(1)),
          'Synthetic verified twenty-four months of rescue service',
          `synthetic-impact-service-${member.id}`,
          JSON.stringify({
            memberId: member.id,
            serviceCode: 'SYNTHETIC_RESCUE_SERVICE',
            verifiedMonths: 24,
          }),
          BID_RECORDED_AT,
        );

      sqlite
        .prepare('INSERT INTO position_templates(version,effective_year,notes) VALUES (?,?,?)')
        .run(template, BID_YEAR, content.notes.positions);
      sqlite
        .prepare(`INSERT INTO rule_books(version,effective_year,status,revision,notes)
        VALUES (?,?,'draft',1,?)`)
        .run(book, BID_YEAR, content.notes.bid);
      sqlite
        .prepare(`INSERT INTO bid_years
        (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (?,'configuring',?,?,1,?)`)
        .run(BID_YEAR, book, template, JSON.stringify(content.settings));
      const insertPosition = sqlite.prepare(`INSERT INTO positions
        (id,template_version,shift,station,division,unit,rank_required,position_name,
         is_floating,is_vacant_by_design,is_excluded_from_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      const insertStaffing = sqlite.prepare(`INSERT INTO staffing_positions
        (id,stable_slot_key,division,shift,station,unit,position_name,applicable_rank,
         active_from,review_status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,'2020-01-01','approved',?,?)`);
      for (const [index, position] of content.positions.entries()) {
        insertPosition.run(
          position.id,
          template,
          position.shift,
          position.station,
          position.division,
          position.unit,
          position.rankRequired,
          position.positionName,
          Number(position.isFloating),
          Number(position.isVacantByDesign),
          Number(position.isExcludedFromCount),
        );
        insertStaffing.run(
          staffingPositionId(index + 1),
          staffingPositionId(index + 1),
          position.division,
          position.shift,
          position.station,
          position.unit,
          position.positionName,
          position.rankRequired,
          BID_RECORDED_AT,
          BID_RECORDED_AT,
        );
      }
      const insertRule = sqlite.prepare(`INSERT INTO position_rules
        (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
        VALUES (?,?,?,?,?,?,?)`);
      for (const rule of content.rules)
        insertRule.run(
          book,
          rule.positionId,
          template,
          rule.requiredCriteriaJson,
          rule.pointsPreferenceJson,
          rule.tieBreakChainJson,
          rule.notes,
        );
      const insertParticipation = sqlite.prepare(`INSERT INTO rule_book_position_participation
        (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        VALUES (?,?,?,?,?,?)`);
      for (const row of content.participation)
        insertParticipation.run(
          book,
          row.positionId,
          template,
          row.bidParticipation,
          row.authoritativeSourceRef,
          BID_RECORDED_AT,
        );
      const insertBinding = sqlite.prepare(`INSERT INTO position_staffing_bindings
        (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
        VALUES (?,?,?,?,?,?)`);
      for (const binding of content.staffingBindings)
        insertBinding.run(
          binding.positionId,
          template,
          binding.staffingPositionId,
          binding.authoritativeSourceRef,
          binding.reviewStatus,
          BID_RECORDED_AT,
        );
      const insertDecision = sqlite.prepare(`INSERT INTO bid_source_decisions
        (bid_year,issue_id,revision,title,question,area,status,decision,source_ref,effective_on,actor_subject,created_at)
        VALUES (?,?,1,?,?,?,?,?,?,?,?,?)`);
      for (const decision of content.sourceDecisions)
        insertDecision.run(
          BID_YEAR,
          decision.issueId,
          decision.title,
          decision.question,
          decision.area,
          decision.status,
          decision.decision,
          decision.sourceRef,
          decision.effectiveOn,
          String(memberId(1)),
          BID_RECORDED_AT,
        );
      if (content.policy) {
        const documentId = 'synthetic-impact-policy-document';
        sqlite
          .prepare(`INSERT INTO annual_bid_policy_documents
          (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at)
          VALUES (?,?,?,1,'DRAFT',?,?,?,?,?)`)
          .run(
            documentId,
            book,
            BID_YEAR,
            content.policy.policyText,
            JSON.stringify(content.policy.executionPolicy),
            memberId(1),
            BID_RECORDED_AT,
            BID_RECORDED_AT,
          );
        sqlite
          .prepare('UPDATE bid_years SET annual_policy_document_id=? WHERE year=?')
          .run(documentId, BID_YEAR);
      }
    })();
    deepStrictEqual(sqlite.pragma('foreign_key_check'), []);
    const current = await loadCurrentBidDefinition(database.env.DB, BID_YEAR);
    if (!current.ok) throw new Error(`Synthetic impact source failed: ${JSON.stringify(current)}`);
    const parsed = CurrentBidSchema.parse(current.response);
    if (
      parsed.state !== 'LEGACY_UNADOPTED' ||
      parsed.expected.kind !== 'legacy' ||
      parsed.version !== null
    )
      throw new Error('Synthetic impact source must retain its real unadopted legacy identity');
    const holderCounts = new Map(
      (
        sqlite
          .prepare(`SELECT credential_id AS id, COUNT(*) AS count FROM member_credentials
        GROUP BY credential_id`)
          .all() as { id: number; count: number }[]
      ).map((row) => [row.id, row.count]),
    );
    return { database, current: parsed, holderCounts };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

function historicalBid(
  content: BidDefinitionContent,
  number: number,
  options?: { reason?: string; predecessorId?: string; restoredFromId?: string },
): HistoricalBid {
  const candidate = canonicalBidDefinition(content);
  if (!candidate.ok) throw new Error(JSON.stringify(candidate.issues));
  return HistoricalBidSchema.parse({
    bidYear: BID_YEAR,
    version: {
      id: `synthetic-bid-version-${number}`,
      versionNumber: number,
      contentSha256: candidate.sha256,
      createdAtMs: BID_RECORDED_AT + number * 1_000,
      actorSubject: '901',
      reason: options?.reason ?? `Synthetic recorded version ${number}`,
      predecessorId:
        options?.predecessorId ?? (number === 1 ? null : `synthetic-bid-version-${number - 1}`),
      restoredFromId: options?.restoredFromId ?? null,
    },
    content: candidate.content,
    ...bidDefinitionSummary(candidate.content, candidate.coverage),
  });
}

function asCurrent(historical: HistoricalBid): CurrentBid {
  return CurrentBidSchema.parse({
    ...historical,
    state: 'VERSIONED',
    expected: {
      kind: 'version',
      versionId: historical.version.id,
      revision: historical.version.versionNumber,
      sha256: historical.version.contentSha256,
    },
  });
}

export type CurrentBidFixtureRequest = {
  method: string;
  path: string;
  url: string;
  body: Record<string, unknown> | null;
  serializedBody: string | null;
  key: string | null;
};

const intentSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), content: z.unknown() }).strict(),
  z.object({ operation: z.literal('restore'), versionId: z.string().min(1).max(200) }).strict(),
]);
const previewBody = z
  .object({ kind: z.literal('definition'), expected: BidExpectedSchema, intent: intentSchema })
  .strict();
const reason = z.string().trim().min(4).max(1000);
const saveBody = z.object({ expected: BidExpectedSchema, content: z.unknown(), reason }).strict();
const restoreBody = z
  .object({ expected: BidExpectedSchema, versionId: z.string().min(1).max(200), reason })
  .strict();
const mockReadiness = {
  status: 'NOT_EVALUATED',
  code: 'saved_version_required_for_mock_preview',
} as const;

export async function authenticateCurrentBid(context: BrowserContext, baseURL: string) {
  if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
    throw new Error('Only isolated loopback UI is allowed');
  const key = process.env.JWT_SIGNING_KEY;
  if (!key)
    throw new Error(
      'Explicit isolated JWT_SIGNING_KEY required; do not use production credentials',
    );
  const now = Math.floor(Date.now() / 1000);
  const token = await new CompactSign(
    new TextEncoder().encode(
      JSON.stringify({
        sub: 901,
        hub_user_id: 901,
        member_id: 901,
        emp: 'synthetic-department-operator',
        role: 'admin',
        security_version: 1,
        rank: 'CPT',
        first_name: 'Synthetic',
        last_name: 'Operator',
        fresh_auth_at: now,
        authz_checked_at: now,
        iat: now,
        exp: now + 3600,
      }),
    ),
  )
    .setProtectedHeader({ alg: 'HS256' })
    .sign(/^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, 'hex') : new TextEncoder().encode(key));
  await context.addCookies([
    { name: 'mbfd_pin', value: 'ok', url: baseURL, httpOnly: true, sameSite: 'Strict' },
    { name: 'mbfd_bid_jwt', value: token, url: baseURL, httpOnly: true, sameSite: 'Strict' },
  ]);
}

export async function installCurrentBidFixtures(
  page: Page,
  options: { impact?: boolean; participantPreview?: boolean } = {},
) {
  const baseContent = currentBidContent();
  let impactDatabase: TestD1 | null = null;
  let disposed = false;
  const versions = new Map<string, HistoricalBid>();
  for (let number = 1; number <= BID_HISTORY_COUNT; number++) {
    const content = structuredClone(baseContent);
    if (number !== BID_HISTORY_COUNT)
      content.notes.bid = `Synthetic historical Bid notes version ${number}`;
    const entry = historicalBid(content, number);
    versions.set(entry.version.id, entry);
  }
  const head = required(versions.get(`synthetic-bid-version-${BID_HISTORY_COUNT}`));
  const state = {
    current: asCurrent(head),
    baseContent: structuredClone(baseContent),
    history: [...versions.values()]
      .map((entry) => structuredClone(entry.version))
      .reverse() as BidVersion[],
    historicalVersions: versions,
    members: structuredClone(members),
    credentials: structuredClone(credentials),
    requests: [] as CurrentBidFixtureRequest[],
    readRequests: [] as CurrentBidFixtureRequest[],
    writeRequests: [] as CurrentBidFixtureRequest[],
    postRequests: [] as CurrentBidFixtureRequest[],
    impactRequests: [] as BidImpactRequest[],
    impactResponses: [] as BidImpactResponse[],
    participantPreviewRequests: [] as BidStageParticipantPreviewRequest[],
    impactReadOnlyProofs: 0,
    participantPreviewReadOnlyProofs: 0,
    participantPreviewArtifactCounts: [] as Array<{
      bid_definition_versions: number;
      bid_definition_heads: number;
      bid_sessions: number;
      bid_session_policy_snapshots: number;
      canonical_bid_session_state: number;
      bid_command_receipts: number;
      bid_audit_outbox: number;
    }>,
    previewReadOnlyProofs: 0,
    unexpectedRequests: [] as string[],
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    mutations: { save: 0, restore: 0 },
    failCurrent: false,
    failMembers: false,
    failCredentials: false,
    currentReadGate: null as Promise<void> | null,
    mutationGate: null as Promise<void> | null,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      if (impactDatabase) {
        try {
          deepStrictEqual(impactDatabase.sqlite.pragma('foreign_key_check'), []);
        } finally {
          impactDatabase.sqlite.close();
        }
      }
    },
  };
  if (options.impact || options.participantPreview) {
    const captured = await createImpactDatabase(baseContent);
    impactDatabase = captured.database;
    state.current = captured.current;
    state.baseContent = structuredClone(captured.current.content);
    state.history.length = 0;
    versions.clear();
    state.credentials = state.credentials.map((credential) => ({
      ...credential,
      holderCount: captured.holderCounts.get(credential.id) ?? 0,
    }));
    if (options.participantPreview) {
      const authored = participantPreviewDraft(captured.current.content);
      state.current = CurrentBidSchema.parse({ ...captured.current, content: authored });
      state.baseContent = structuredClone(authored);
    }
  }
  page.on('close', () => {
    void state.dispose();
  });
  const receipts = new Map<
    string,
    { signature: string; response: z.infer<typeof BidSaveResultSchema> }
  >();
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
      state.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => state.pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      state.unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    if (url.pathname === '/__nextjs_original-stack-frames') return route.abort();
    if (!url.pathname.startsWith('/api/')) {
      if (['GET', 'HEAD'].includes(request.method())) return route.continue();
      state.unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    const serializedBody = request.postData();
    const entry: CurrentBidFixtureRequest = {
      method: request.method(),
      path: url.pathname,
      url: url.toString(),
      body: serializedBody ? (JSON.parse(serializedBody) as Record<string, unknown>) : null,
      serializedBody,
      key: request.headers()['idempotency-key'] ?? null,
    };
    state.requests.push(entry);
    (['GET', 'HEAD'].includes(entry.method) ? state.readRequests : state.postRequests).push(entry);
    if (
      entry.method === 'POST' &&
      [`/api/admin/bid/${BID_YEAR}/versions`, `/api/admin/bid/${BID_YEAR}/restore`].includes(
        entry.path,
      )
    )
      state.writeRequests.push(entry);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body, headers: { 'Cache-Control': 'private, no-store' } });
    if (entry.method === 'POST' && entry.path === '/api/auth/csrf')
      return json({ token: BID_CSRF });
    if (
      entry.method === 'GET' &&
      ['/api/admin/members', '/api/admin/credentials'].includes(entry.path)
    ) {
      const memberCatalog = entry.path === '/api/admin/members';
      if (memberCatalog ? state.failMembers : state.failCredentials)
        return json({ error: 'synthetic_catalog_unavailable' }, 503);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 500);
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 500
      )
        return json({ error: 'invalid_pagination' }, 400);
      const rows = memberCatalog ? state.members : state.credentials;
      return json({
        [memberCatalog ? 'members' : 'credentials']: rows.slice(offset, offset + limit),
        total: rows.length,
      });
    }
    if (entry.method === 'GET' && entry.path === '/api/admin/service-evidence/types')
      return json({
        types: [{ id: 'SYNTHETIC_RESCUE_SERVICE', name: 'Synthetic verified rescue service' }],
      });
    if (entry.method === 'GET' && entry.path === '/api/admin/department/current-roster') {
      return json({
        asOf: url.searchParams.get('as_of') ?? '2027-01-01',
        positions: state.baseContent.positions.map((position, index) => ({
          id: staffingPositionId(index + 1),
          stableSlotKey: staffingPositionId(index + 1),
          positionName: position.positionName,
          shift: position.shift,
          station: position.station,
          unit: position.unit,
        })),
      });
    }
    if (entry.method === 'GET' && entry.path === `/api/admin/annual-plan/${BID_YEAR}`)
      return json({
        plan: {
          year: BID_YEAR,
          sessions: [
            { id: 'synthetic-reviewed-mock', isMock: 1, currentPhase: 'complete', startedAt: null },
          ],
        },
      });
    if (
      entry.method === 'GET' &&
      entry.path === '/api/admin/bid-session/synthetic-reviewed-mock/results'
    )
      return json({
        session: {
          id: 'synthetic-reviewed-mock',
          bidYear: BID_YEAR,
          isMock: true,
          currentPhase: 'complete',
          sequence: 3,
        },
        awardSource: 'CANONICAL',
        provenance: {
          valid: true,
          error: null,
          pin: null,
          ruleBookVersion: 'synthetic-browser-version',
          topologyReference: 'synthetic-browser-topology',
        },
        awards: [
          {
            memberId: memberId(1),
            name: 'Synthetic Browser Member',
            positionId: positionId(1),
            positionName: 'Synthetic station pool',
            shift: 'A',
            station: '1',
            unit: 'Combat 1',
            aDay: 'G1',
            memberships: [{ id: 'synthetic-membership', label: 'Synthetic specialty membership' }],
          },
        ],
        completion: { verified: false, blockers: ['mock_session_not_transitionable'] },
      });
    const root = `/api/admin/bid/${BID_YEAR}`;
    if (entry.method === 'GET' && entry.path === `${root}/current`) {
      await state.currentReadGate;
      return state.failCurrent
        ? json({ error: 'synthetic_bid_unavailable' }, 503)
        : json(CurrentBidSchema.parse(state.current));
    }
    if (entry.method === 'GET' && entry.path === `${root}/versions`) {
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const before = Number(url.searchParams.get('beforeVersionNumber') ?? Number.MAX_SAFE_INTEGER);
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isSafeInteger(before) ||
        before < 1
      )
        return json({ error: 'invalid_pagination' }, 400);
      const available = state.history.filter((version) => version.versionNumber < before);
      const selected = available.slice(0, limit);
      return json(
        BidVersionsSchema.parse({
          bidYear: BID_YEAR,
          versions: selected,
          nextBeforeVersionNumber:
            available.length > limit ? required(selected.at(-1)).versionNumber : null,
        }),
      );
    }
    if (entry.method === 'GET' && entry.path.startsWith(`${root}/versions/`)) {
      const version = versions.get(
        decodeURIComponent(entry.path.slice(`${root}/versions/`.length)),
      );
      return version
        ? json(HistoricalBidSchema.parse(version))
        : json({ error: 'bid_version_not_found' }, 404);
    }
    if (entry.method === 'POST' && entry.path === `${root}/preview`) {
      const before = impactDatabase?.sqlite.serialize();
      try {
        if (impactDatabase && entry.body?.kind === 'impact') {
          const parsed = BidImpactRequestSchema.safeParse(entry.body);
          if (!parsed.success)
            return json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
          state.impactRequests.push(parsed.data);
          const result = await previewBidDefinitionImpact(
            impactDatabase.env.DB,
            BID_YEAR,
            parsed.data,
          );
          if (!result.ok) return json(result, 409);
          const response = BidImpactResponseSchema.parse(result.response);
          state.impactResponses.push(response);
          return json(response);
        }
        if (impactDatabase && entry.body?.kind === 'stage-participant-membership') {
          const parsed = BidStageParticipantPreviewRequestSchema.safeParse(entry.body);
          if (!parsed.success)
            return json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
          state.participantPreviewRequests.push(parsed.data);
          const result = await previewBidStageParticipantMembership(
            impactDatabase.env.DB,
            BID_YEAR,
            parsed.data,
          );
          if (!result.ok) return json(result, 409);
          return json(BidStageParticipantPreviewResponseSchema.parse(result.response));
        }
        const parsed = previewBody.safeParse(entry.body);
        if (!parsed.success)
          return json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
        if (JSON.stringify(parsed.data.expected) !== JSON.stringify(state.current.expected))
          return json({ error: 'bid_definition_or_source_changed' }, 409);
        const intent = parsed.data.intent;
        const historical = intent.operation === 'restore' ? versions.get(intent.versionId) : null;
        if (intent.operation === 'restore' && !historical)
          return json({ error: 'bid_version_not_found' }, 404);
        const candidate = canonicalBidDefinition(
          intent.operation === 'save' ? intent.content : required(historical).content,
        );
        if (!candidate.ok)
          return json(
            BidPreviewSchema.parse({ valid: false, issues: candidate.issues, mockReadiness }),
          );
        return json(
          BidPreviewSchema.parse({
            valid: true,
            content: candidate.content,
            contentSha256: candidate.sha256,
            diff: bidDefinitionDiff(state.current.content, candidate.content),
            wouldCreateVersion:
              intent.operation === 'restore' ||
              state.current.version === null ||
              candidate.sha256 !== state.current.version.contentSha256,
            ...bidDefinitionSummary(candidate.content, candidate.coverage),
            mockReadiness,
          }),
        );
      } finally {
        if (impactDatabase && before) {
          deepStrictEqual(impactDatabase.sqlite.serialize(), before);
          state.previewReadOnlyProofs++;
          if (entry.body?.kind === 'impact') state.impactReadOnlyProofs++;
          if (entry.body?.kind === 'stage-participant-membership') {
            state.participantPreviewReadOnlyProofs++;
            const count = (table: string) => {
              const row = impactDatabase.sqlite
                .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
                .get() as { n: number };
              return Number(row.n);
            };
            state.participantPreviewArtifactCounts.push({
              bid_definition_versions: count('bid_definition_versions'),
              bid_definition_heads: count('bid_definition_heads'),
              bid_sessions: count('bid_sessions'),
              bid_session_policy_snapshots: count('bid_session_policy_snapshots'),
              canonical_bid_session_state: count('canonical_bid_session_state'),
              bid_command_receipts: count('bid_command_receipts'),
              bid_audit_outbox: count('bid_audit_outbox'),
            });
          }
        }
      }
    }
    if (entry.method === 'POST' && [`${root}/versions`, `${root}/restore`].includes(entry.path)) {
      if (impactDatabase) {
        state.unexpectedRequests.push(`${entry.method} ${entry.path}`);
        return json({ error: 'impact_fixture_is_read_only' }, 405);
      }
      await state.mutationGate;
      if (!entry.key || entry.key !== entry.key.trim() || entry.key.length > 200)
        return json(
          { error: entry.key ? 'invalid_idempotency_key' : 'idempotency_key_required' },
          400,
        );
      const operation = entry.path.endsWith('/restore') ? 'restore' : 'save';
      const signature = JSON.stringify({ operation, body: entry.body });
      const receipt = receipts.get(entry.key);
      if (receipt)
        return receipt.signature === signature
          ? json(
              BidSaveResultSchema.parse({ ...receipt.response, replayed: true }),
              receipt.response.changed ? 201 : 200,
            )
          : json({ error: 'idempotency_key_conflict' }, 409);
      const parsed = (operation === 'save' ? saveBody : restoreBody).safeParse(entry.body);
      if (!parsed.success) return json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
      if (JSON.stringify(parsed.data.expected) !== JSON.stringify(state.current.expected))
        return json({ error: 'bid_definition_or_source_changed' }, 409);
      const restoredFromId = 'versionId' in parsed.data ? parsed.data.versionId : null;
      const historical = restoredFromId ? versions.get(restoredFromId) : null;
      if (restoredFromId && !historical) return json({ error: 'bid_version_not_found' }, 404);
      const candidate = canonicalBidDefinition(
        'content' in parsed.data ? parsed.data.content : required(historical).content,
      );
      if (!candidate.ok)
        return json({ error: 'invalid_bid_definition', issues: candidate.issues }, 400);
      const changed =
        operation === 'restore' ||
        candidate.sha256 !== required(state.current.version).contentSha256;
      if (changed) {
        const next = historicalBid(
          candidate.content,
          required(state.current.version).versionNumber + 1,
          {
            reason: parsed.data.reason,
            predecessorId: required(state.current.version).id,
            ...(restoredFromId ? { restoredFromId } : {}),
          },
        );
        versions.set(next.version.id, next);
        state.history.unshift(structuredClone(next.version));
        state.current = asCurrent(next);
        state.mutations[operation]++;
      }
      const version = required(state.current.version);
      const response = BidSaveResultSchema.parse({
        changed,
        replayed: false,
        versionId: version.id,
        versionNumber: version.versionNumber,
        contentSha256: version.contentSha256,
        predecessorId: version.predecessorId,
        restoredFromId: version.restoredFromId,
      });
      receipts.set(entry.key, { signature, response });
      return json(response, changed ? 201 : 200);
    }
    state.unexpectedRequests.push(`${entry.method} ${entry.path}`);
    return json({ error: 'unplanned_synthetic_request' }, 501);
  });
  await authenticateCurrentBid(
    page.context(),
    process.env.CURRENT_BID_UI_BASE_URL ??
      process.env.DEPARTMENT_UI_BASE_URL ??
      'http://localhost:3000',
  );
  return state;
}

export type CurrentBidFixtures = Awaited<ReturnType<typeof installCurrentBidFixtures>>;
