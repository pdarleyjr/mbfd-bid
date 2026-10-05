import type { Headers as WorkerHeaders } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getDb } from '../../db/index.js';
import { bidSessions, members } from '../../db/schema.js';
import { auditInsertStatement } from '../../lib/audit.js';
import {
  type BidFormReceipt,
  BidFormReceiptSchema,
  PublishBidFormArchiveSchema,
  bidFormArchiveHasIdentityConflict,
  bidFormArchiveHash,
  projectMemberBidForm,
} from '../../lib/bid-form-source.js';
import { loadBidSessionPolicySnapshot } from '../../lib/bid-policy.js';
import {
  RANK_SOURCE_OPERATION,
  RankSourceRequestSchema,
  applyRankSource,
  buildRankSourceMembers,
  createRankSourceReceipt,
  loadSessionRankSource,
  rankSourceKey,
} from '../../lib/bid-rank-source.js';
import { runWithNormalBidMutationLease } from '../../lib/specialty-interruption-guard.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin, requireLiveBidAction } from './middleware.js';

const PREFIX = 'bid-forms/v1/';
const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
router.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

async function readReceipt(
  env: WorkerEnv,
  year: number,
  key = `${PREFIX}${year}.json`,
): Promise<{ receipt: BidFormReceipt; etag: string } | null> {
  const object = await env.R2_EXPORTS.get(key);
  if (!object) return null;
  const parsed = BidFormReceiptSchema.safeParse(await object.json().catch(() => null));
  if (
    !parsed.success ||
    parsed.data.archive.year !== year ||
    bidFormArchiveHasIdentityConflict(parsed.data.archive) ||
    (await bidFormArchiveHash(parsed.data.archive)) !== parsed.data.sha256
  ) {
    throw new Error('bid_form_archive_integrity_failed');
  }
  return { receipt: parsed.data, etag: object.etag };
}

/** Counts and revision identity only; private submissions stay in member views. */
router.get('/:year/source', async (c) => {
  const yearText = c.req.param('year');
  const year = Number(yearText);
  if (!/^\d{4}$/.test(yearText) || year < 2000 || year > 2200)
    return c.json({ error: 'invalid_bid_form_selection' }, 400);
  try {
    const stored = await readReceipt(c.env, year);
    const archive = stored?.receipt.archive;
    return c.json({
      year,
      status: stored ? 'PUBLISHED' : 'NONE',
      archiveSha256: stored?.receipt.sha256 ?? null,
      publishedAt: stored?.receipt.publishedAt ?? null,
      source: archive?.source ?? null,
      submittedForms: archive?.forms.length ?? 0,
      notSubmitted: archive?.notSubmitted.length ?? 0,
      airTechReferences: archive?.airTechReferences?.length ?? 0,
      rankLists: archive?.rankLists?.length ?? 0,
      rankRows: archive?.rankLists?.reduce((total, list) => total + list.rows.length, 0) ?? 0,
    });
  } catch (error) {
    const corrupt = error instanceof Error && error.message === 'bid_form_archive_integrity_failed';
    return c.json(
      { error: corrupt ? 'bid_form_archive_integrity_failed' : 'bid_form_source_unavailable' },
      corrupt ? 409 : 503,
    );
  }
});

router.get('/:year/score-review', async (c) => {
  const yearText = c.req.param('year');
  const year = Number(yearText);
  if (!/^\d{4}$/.test(yearText) || year < 2000 || year > 2200)
    return c.json({ error: 'invalid_bid_form_selection' }, 400);
  try {
    const stored = await readReceipt(c.env, year);
    const db = getDb(c.env.DB);
    const candidates = await db.all<{
      id: string;
      snapshotSha256: string;
      versionSha256: string;
    }>(sql`SELECT s.id,p.snapshot_sha256 AS snapshotSha256,p.bid_version_sha256 AS versionSha256
      FROM bid_sessions s JOIN bid_session_policy_snapshots p ON p.bid_session_id=s.id
      WHERE s.bid_year=${year} AND s.is_mock=0 AND s.current_phase='config'
      AND p.snapshot_sha256 IS NOT NULL AND p.bid_version_sha256 IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM canonical_bid_session_state c WHERE c.bid_session_id=s.id)
      AND NOT EXISTS(SELECT 1 FROM bid_order o WHERE o.bid_session_id=s.id)
      AND NOT EXISTS(SELECT 1 FROM bids b WHERE b.bid_session_id=s.id)
      ORDER BY s.id`);
    const sessions = [];
    for (const candidate of candidates) {
      const loaded = await loadBidSessionPolicySnapshot(db, candidate.id);
      if (!loaded.snapshot || loaded.snapshot.v !== 3)
        throw new Error('rank_source_snapshot_invalid');
      const existing = await loadSessionRankSource(db, candidate.id);
      sessions.push({
        id: candidate.id,
        isMock: false,
        phase: 'config',
        alreadyApplied:
          existing?.record.archiveSha256 === stored?.receipt.sha256 && existing !== null,
        sourceReceiptSha256: existing?.sha256 ?? null,
        expectedSnapshotSha256: candidate.snapshotSha256,
        expectedVersionSha256: candidate.versionSha256,
      });
    }
    return c.json({
      year,
      archiveSha256: stored?.receipt.sha256 ?? null,
      sessions,
      available: year === 2026 && stored?.receipt.archive.rankLists?.length === 16,
    });
  } catch {
    return c.json({ error: 'rank_source_review_unavailable' }, 503);
  }
});

/** Pre-start scoring derivation under the same durable lease used by Start.
 * Immutable receipt + audit commit together; the base snapshot is never edited. */
router.post(
  '/:year/sessions/:id/score-reference',
  bodyLimit({
    maxSize: 8192,
    onError: (c) => c.json({ error: 'rank_source_request_too_large' }, 413),
  }),
  requireStepUpAuth(),
  requireLiveBidAction('approve_transition'),
  async (c) => {
    const year = Number(c.req.param('year'));
    const sessionId = c.req.param('id');
    if (c.req.param('year') !== '2026' || !sessionId || sessionId.length > 200)
      return c.json({ error: 'invalid_bid_form_selection' }, 400);
    const parsed = RankSourceRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'rank_source_request_invalid' }, 400);
    const body = parsed.data;
    const db = getDb(c.env.DB);
    const responseFor = (
      receipt: Awaited<ReturnType<typeof loadSessionRankSource>>,
      alreadyApplied: boolean,
    ) => {
      if (!receipt) throw new Error('rank_source_receipt_missing');
      return {
        sessionId,
        archiveSha256: receipt.record.archiveSha256,
        receiptSha256: receipt.sha256,
        memberCount: receipt.record.members.length,
        referenceCount: receipt.record.members.reduce(
          (sum, row) => sum + row.scoreReferenceEvidence.length,
          0,
        ),
        alreadyApplied,
      };
    };
    try {
      const mutation = await runWithNormalBidMutationLease(c.env, sessionId, async () => {
        const pin = await db.get<{
          year: number;
          isMock: number;
          phase: string;
          versionId: string;
          versionSha256: string;
          snapshotSha256: string;
        }>(sql`SELECT s.bid_year AS year,s.is_mock AS isMock,s.current_phase AS phase,p.bid_version_id AS versionId,
        p.bid_version_sha256 AS versionSha256,p.snapshot_sha256 AS snapshotSha256
        FROM bid_sessions s JOIN bid_session_policy_snapshots p ON p.bid_session_id=s.id WHERE s.id=${sessionId}`);
        if (!pin) return c.json({ error: 'bid_session_not_found' }, 404);
        if (pin.isMock !== 0) return c.json({ error: 'rank_source_prepared_real_only' }, 409);
        if (
          pin.year !== year ||
          pin.snapshotSha256 !== body.expectedSnapshotSha256 ||
          pin.versionSha256 !== body.expectedVersionSha256
        )
          return c.json({ error: 'rank_source_changed_reload_before_applying' }, 409);
        const existing = await loadSessionRankSource(db, sessionId);
        if (existing?.record.archiveSha256 === body.archiveSha256)
          return c.json(responseFor(existing, true));
        const clean = await db.get<{ clear: number }>(sql`SELECT
        (NOT EXISTS(SELECT 1 FROM canonical_bid_session_state WHERE bid_session_id=${sessionId})
        AND NOT EXISTS(SELECT 1 FROM bid_order WHERE bid_session_id=${sessionId})
        AND NOT EXISTS(SELECT 1 FROM bids WHERE bid_session_id=${sessionId})
        AND NOT EXISTS(SELECT 1 FROM bid_command_receipts WHERE bid_session_id=${sessionId})) AS clear`);
        if (pin.phase !== 'config' || clean?.clear !== 1)
          return c.json({ error: 'rank_source_requires_unstarted_bid' }, 409);
        const source = await readReceipt(c.env, year);
        if (!source || source.receipt.sha256 !== body.archiveSha256)
          return c.json({ error: 'rank_source_changed_reload_before_applying' }, 409);
        const loaded = await loadBidSessionPolicySnapshot(db, sessionId);
        if (!loaded.snapshot || loaded.snapshot.v !== 3)
          return c.json({ error: 'rank_source_snapshot_invalid' }, 409);
        const appliedAt = Math.max(Date.now(), (existing?.record.appliedAt ?? 0) + 1);
        const receipt = createRankSourceReceipt({
          year,
          sessionId,
          versionId: pin.versionId,
          versionSha256: pin.versionSha256,
          baseSnapshotSha256: pin.snapshotSha256,
          archiveSha256: source.receipt.sha256,
          appliedBy: String(c.get('claims').sub),
          appliedAt,
          members: buildRankSourceMembers(loaded.snapshot, source.receipt.archive),
        });
        applyRankSource(loaded.snapshot, receipt);
        const condition = {
          sql: `EXISTS(SELECT 1 FROM bid_sessions s JOIN bid_session_policy_snapshots p ON p.bid_session_id=s.id
          WHERE s.id=? AND s.is_mock=0 AND s.current_phase='config' AND p.snapshot_sha256=? AND p.bid_version_sha256=?)
          AND NOT EXISTS(SELECT 1 FROM canonical_bid_session_state WHERE bid_session_id=?)
          AND NOT EXISTS(SELECT 1 FROM bid_order WHERE bid_session_id=?)
          AND NOT EXISTS(SELECT 1 FROM bids WHERE bid_session_id=?)
          AND NOT EXISTS(SELECT 1 FROM bid_command_receipts WHERE bid_session_id=?)`,
          parameters: [
            sessionId,
            pin.snapshotSha256,
            pin.versionSha256,
            sessionId,
            sessionId,
            sessionId,
            sessionId,
          ],
        };
        const results = await c.env.DB.batch([
          c.env.DB.prepare(`INSERT INTO admin_configuration_receipts
          (idempotency_key,actor_subject,operation,request_json,response_json,created_at) VALUES(?,?,?,?,?,?)`).bind(
            rankSourceKey(sessionId, source.receipt.sha256),
            receipt.record.appliedBy,
            RANK_SOURCE_OPERATION,
            JSON.stringify(body),
            JSON.stringify(receipt),
            appliedAt,
          ),
          auditInsertStatement(
            c.env.DB,
            {
              bidSessionId: sessionId,
              actorType: 'admin',
              actorId: c.get('claims').member_id ?? null,
              action: 'bid_configuration_set',
              targetKind: 'rank_source',
              targetId: receipt.sha256,
              beforeState: { scoreReceiptSha256: existing?.sha256 ?? null },
              afterState: {
                ...responseFor(receipt, false),
                baseSnapshotSha256: pin.snapshotSha256,
                qualificationChanges: 0,
                selectionChanges: 0,
              },
            },
            new Date(appliedAt),
            true,
            condition,
          ),
        ]);
        if (results.some((result) => result.meta.changes !== 1))
          throw new Error('rank_source_commit_failed');
        const readback = await loadSessionRankSource(db, sessionId);
        if (!readback || readback.sha256 !== receipt.sha256)
          throw new Error('rank_source_commit_failed');
        return c.json(responseFor(readback, false), 201);
      });
      if (!mutation.ok) return c.json({ error: mutation.error }, 409);
      return mutation.value;
    } catch {
      return c.json({ error: 'rank_source_update_unavailable_reload_before_retrying' }, 503);
    }
  },
);

router.get('/:year/members/:memberId', async (c) => {
  const { year: yearText, memberId: memberText } = c.req.param();
  const year = Number(yearText);
  const memberId = Number(memberText);
  const sessionIds = c.req.queries('session_id') ?? [];
  if (
    !/^\d{4}$/.test(yearText) ||
    year < 2000 ||
    year > 2200 ||
    !/^[1-9]\d*$/.test(memberText) ||
    !Number.isSafeInteger(memberId) ||
    sessionIds.length > 1
  ) {
    return c.json({ error: 'invalid_bid_form_selection' }, 400);
  }
  const sessionId = sessionIds[0] ?? null;
  if (sessionId !== null && (!sessionId || sessionId.length > 100))
    return c.json({ error: 'invalid_bid_form_selection' }, 400);
  const db = getDb(c.env.DB);
  let identity: { memberId: number; employeeId: string; firstName: string; lastName: string };
  if (sessionId !== null) {
    const session = await db
      .select({ year: bidSessions.bidYear })
      .from(bidSessions)
      .where(eq(bidSessions.id, sessionId))
      .get();
    if (!session) return c.json({ error: 'bid_session_not_found' }, 404);
    if (session.year !== year) return c.json({ error: 'bid_form_session_year_mismatch' }, 409);
    const frozen = await loadBidSessionPolicySnapshot(db, sessionId);
    if (!frozen.snapshot || frozen.snapshot.v !== 3)
      return c.json({ error: 'bid_form_frozen_identity_unavailable' }, 409);
    if (!frozen.snapshot.operatorIdentityProjection?.length)
      return c.json({ error: 'bid_form_frozen_identity_unavailable' }, 409);
    const matches = (frozen.snapshot.operatorIdentityProjection ?? []).filter(
      (row) => row.memberId === memberId,
    );
    if (matches.length !== 1 || !frozen.snapshot.members.some((row) => row.memberId === memberId))
      return c.json({ error: 'bid_form_member_not_in_saved_bid' }, 404);
    const match = matches[0];
    if (!match) return c.json({ error: 'bid_form_frozen_identity_unavailable' }, 409);
    identity = match;
  } else {
    const member = await db
      .select({
        memberId: members.id,
        employeeId: members.employeeId,
        firstName: members.firstName,
        lastName: members.lastName,
      })
      .from(members)
      .where(eq(members.id, memberId))
      .get();
    if (!member) return c.json({ error: 'member_not_found' }, 404);
    identity = member;
  }
  try {
    const receipt = await readReceipt(c.env, year);
    return c.json(projectMemberBidForm(receipt?.receipt ?? null, identity, year, sessionId));
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error && error.message === 'bid_form_archive_integrity_failed'
            ? 'bid_form_archive_integrity_failed'
            : 'bid_form_source_unavailable',
      },
      error instanceof Error && error.message === 'bid_form_archive_integrity_failed' ? 409 : 503,
    );
  }
});

/** Documentary source publication only. It neither mutates the member directory
 * nor writes preference commands, qualifications, seats, sessions or audits. */
router.post(
  '/',
  bodyLimit({
    maxSize: 1_048_576,
    onError: (c) => c.json({ error: 'bid_form_archive_too_large' }, 413),
  }),
  async (c) => {
    const parsed = PublishBidFormArchiveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error: 'invalid_bid_form_archive',
          issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code })),
        },
        400,
      );
    const { archive, expectedArchiveSha256 } = parsed.data;
    if (bidFormArchiveHasIdentityConflict(archive)) {
      return c.json({ error: 'bid_form_archive_identity_conflict' }, 409);
    }
    const sha256 = await bidFormArchiveHash(archive);
    try {
      const existing = await readReceipt(c.env, archive.year);
      if (existing?.receipt.sha256 === sha256)
        return c.json({
          year: archive.year,
          sha256,
          publishedAt: existing.receipt.publishedAt,
          alreadyPublished: true,
        });
      if (
        (existing && expectedArchiveSha256 !== existing.receipt.sha256) ||
        (!existing && expectedArchiveSha256 !== undefined)
      )
        return c.json({ error: 'bid_form_source_changed_reload_before_publishing' }, 409);
      const receipt = BidFormReceiptSchema.parse({
        archive,
        sha256,
        publishedAt: new Date().toISOString(),
        publishedBy: String(c.get('claims').sub),
      });
      const createOptions = {
        onlyIf: new Headers({ 'If-None-Match': '*' }) as unknown as WorkerHeaders,
        httpMetadata: { contentType: 'application/json' },
      };
      // Preserve immutable versions before publishing a new current-year pointer.
      // A failed conditional pointer update never loses either source revision.
      for (const version of [existing?.receipt, receipt]) {
        if (!version) continue;
        const key = `${PREFIX}revisions/${archive.year}/${version.sha256}.json`;
        const preserved = await c.env.R2_EXPORTS.put(key, JSON.stringify(version), createOptions);
        if (!preserved) {
          const prior = await readReceipt(c.env, archive.year, key);
          if (!prior || prior.receipt.sha256 !== version.sha256)
            return c.json({ error: 'bid_form_revision_preservation_failed' }, 409);
        }
      }
      const saved = await c.env.R2_EXPORTS.put(
        `${PREFIX}${archive.year}.json`,
        JSON.stringify(receipt),
        {
          onlyIf: existing ? { etagMatches: existing.etag } : createOptions.onlyIf,
          httpMetadata: createOptions.httpMetadata,
        },
      );
      if (!saved) return c.json({ error: 'bid_form_source_changed_reload_before_publishing' }, 409);
      return c.json(
        { year: archive.year, sha256, publishedAt: receipt.publishedAt, alreadyPublished: false },
        201,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error && error.message === 'bid_form_archive_integrity_failed'
              ? 'bid_form_archive_integrity_failed'
              : 'bid_form_source_unavailable',
        },
        error instanceof Error && error.message === 'bid_form_archive_integrity_failed' ? 409 : 503,
      );
    }
  },
);

export default router;
