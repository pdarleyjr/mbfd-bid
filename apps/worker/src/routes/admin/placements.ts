import type { JwtPayload } from '@mbfd/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { bidSessions, bids } from '../../db/schema.js';
import { loadFrozenSessionBidPolicy } from '../../lib/bid-policy.js';
import { createCsvStream } from '../../lib/csv-stream.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

const router = new Hono<Env>();
router.use('*', requireAdmin);

router.get('/export', async (c) => {
  const sessionIdRaw = c.req.query('bid_session_id') ?? c.req.query('session_id');
  const format = c.req.query('format') ?? 'csv';
  if (sessionIdRaw === undefined) return c.json({ error: 'bid_session_id_required' }, 400);
  if (format !== 'csv') return c.json({ error: 'unsupported_format', format }, 400);
  const sessionId: string = sessionIdRaw;

  const db = getDb(c.env.DB);
  const session = await db.select().from(bidSessions).where(eq(bidSessions.id, sessionId)).get();
  if (session === undefined) return c.json({ error: 'session_not_found' }, 404);

  // Placements are a historical session artifact. It must never resolve an
  // established session through mutable roster or template records, because a
  // later correction to either source would silently rewrite the export.
  const frozenPolicy = await loadFrozenSessionBidPolicy(db, sessionId);
  if (!frozenPolicy.ok || frozenPolicy.snapshot.v !== 3) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: !frozenPolicy.ok
          ? frozenPolicy.code
          : 'session_policy_snapshot_material_missing',
      },
      409,
    );
  }
  const frozenMembersById = new Map(
    frozenPolicy.snapshot.members.map((member) => [member.memberId, member]),
  );
  const frozenPositionsById = new Map(
    frozenPolicy.snapshot.ruleBookMaterial.positions.map((position) => [position.id, position]),
  );
  const frozenBiddablePositionIds = new Set(frozenPolicy.coverage.validRulePositionIds);

  // Validate every persisted placement before opening the CSV response. A
  // stream cannot change its HTTP status after it starts, so unresolved frozen
  // references must be detected before any bytes are emitted.
  const placementReferences = await db
    .select({ memberId: bids.memberId, positionId: bids.positionId })
    .from(bids)
    .where(eq(bids.bidSessionId, sessionId))
    .all();
  const hasMissingFrozenReference = placementReferences.some(
    (placement) =>
      !frozenMembersById.has(placement.memberId) || !frozenPositionsById.has(placement.positionId),
  );
  if (hasMissingFrozenReference) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_reference_missing',
      },
      409,
    );
  }
  const hasInvalidFrozenReference = placementReferences.some((placement) => {
    const member = frozenMembersById.get(placement.memberId);
    const position = frozenPositionsById.get(placement.positionId);
    return (
      member?.pool === 'EXCLUDED' ||
      position?.bidParticipation !== 'BIDDABLE' ||
      !frozenBiddablePositionIds.has(placement.positionId)
    );
  });
  if (hasInvalidFrozenReference) {
    return c.json(
      {
        error: 'session_policy_snapshot_unavailable',
        policy_error: 'session_policy_snapshot_reference_invalid',
      },
      409,
    );
  }

  const PAGE = 500;

  type Row = {
    ordinal: number;
    memberId: number;
    memberLabel: string;
    memberRank: string;
    positionId: string;
    positionName: string;
    shift: string;
    station: string;
    unit: string;
    rankRequired: string;
    aDay: string | null;
    forced: boolean;
    adminActorId: number | null;
    pickedAt: Date;
  };

  async function* rows(): AsyncIterable<Row> {
    let offset = 0;
    while (true) {
      const page = await db
        .select({
          ordinal: bids.ordinal,
          memberId: bids.memberId,
          positionId: bids.positionId,
          aDay: bids.aDay,
          forced: bids.forced,
          adminActorId: bids.adminActorId,
          pickedAt: bids.pickedAt,
        })
        .from(bids)
        .where(eq(bids.bidSessionId, sessionId))
        .orderBy(asc(bids.ordinal))
        .limit(PAGE)
        .offset(offset)
        .all();
      for (const r of page) {
        const member = frozenMembersById.get(r.memberId);
        const position = frozenPositionsById.get(r.positionId);
        // References were preflighted before opening the stream. Keep this
        // defensive guard for a concurrent invalid write, without consulting a
        // mutable roster or position table.
        if (member === undefined || position === undefined) {
          throw new Error('session policy snapshot reference disappeared');
        }
        yield {
          ordinal: r.ordinal,
          memberId: member.memberId,
          memberLabel: `snapshot-member-${member.memberId}`,
          memberRank: member.rank,
          positionId: r.positionId,
          positionName: position.positionName,
          shift: position.shift,
          station: position.station,
          unit: position.unit,
          rankRequired: position.rankRequired,
          aDay: r.aDay,
          forced: r.forced,
          adminActorId: r.adminActorId,
          pickedAt: r.pickedAt instanceof Date ? r.pickedAt : new Date(r.pickedAt as number),
        };
      }
      if (page.length < PAGE) return;
      offset += PAGE;
    }
  }

  const stream = createCsvStream<Row>(rows(), [
    { header: 'ordinal', value: (r) => r.ordinal },
    { header: 'member_id', value: (r) => r.memberId },
    { header: 'member_label', value: (r) => r.memberLabel },
    { header: 'member_rank', value: (r) => r.memberRank },
    { header: 'position_id', value: (r) => r.positionId },
    { header: 'position_name', value: (r) => r.positionName },
    { header: 'shift', value: (r) => r.shift },
    { header: 'station', value: (r) => r.station },
    { header: 'unit', value: (r) => r.unit },
    { header: 'rank_required', value: (r) => r.rankRequired },
    { header: 'a_day', value: (r) => r.aDay },
    { header: 'forced', value: (r) => r.forced },
    { header: 'admin_actor_id', value: (r) => r.adminActorId },
    { header: 'picked_at', value: (r) => r.pickedAt.toISOString() },
  ]);

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mbfd-placements-${sessionId}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

export default router;
