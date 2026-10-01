import {
  type BidDefinitionContent,
  BidEvaluationSchema,
  BidEvidenceFreezeSchema,
} from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import { type JsonValue, canonicalize } from '../../src/audit/canonical-json.js';
import { bidContentHash } from '../../src/lib/bid-definition-content.js';
import {
  type BidEvidenceFreezeRow,
  evidenceFreezeDigests,
  evidenceSourceDigests,
} from '../../src/lib/bid-evidence-freeze.js';
import type { BidEvaluationEvidence } from '../../src/lib/bid-policy.js';
import {
  deriveFrozenReservedRetention,
  projectRetainedParticipationContent,
} from '../../src/lib/retained-participation-derivation.js';
import {
  createRetainedParticipationReceipt,
  verifyRetainedParticipationReceipt,
} from '../../src/lib/retained-participation-receipt.js';

const HOLDER = 93001;
const OTHER = 93002;
const CLOSED = 'synthetic-closed-training';
const STAFFING = 'synthetic-approved-training-role';
const ASSIGNMENT = 'synthetic-approved-current-holder';

function input() {
  const original = BidEvaluationSchema.parse({
    ruleBookVersion: 'synthetic.1',
    positionTemplateVersion: 'synthetic.1',
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2026-09-30',
      personnelEvaluationOn: '2026-09-30',
    },
    credentialEvaluationOn: '2026-09-30',
    capturedAtMs: Date.parse('2026-09-30T22:00:00Z'),
    members: [HOLDER, OTHER].map((memberId) => ({
      memberId,
      pool: 'OFC',
      rscSeniority: memberId,
      rankSeniority: memberId,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      rank: 'LT',
      isProbationary: false,
      credentialNames: ['Synthetic approved qualification'],
      scoringEvidence: {
        evaluationOn: '2026-09-30',
        completedCredentialNames: ['Synthetic approved completed qualification'],
      },
      specialtyQualifications: [],
      serviceCredits: [],
      mockParticipationEvidence: 'ACCEPTED_STAFFING_BASELINE',
      currentBidPositionIds: memberId === HOLDER ? [CLOSED] : [],
    })),
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: 'synthetic.1',
          templateVersion: 'synthetic.1',
          positionId: 'synthetic-open-seat',
          requiredCriteriaJson: '{"rank":["LT"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["rank_seniority"]',
        },
      ],
      positions: [
        {
          id: 'synthetic-open-seat',
          templateVersion: 'synthetic.1',
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '1',
          unit: 'Synthetic',
          positionName: 'Synthetic LT',
          rankRequired: 'LT',
        },
        {
          id: CLOSED,
          templateVersion: 'synthetic.1',
          bidParticipation: 'RESERVED_NON_BIDDABLE',
          isExcludedFromCount: false,
          shift: 'D',
          station: '1',
          unit: 'Synthetic',
          positionName: 'Synthetic Training LT',
          rankRequired: 'LT',
        },
      ],
    },
  });
  const recomputed = structuredClone(original);
  const holder = recomputed.members[0];
  if (!holder) throw new Error('Synthetic holder fixture missing');
  holder.pool = 'EXCLUDED';
  holder.exclusionReason = 'ADMIN_ASSIGNED_NON_BIDDABLE';
  holder.authoritativeAssignmentId = ASSIGNMENT;
  const { mockParticipationEvidence: _mock, ...withoutMock } = holder;
  recomputed.members[0] = withoutMock;
  // Minimal authority surfaces for the pure helper. The application caller
  // supplies these from already integrity-checked immutable documents.
  const approvedContent = {
    settings: {
      v: 3,
      livePolicy: {
        annualOperations: {
          assignmentTerms: [
            {
              id: 'synthetic-closed-term',
              positionIds: [CLOSED],
              closedForThisBid: true,
              sourceRef: 'Synthetic reviewed annual closure',
            },
          ],
        },
      },
    },
    participation: [
      {
        positionId: CLOSED,
        bidParticipation: 'RESERVED_NON_BIDDABLE',
        authoritativeSourceRef: 'Synthetic reviewed annual closure',
      },
    ],
    staffingBindings: [
      {
        positionId: CLOSED,
        staffingPositionId: STAFFING,
        reviewStatus: 'approved',
        authoritativeSourceRef: 'Synthetic reviewed holder binding',
      },
    ],
  } as unknown as BidDefinitionContent;
  const evidence = {
    staffingRows: [
      { id: STAFFING, reviewStatus: 'approved', activeFrom: '2026-08-01', activeTo: null },
    ],
    assignmentRows: [
      {
        id: ASSIGNMENT,
        memberId: HOLDER,
        staffingPositionId: STAFFING,
        status: 'active',
        effectiveFrom: '2026-09-01',
        effectiveTo: null,
      },
    ],
  } as unknown as BidEvaluationEvidence;
  return { original, recomputed, approvedContent, evidence };
}

describe('source-bound frozen retained participation derivation', () => {
  it('changes only retention fields and preserves the sealed qualification hold effect', () => {
    const fixture = input();
    // Historical raw capture omitted holds. A raw reevaluation may add this
    // unverified label; the derived freeze must preserve the sealed absence.
    fixture.recomputed.members[1]?.credentialNames.push('Synthetic unverified generic label');
    fixture.recomputed.members[1]?.scoringEvidence?.completedCredentialNames.push(
      'Synthetic unverified generic label',
    );
    const before = JSON.stringify(fixture);
    const result = deriveFrozenReservedRetention(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retainedMemberIds).toEqual([HOLDER]);
    const expected = structuredClone(fixture.original);
    const member = expected.members[0];
    if (!member) throw new Error('Synthetic expected holder missing');
    member.pool = 'EXCLUDED';
    member.exclusionReason = 'ADMIN_ASSIGNED_NON_BIDDABLE';
    member.authoritativeAssignmentId = ASSIGNMENT;
    const { mockParticipationEvidence: _mock, ...withoutMock } = member;
    expected.members[0] = withoutMock;
    expect(result.evaluation).toEqual(expected);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it.each([
    'rank',
    'rscSeniority',
    'rankSeniority',
    'currentBidPositionIds',
    'serviceCredits',
    'specialtyQualifications',
  ])('fails closed when recomputation changes unrelated %s', (field) => {
    const fixture = input();
    const member = fixture.recomputed.members[1] as unknown as Record<string, unknown>;
    member[field] =
      field === 'rank'
        ? 'FF'
        : field === 'rscSeniority' || field === 'rankSeniority'
          ? 1
          : ['changed'];
    expect(deriveFrozenReservedRetention(fixture)).toMatchObject({
      ok: false,
      code: 'retained_participation_derivation_invalid',
    });
  });

  it.each([
    'binding-missing',
    'binding-unapproved',
    'binding-copied',
    'staffing-unapproved',
    'staffing-future',
    'staffing-ended',
    'assignment-future',
    'assignment-ended',
    'assignment-cancelled',
    'assignment-overlap',
    'holder-mismatch',
    'term-open',
    'term-missing',
    'position-biddable',
  ])('fails closed on %s authority', (kind) => {
    const fixture = input();
    const binding = fixture.approvedContent.staffingBindings[0];
    const staffing = fixture.evidence.staffingRows[0];
    const assignment = fixture.evidence.assignmentRows[0];
    const term =
      fixture.approvedContent.settings?.v === 3
        ? fixture.approvedContent.settings.livePolicy.annualOperations?.assignmentTerms?.[0]
        : undefined;
    if (!binding || !staffing || !assignment || !term)
      throw new Error('Synthetic proof fixture missing');
    if (kind === 'binding-missing') fixture.approvedContent.staffingBindings = [];
    if (kind === 'binding-unapproved') binding.reviewStatus = 'draft';
    if (kind === 'binding-copied') binding.positionId = 'synthetic-unrelated-position';
    if (kind === 'staffing-unapproved') staffing.reviewStatus = 'draft';
    if (kind === 'staffing-future') staffing.activeFrom = '2026-10-01';
    if (kind === 'staffing-ended') staffing.activeTo = '2026-09-29';
    if (kind === 'assignment-future') assignment.effectiveFrom = '2026-10-01';
    if (kind === 'assignment-ended') assignment.effectiveTo = '2026-09-29';
    if (kind === 'assignment-cancelled') assignment.status = 'cancelled';
    if (kind === 'assignment-overlap')
      fixture.evidence.assignmentRows.push({
        ...assignment,
        id: 'synthetic-other-holder',
        memberId: OTHER,
      });
    if (kind === 'holder-mismatch') assignment.memberId = OTHER;
    if (kind === 'term-open') term.closedForThisBid = false;
    if (
      kind === 'term-missing' &&
      fixture.approvedContent.settings?.v === 3 &&
      fixture.approvedContent.settings.livePolicy.annualOperations
    )
      fixture.approvedContent.settings.livePolicy.annualOperations.assignmentTerms = [];
    if (kind === 'position-biddable') {
      const participation = fixture.approvedContent.participation[0];
      if (!participation) throw new Error('Synthetic participation missing');
      participation.bidParticipation = 'BIDDABLE';
    }
    expect(deriveFrozenReservedRetention(fixture)).toMatchObject({
      ok: false,
      code: 'retained_participation_derivation_invalid',
    });
  });

  it('does not invent a member exclusion for an unchanged vacant or permitted-leave pool', () => {
    const fixture = input();
    fixture.recomputed = structuredClone(fixture.original);
    expect(deriveFrozenReservedRetention(fixture)).toMatchObject({
      ok: true,
      retainedMemberIds: [],
      evaluation: fixture.original,
    });
  });

  it('rejects an expanded, shortened or reidentified evaluation', () => {
    for (const change of ['added', 'removed', 'reidentified']) {
      const fixture = input();
      const other = fixture.recomputed.members[1];
      if (!other) throw new Error('Synthetic other member missing');
      if (change === 'added') fixture.recomputed.members.push({ ...other, memberId: 93999 });
      if (change === 'removed') fixture.recomputed.members.pop();
      if (change === 'reidentified') other.memberId = 93999;
      expect(deriveFrozenReservedRetention(fixture).ok).toBe(false);
    }
  });

  it('projects only proved retained identities while keeping all original order and source scopes', () => {
    const content = {
      settings: {
        v: 3,
        livePolicy: {
          stages: [
            {
              id: 'stage',
              memberIds: [OTHER, HOLDER, 93003],
              opportunityPositionIds: ['second-seat', 'first-seat'],
              kind: 'LIEUTENANT',
              order: 1,
            },
          ],
        },
      },
      policy: {
        executionPolicy: {
          stages: [
            {
              id: 'stage',
              memberIds: [OTHER, HOLDER, 93003],
              opportunityPositionIds: ['second-seat', 'first-seat'],
              kind: 'LIEUTENANT',
              order: 1,
            },
          ],
        },
        stageParticipantSources: [
          {
            stageId: 'stage',
            participantSource: { type: 'EXPLICIT_MEMBERS', memberIds: [OTHER, HOLDER, 93003] },
            ordering: [{ key: 'TIME_IN_GRADE_BID_ORDINAL', direction: 'ASC' }],
            sourceRef: 'Synthetic original reviewed scope',
          },
        ],
      },
      untouchedSourceFact: 'Synthetic immutable fact',
    } as unknown as BidDefinitionContent;
    const before = JSON.stringify(content);
    const projected = projectRetainedParticipationContent(content, [HOLDER]);
    const expected = JSON.parse(before);
    expected.settings.livePolicy.stages[0].memberIds = [OTHER, 93003];
    expected.policy.executionPolicy.stages[0].memberIds = [OTHER, 93003];
    expected.policy.stageParticipantSources[0].participantSource.memberIds = [OTHER, 93003];
    expect(projected).toEqual(expected);
    expect(JSON.stringify(content)).toBe(before);
  });
});

function receiptInput() {
  const fixture = input();
  const evidence = {
    ...fixture.evidence,
    memberRows: [],
    personnelEventRows: [],
    serviceRows: [],
    assignmentImportRowEvidence: [],
    tenureRows: [],
    acceptedBaseline: {},
    ordinalDatasets: [],
    bidTourRows: [],
    credentialRows: [],
    qualificationEventRows: [],
    catalogRows: [],
    disputedRows: [],
  } as unknown as BidEvaluationEvidence;
  const sourceDigests = evidenceSourceDigests(evidence);
  const evaluationHash = evidenceFreezeDigests(fixture.original).evaluationSha256;
  const sourceImports = [
    {
      source: 'synthetic',
      importId: 'synthetic-import',
      revision: '1',
      sha256: 'd'.repeat(64),
      acceptedAt: '2026-09-29T12:00:00Z',
    },
  ];
  const capturedAt = '2026-09-30T22:00:00.000Z';
  const freeze = BidEvidenceFreezeSchema.parse({
    freezeId: 'synthetic-freeze',
    evaluationSha256: evaluationHash,
    sourceVersionId: 'synthetic-original-source-version',
    sourceVersionSha256: 'a'.repeat(64),
    evidenceCutoffAt: '2026-09-30T17:00:00-04:00',
    timeZone: 'America/New_York',
    approvedAt: capturedAt,
    sourceImports,
    personnelSnapshot: {
      sha256: sourceDigests.personnelSha256,
      asOfAt: '2026-09-30T17:00:00-04:00',
      capturedAt,
    },
    credentialSnapshot: {
      sha256: sourceDigests.credentialSha256,
      asOfAt: '2026-09-30T17:00:00-04:00',
      capturedAt,
    },
  });
  if (fixture.approvedContent.settings?.v !== 3) throw new Error('Synthetic settings missing');
  fixture.approvedContent.settings.evidenceFreeze = freeze;
  const livePolicy = fixture.approvedContent.settings.livePolicy;
  livePolicy.stages = [
    {
      id: 'synthetic-stage',
      memberIds: [OTHER, HOLDER],
      opportunityPositionIds: ['synthetic-open-seat'],
    },
  ] as unknown as typeof livePolicy.stages;
  const source = {
    id: freeze.freezeId,
    bid_year: 2026,
    cutoff_at: freeze.evidenceCutoffAt,
    time_zone: freeze.timeZone,
    captured_at: Date.parse(capturedAt),
    actor_subject: 'synthetic-actor',
    source_version_id: freeze.sourceVersionId,
    source_version_sha256: freeze.sourceVersionSha256,
    source_token: 'e'.repeat(64),
    evaluation_json: evidenceFreezeDigests(fixture.original).evaluationJson,
    personnel_source_json: sourceDigests.personnelSourceJson,
    credential_source_json: sourceDigests.credentialSourceJson,
    evaluation_sha256: evaluationHash,
    personnel_sha256: freeze.personnelSnapshot.sha256,
    credential_sha256: freeze.credentialSnapshot.sha256,
    source_imports_json: JSON.stringify(sourceImports),
  } as BidEvidenceFreezeRow;
  const serial = canonicalize(JSON.parse(JSON.stringify(fixture.approvedContent)) as JsonValue);
  return {
    original: fixture.original,
    recomputed: fixture.recomputed,
    evidence,
    source,
    baseline: {
      id: 'synthetic-sealed-baseline',
      sha256: bidContentHash(serial),
      content: fixture.approvedContent,
    },
  };
}

describe('versioned retained participation receipt', () => {
  it('rejects deriving again from a successor instead of the original immutable baseline', () => {
    const fixture = receiptInput();
    const first = createRetainedParticipationReceipt(fixture);
    if (!first.ok) throw new Error('Synthetic first receipt missing');
    fixture.baseline.content = first.content;
    fixture.baseline.sha256 = bidContentHash(
      canonicalize(JSON.parse(JSON.stringify(first.content)) as JsonValue),
    );
    expect(createRetainedParticipationReceipt(fixture).ok).toBe(false);
  });

  it('rejects source rows altered under an unchanged captured-source digest', () => {
    const fixture = receiptInput();
    const assignment = fixture.evidence.assignmentRows[0];
    if (!assignment) throw new Error('Synthetic assignment missing');
    assignment.effectiveFrom = '2026-08-01';
    expect(createRetainedParticipationReceipt(fixture).ok).toBe(false);
  });
  it('binds the original freeze and distinct immutable baseline without changing legacy freeze bytes', () => {
    const fixture = receiptInput();
    const freeze =
      fixture.baseline.content.settings?.v === 3
        ? fixture.baseline.content.settings.evidenceFreeze
        : undefined;
    expect(JSON.stringify(BidEvidenceFreezeSchema.parse(freeze))).toBe(JSON.stringify(freeze));
    const before = JSON.stringify(fixture);
    const result = createRetainedParticipationReceipt(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.sourceVersionId).not.toBe(result.receipt.baselineVersionId);
    expect(result.retainedMemberIds).toEqual([HOLDER]);
    expect(
      result.content.settings?.v === 3 && result.content.settings.livePolicy.stages[0]?.memberIds,
    ).toEqual([OTHER]);
    expect(
      verifyRetainedParticipationReceipt({ ...fixture, content: result.content }),
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it.each([
    'v',
    'method',
    'evaluatorRevision',
    'baselineVersionId',
    'baselineVersionSha256',
    'sourceFreezeId',
    'sourceEvaluationSha256',
    'sourceVersionId',
    'sourceVersionSha256',
    'personnelSha256',
    'credentialSha256',
    'materialSha256',
    'derivedEvaluationSha256',
  ])('rejects a tampered %s receipt field', (field) => {
    const fixture = receiptInput();
    const result = createRetainedParticipationReceipt(fixture);
    if (!result.ok || result.content.settings?.v !== 3)
      throw new Error('Synthetic receipt missing');
    const receipt = result.content.settings.evidenceFreeze?.derivation as unknown as Record<
      string,
      unknown
    >;
    receipt[field] = field === 'v' ? 2 : 'f'.repeat(64);
    expect(verifyRetainedParticipationReceipt({ ...fixture, content: result.content }).ok).toBe(
      false,
    );
  });

  it('rejects changed policy facts, reversed stage order and a copied baseline source', () => {
    for (const change of ['policy', 'stage', 'source']) {
      const fixture = receiptInput();
      const result = createRetainedParticipationReceipt(fixture);
      if (!result.ok || result.content.settings?.v !== 3)
        throw new Error('Synthetic receipt missing');
      const participation = result.content.participation[0];
      const stage = result.content.settings.livePolicy.stages[0];
      if (!participation || !stage) throw new Error('Synthetic projection missing');
      if (change === 'policy') participation.authoritativeSourceRef = 'Copied source';
      if (change === 'stage') stage.memberIds = [HOLDER, OTHER];
      if (change === 'source') fixture.baseline.id = 'synthetic-unrelated-baseline';
      expect(verifyRetainedParticipationReceipt({ ...fixture, content: result.content }).ok).toBe(
        false,
      );
    }
  });

  it('preserves sealed qualification and scoring facts when raw capture lacks qualification holds', () => {
    const fixture = receiptInput();
    fixture.recomputed.members[1]?.credentialNames.push('Synthetic unverified qualification');
    fixture.recomputed.members[1]?.scoringEvidence?.completedCredentialNames.push(
      'Synthetic unverified qualification',
    );
    const result = createRetainedParticipationReceipt(fixture);
    if (!result.ok) throw new Error('Synthetic receipt missing');
    expect(result.evaluation.members[1]).toEqual(fixture.original.members[1]);
    expect(verifyRetainedParticipationReceipt({ ...fixture, content: result.content }).ok).toBe(
      true,
    );
  });
});
