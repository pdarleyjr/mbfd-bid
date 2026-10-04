import type { Headers as WorkerHeaders } from '@cloudflare/workers-types';
import type { JwtPayload } from '@mbfd/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getDb } from '../../db/index.js';
import { bidSessions, members } from '../../db/schema.js';
import {
  type BidFormReceipt,
  BidFormReceiptSchema,
  PublishBidFormArchiveSchema,
  bidFormArchiveHasIdentityConflict,
  bidFormArchiveHash,
  projectMemberBidForm,
} from '../../lib/bid-form-source.js';
import { loadBidSessionPolicySnapshot } from '../../lib/bid-policy.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

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
