import { zValidator } from '@hono/zod-validator';
import type { JwtPayload } from '@mbfd/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { loadAdminEligibilityListContext } from '../../lib/admin-eligibility-list.js';
import { canonicalBidDefinition } from '../../lib/bid-definition-content.js';
import {
  bidDefinitionSummary,
  bidVersionMetadata,
  loadCurrentBidDefinition,
  previewBidDefinition,
} from '../../lib/bid-definition-facade.js';
import {
  BidImpactRequestSchema,
  previewBidDefinitionImpact,
} from '../../lib/bid-definition-impact.js';
import {
  BidLiveSelectionSchema,
  CreateBidLiveSchema,
  createBidDefinitionLive,
  previewBidDefinitionLive,
} from '../../lib/bid-definition-live.js';
import {
  BidIdentitySchema,
  BidMockSelectionSchema,
  CreateBidMockSchema,
  createBidDefinitionMock,
  previewBidDefinitionMock,
} from '../../lib/bid-definition-mock.js';
import {
  BidStageParticipantPreviewRequestSchema,
  previewBidStageParticipantMembership,
} from '../../lib/bid-definition-stage-participant-preview.js';
import { SaveBidDefinitionSchema, saveBidDefinition } from '../../lib/bid-definition-store.js';
import {
  BidDefinitionVersionRowSchema,
  loadBidDefinitionVersion,
} from '../../lib/bid-definition-version.js';
import { loadBidEligibilityEvidence } from '../../lib/bid-eligibility-evidence.js';
import {
  capture2026BidEvidenceFreeze,
  read2026BidEvidenceFreeze,
} from '../../lib/bid-evidence-freeze-capture.js';
import {
  BidProfileReviewRequestSchema,
  previewBidProfiles,
} from '../../lib/bid-profile-preview.js';
import {
  type ReviewedAdministrativeStaffingSlot,
  buildCorrected2026Successor,
  withReviewed2026AdministrativeConnections,
} from '../../lib/corrected-2026-successor.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload; bidYear: number } };
const router = new Hono<Env>();
const expected = SaveBidDefinitionSchema.shape.expected;
const reason = SaveBidDefinitionSchema.shape.reason;
const SaveBody = z.object({ expected, content: z.unknown(), reason }).strict();
const RestoreBody = z.object({ expected, versionId: BidIdentitySchema, reason }).strict();
const PreviewBody = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('definition'),
      expected,
      intent: SaveBidDefinitionSchema.shape.intent,
    })
    .strict(),
  BidMockSelectionSchema.extend({ kind: z.literal('mock') }).strict(),
  BidLiveSelectionSchema.extend({ kind: z.literal('live') }).strict(),
  BidImpactRequestSchema,
  BidStageParticipantPreviewRequestSchema,
  BidProfileReviewRequestSchema,
]);
const SaveResult = z
  .object({
    changed: z.boolean(),
    versionId: BidIdentitySchema,
    versionNumber: z.number().int().positive(),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    predecessorId: BidIdentitySchema.nullable(),
    restoredFromId: BidIdentitySchema.nullable(),
  })
  .strict();
const errorStatus = (error: string) =>
  error === 'live_action_forbidden'
    ? (403 as const)
    : error === 'bid_year_not_found' || error === 'bid_version_not_found'
      ? (404 as const)
      : error.startsWith('invalid_') || error === 'bid_definition_year_mismatch'
        ? (400 as const)
        : (409 as const);
function mutationKey(key: string | undefined) {
  if (key === undefined) return { ok: false as const, error: 'idempotency_key_required' };
  if (!key || key !== key.trim() || key.length > 200)
    return { ok: false as const, error: 'invalid_idempotency_key' };
  return { ok: true as const, key };
}

const yearContext: MiddlewareHandler<Env> = async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  const path = c.req.param('year');
  if (!/^\d{4}$/.test(path ?? '')) return c.json({ error: 'invalid_bid_year' }, 400);
  const year = Number(path);
  if (year < 2024 || year > 2100) return c.json({ error: 'invalid_bid_year' }, 400);
  if (c.req.method === 'POST') {
    try {
      await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
  }
  const existing = await c.env.DB.prepare('SELECT year FROM bid_years WHERE year=?')
    .bind(year)
    .first();
  if (!existing) return c.json({ error: 'bid_year_not_found' }, 404);
  c.set('bidYear', year);
  await next();
  return;
};
// Scope middleware to concrete facade paths. Hono's wildcard also matches an
// empty suffix, which would otherwise consume the existing /bid/freeze command.
for (const path of [
  '/:year/current',
  '/:year/my-mock',
  '/:year/versions',
  '/:year/versions/:versionId',
  '/:year/preview',
  '/:year/restore',
  '/:year/mock-sessions',
  '/:year/live-sessions',
  '/:year/reviewed-2026-candidate',
  '/:year/evidence-freeze',
  '/:year/marine-evidence-review',
]) {
  router.use(path, requireAdmin, yearContext);
}

router.get('/:year/current', async (c) => {
  const result = await loadCurrentBidDefinition(c.env.DB, c.get('bidYear'));
  return result.ok ? c.json(result.response) : c.json(result, errorStatus(result.error));
});
router.get('/:year/my-mock', async (c) => {
  const versionId = BidIdentitySchema.safeParse(c.req.query('versionId'));
  if (!versionId.success) return c.json({ error: 'invalid_version_id' }, 400);
  const mock = await c.env.DB.prepare(`SELECT s.id FROM bid_sessions s
    JOIN bid_session_policy_snapshots p ON p.bid_session_id=s.id
    WHERE s.bid_year=? AND s.is_mock=1 AND s.completed_at IS NULL AND p.bid_version_id=?
    AND EXISTS(SELECT 1 FROM audit_log a WHERE a.bid_session_id=s.id AND a.action='session_start' AND a.actor_id=?)
    ORDER BY p.captured_at DESC LIMIT 1`)
    .bind(c.get('bidYear'), versionId.data, c.get('claims').member_id)
    .first<{ id: string }>();
  return c.json({ mock: mock ?? null });
});
router.get('/:year/versions', async (c) => {
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      beforeVersionNumber: z.coerce.number().int().positive().optional(),
    })
    .strict()
    .safeParse(c.req.query());
  if (!query.success)
    return c.json({ error: 'invalid_pagination', issues: query.error.issues }, 400);
  const { limit, beforeVersionNumber } = query.data;
  const rows = await c.env.DB.prepare(`SELECT * FROM bid_definition_versions WHERE bid_year=?
    AND (? IS NULL OR version_number<?) ORDER BY version_number DESC LIMIT ?`)
    .bind(c.get('bidYear'), beforeVersionNumber ?? null, beforeVersionNumber ?? null, limit + 1)
    .all();
  const parsed = z.array(BidDefinitionVersionRowSchema).safeParse(rows.results);
  if (!parsed.success) return c.json({ error: 'bid_version_integrity_failed' }, 409);
  const versions = parsed.data.slice(0, limit).map(bidVersionMetadata);
  return c.json({
    bidYear: c.get('bidYear'),
    versions,
    nextBeforeVersionNumber:
      parsed.data.length > limit ? (versions.at(-1)?.versionNumber ?? null) : null,
  });
});
router.get('/:year/versions/:versionId', async (c) => {
  const id = BidIdentitySchema.safeParse(c.req.param('versionId'));
  if (!id.success) return c.json({ error: 'invalid_version_id' }, 400);
  const version = await loadBidDefinitionVersion(c.env.DB, c.get('bidYear'), id.data);
  if (!version.ok) return c.json({ error: version.error }, errorStatus(version.error));
  return c.json({
    bidYear: c.get('bidYear'),
    version: bidVersionMetadata(version.row),
    content: version.content,
    ...bidDefinitionSummary(version.content, version.coverage),
  });
});
router.get('/:year/evidence-freeze', async (c) => {
  if (c.get('bidYear') !== 2026) return c.json({ error: 'reviewed_2026_year_required' }, 400);
  const freeze = await read2026BidEvidenceFreeze(c.env.DB);
  return c.json({ bidYear: 2026, freeze });
});
router.post('/:year/evidence-freeze', requireStepUpAuth(), async (c) => {
  if (c.get('bidYear') !== 2026) return c.json({ error: 'reviewed_2026_year_required' }, 400);
  const result = await capture2026BidEvidenceFreeze(c.env.DB, String(c.get('claims').sub));
  return result.ok ? c.json(result) : c.json(result, 409);
});
router.get('/:year/marine-evidence-review', async (c) => {
  if (c.get('bidYear') !== 2026) return c.json({ error: 'reviewed_2026_year_required' }, 400);
  const current = await loadCurrentBidDefinition(c.env.DB, 2026);
  if (!current.ok) return c.json({ error: current.error }, errorStatus(current.error));
  const version = current.response.version;
  if (!version || version.versionNumber <= 8)
    return c.json({ error: 'reviewed_2026_version_required' }, 409);
  const verified = await loadBidDefinitionVersion(c.env.DB, 2026, version.id);
  if (!verified.ok || verified.sha256 !== version.contentSha256)
    return c.json({ error: 'bid_version_integrity_failed' }, 409);
  const db = getDb(c.env.DB);
  const evidence = await loadBidEligibilityEvidence(db);
  const marineNames =
    /\b(?:MMC|Marine|Boat|IADRS|Watermanship|Public Safety Diver|Open Water|OUPV|PADI|DRI)\b/i;
  const candidateIds = new Set([
    ...evidence.credentialRows
      .filter((row) => marineNames.test(row.name))
      .map((row) => row.memberId),
    ...evidence.qualificationEventRows
      .filter(
        (row) =>
          (row.credentialName && marineNames.test(row.credentialName)) ||
          (row.specialtyCode && marineNames.test(row.specialtyCode)),
      )
      .map((row) => row.memberId),
  ]);
  const candidateEmployees = new Set(
    evidence.memberRows
      .filter((member) => candidateIds.has(member.id))
      .map((member) => member.employeeId),
  );
  const marinePositions = verified.content.positions.filter(
    (position) =>
      position.station === 'Station #6' &&
      position.shift !== 'D' &&
      verified.content.participation.some(
        (entry) => entry.positionId === position.id && entry.bidParticipation === 'BIDDABLE',
      ),
  );
  const asOf =
    verified.content.settings && verified.content.settings.v !== 1
      ? verified.content.settings.credentialEvaluationOn
      : '2026-09-30';
  const context = await loadAdminEligibilityListContext({
    db,
    ruleBookVersion: verified.row.rule_book_version,
    asOf,
    bidYear: 2026,
  });
  const rows = marinePositions
    .flatMap((position) => {
      const evaluated = context.evaluate(position.id);
      return [...evaluated.dataBlocked, ...evaluated.excluded]
        .filter((decision) => candidateEmployees.has(decision.member.employeeId))
        .map((decision) => ({
          member: `${decision.member.lastName}, ${decision.member.firstName}`,
          employeeId: decision.member.employeeId,
          positionId: position.id,
          marinePosition: `${position.shift} Shift · ${position.unit} · ${position.positionName}`,
          missingEvidence: [
            ...decision.result.reasons
              .filter((reason) => !reason.satisfied)
              .map((reason) => reason.label),
            ...decision.dataBlockers,
          ],
          sourceReviewed:
            '2026 Bid certificate PDF and calculations workbook (generic labels); current qualification ledger',
          requiredAction:
            'Review person-specific source proof, then record the exact qualification and effective dates in the audited qualification workflow.',
        }));
    })
    .filter((row) => row.missingEvidence.length > 0);
  return c.json({
    bidYear: 2026,
    versionId: version.id,
    versionSha256: version.contentSha256,
    asOf,
    candidateMemberCount: candidateEmployees.size,
    marinePositionCount: marinePositions.length,
    rows,
  });
});
/** Read-only construction of the reviewed successor. The normal preview/save
 * workflow remains responsible for creating a new immutable version. */
router.post('/:year/reviewed-2026-candidate', requireStepUpAuth(), async (c) => {
  if (c.get('bidYear') !== 2026) return c.json({ error: 'reviewed_2026_year_required' }, 400);
  const current = await loadCurrentBidDefinition(c.env.DB, 2026);
  if (!current.ok) return c.json({ error: current.error }, errorStatus(current.error));
  const source = current.response;
  const version = source.version;
  if (
    source.state !== 'VERSIONED' ||
    !version ||
    version.versionNumber !== 8 ||
    version.contentSha256 !== '74ee775dbae3508c16f82bb93e4e2a68a5b3f84a976f05be85c89a0800e3f666'
  )
    return c.json({ error: 'reviewed_2026_predecessor_changed' }, 409);
  const identities = await c.env.DB.prepare(
    'SELECT id AS memberId, employee_id AS employeeId FROM members ORDER BY id',
  ).all<{ memberId: number; employeeId: string }>();
  const staffing = await c.env.DB.prepare(
    `SELECT id,stable_slot_key AS stableSlotKey,shift,station,unit,
    position_name AS positionName,applicable_rank AS applicableRank,
    review_status AS reviewStatus,active_from AS activeFrom,active_to AS activeTo
    FROM staffing_positions WHERE review_status='approved' ORDER BY id`,
  ).all<ReviewedAdministrativeStaffingSlot>();
  let candidate: ReturnType<typeof buildCorrected2026Successor>;
  try {
    candidate = withReviewed2026AdministrativeConnections(
      buildCorrected2026Successor(source.content, {
        evaluationOn: '2026-09-30',
        approvedBidStartOn: '2026-10-24',
        memberIdentities: identities.results,
      }),
      staffing.results,
    );
  } catch {
    return c.json({ error: 'reviewed_2026_candidate_reconciliation_failed' }, 409);
  }
  const canonical = canonicalBidDefinition(candidate);
  if (!canonical.ok)
    return c.json({ error: 'reviewed_2026_candidate_invalid', issues: canonical.issues }, 409);
  return c.json({
    sourceVersionId: version.id,
    sourceSha256: version.contentSha256,
    candidateSha256: canonical.sha256,
    content: canonical.content,
    label: '2026 PRE-CUTOFF REHEARSAL CANDIDATE — final evidence not certified',
  });
});
router.post('/:year/preview', requireStepUpAuth(), zValidator('json', PreviewBody), async (c) => {
  const body = c.req.valid('json');
  if (body.kind === 'profile-review') {
    const result = await previewBidProfiles(c.env.DB, c.get('bidYear'), body);
    return result.ok ? c.json(result.response) : c.json(result, errorStatus(result.error));
  }
  if (body.kind === 'impact') {
    const result = await previewBidDefinitionImpact(c.env.DB, c.get('bidYear'), body);
    return result.ok ? c.json(result.response) : c.json(result, errorStatus(result.error));
  }
  if (body.kind === 'stage-participant-membership') {
    const result = await previewBidStageParticipantMembership(c.env.DB, c.get('bidYear'), body);
    return result.ok ? c.json(result.response) : c.json(result, errorStatus(result.error));
  }
  if (body.kind === 'mock')
    return c.json(
      await previewBidDefinitionMock(c.env.DB, c.get('bidYear'), {
        versionId: body.versionId,
        versionSha256: body.versionSha256,
      }),
    );
  if (body.kind === 'live')
    return c.json(
      await previewBidDefinitionLive(
        c.env.DB,
        c.env,
        c.get('bidYear'),
        { versionId: body.versionId, versionSha256: body.versionSha256 },
        c.get('claims').member_id,
      ),
    );
  const result = await previewBidDefinition(c.env.DB, c.get('bidYear'), body);
  return result.ok ? c.json(result.response) : c.json(result, errorStatus(result.error));
});

router.post('/:year/versions', requireStepUpAuth(), zValidator('json', SaveBody), async (c) => {
  const key = mutationKey(c.req.header('Idempotency-Key'));
  if (!key.ok) return c.json({ error: key.error }, 400);
  const body = c.req.valid('json');
  const result = await saveBidDefinition(c.env.DB, {
    year: c.get('bidYear'),
    key: key.key,
    actorSubject: String(c.get('claims').sub),
    actorId: c.get('claims').member_id,
    expected: body.expected,
    reason: body.reason,
    intent: { operation: 'save', content: body.content },
  });
  if (!result.ok) return c.json(result, errorStatus(result.error));
  const receipt = SaveResult.safeParse(result.response);
  if (!receipt.success) return c.json({ error: 'bid_version_integrity_failed' }, 409);
  return c.json({ ...receipt.data, replayed: result.replayed }, receipt.data.changed ? 201 : 200);
});
router.post('/:year/restore', requireStepUpAuth(), zValidator('json', RestoreBody), async (c) => {
  const key = mutationKey(c.req.header('Idempotency-Key'));
  if (!key.ok) return c.json({ error: key.error }, 400);
  const body = c.req.valid('json');
  const result = await saveBidDefinition(c.env.DB, {
    year: c.get('bidYear'),
    key: key.key,
    actorSubject: String(c.get('claims').sub),
    actorId: c.get('claims').member_id,
    expected: body.expected,
    reason: body.reason,
    intent: { operation: 'restore', versionId: body.versionId },
  });
  if (!result.ok) return c.json(result, errorStatus(result.error));
  const receipt = SaveResult.safeParse(result.response);
  if (!receipt.success) return c.json({ error: 'bid_version_integrity_failed' }, 409);
  return c.json({ ...receipt.data, replayed: result.replayed }, 201);
});
router.post(
  '/:year/mock-sessions',
  requireStepUpAuth(),
  zValidator('json', CreateBidMockSchema),
  async (c) => {
    const key = mutationKey(c.req.header('Idempotency-Key'));
    if (!key.ok) return c.json({ error: key.error }, 400);
    const result = await createBidDefinitionMock(c.env.DB, {
      year: c.get('bidYear'),
      key: key.key,
      actorSubject: String(c.get('claims').sub),
      actorId: c.get('claims').member_id,
      body: c.req.valid('json'),
    });
    return result.ok
      ? c.json({ ...result.response, replayed: result.replayed }, 201)
      : c.json(result, errorStatus(result.error));
  },
);
router.post(
  '/:year/live-sessions',
  requireStepUpAuth(),
  zValidator('json', CreateBidLiveSchema),
  async (c) => {
    const key = mutationKey(c.req.header('Idempotency-Key'));
    if (!key.ok) return c.json({ error: key.error }, 400);
    const result = await createBidDefinitionLive(c.env.DB, c.env, {
      year: c.get('bidYear'),
      key: key.key,
      actorSubject: String(c.get('claims').sub),
      actorId: c.get('claims').member_id,
      body: c.req.valid('json'),
    });
    return result.ok
      ? c.json({ ...result.response, replayed: result.replayed }, 201)
      : c.json(result, errorStatus(result.error));
  },
);
export default router;
