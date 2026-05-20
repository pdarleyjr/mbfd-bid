import type { JwtPayload } from '@mbfd/shared';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../../db/index.js';
import { bidSessions, bids, members, positions } from '../../db/schema.js';
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

  const PAGE = 500;

  type Row = {
    ordinal: number;
    employeeId: string;
    memberName: string;
    positionId: string;
    positionName: string | null;
    shift: string | null;
    station: string | null;
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
          employeeId: members.employeeId,
          firstName: members.firstName,
          lastName: members.lastName,
          positionId: bids.positionId,
          positionName: positions.positionName,
          shift: positions.shift,
          station: positions.station,
          aDay: bids.aDay,
          forced: bids.forced,
          adminActorId: bids.adminActorId,
          pickedAt: bids.pickedAt,
        })
        .from(bids)
        .innerJoin(members, eq(bids.memberId, members.id))
        .leftJoin(positions, eq(positions.id, bids.positionId))
        .where(eq(bids.bidSessionId, sessionId))
        .orderBy(asc(bids.ordinal))
        .limit(PAGE)
        .offset(offset)
        .all();
      for (const r of page) {
        yield {
          ordinal: r.ordinal,
          employeeId: r.employeeId,
          memberName: `${r.lastName}, ${r.firstName}`,
          positionId: r.positionId,
          positionName: r.positionName,
          shift: r.shift,
          station: r.station,
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
    { header: 'member_employee_id', value: (r) => r.employeeId },
    { header: 'member_name', value: (r) => r.memberName },
    { header: 'position_id', value: (r) => r.positionId },
    { header: 'position_name', value: (r) => r.positionName },
    { header: 'shift', value: (r) => r.shift },
    { header: 'station', value: (r) => r.station },
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
