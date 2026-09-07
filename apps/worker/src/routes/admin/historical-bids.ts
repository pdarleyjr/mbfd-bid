import type { Headers as WorkerHeaders } from '@cloudflare/workers-types';
import {
  type HistoricalBid,
  HistoricalBidReceiptSchema,
  HistoricalBidSchema,
  type JwtPayload,
} from '@mbfd/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { operationalDate } from '../../lib/operational-date.js';
import type { WorkerEnv } from '../../types/env.js';
import { loadCurrentRosterProjection } from './current-roster.js';
import { requireAdmin } from './middleware.js';

const PREFIX = 'historical-bids/v1/';
async function archiveHash(archive: HistoricalBid) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(archive)),
  );
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
router.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  await next();
});

router.get('/', async (c) => {
  const years: number[] = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.R2_EXPORTS.list({ prefix: PREFIX, ...(cursor ? { cursor } : {}) });
    for (const object of page.objects) {
      const match = /^historical-bids\/v1\/(\d{4})\.json$/.exec(object.key);
      if (match) years.push(Number(match[1]));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return c.json({ years: years.sort((a, b) => b - a) });
});

router.get('/:year', async (c) => {
  const year = c.req.param('year');
  if (!/^\d{4}$/.test(year)) return c.json({ error: 'invalid_historical_year' }, 400);
  const object = await c.env.R2_EXPORTS.get(`${PREFIX}${year}.json`);
  if (!object) return c.json({ error: 'historical_bid_not_found' }, 404);
  const receipt = HistoricalBidReceiptSchema.parse(await object.json());
  if (
    receipt.archive.year !== Number(year) ||
    (await archiveHash(receipt.archive)) !== receipt.sha256
  )
    return c.json({ error: 'historical_archive_integrity_failed' }, 409);
  return c.json(receipt);
});

router.get('/:year/days-supplement', async (c) => {
  const year = c.req.param('year');
  if (!/^\d{4}$/.test(year)) return c.json({ error: 'invalid_historical_year' }, 400);
  const object = await c.env.R2_EXPORTS.get(`${PREFIX}${year}.json`);
  if (!object) return c.json({ error: 'historical_bid_not_found' }, 404);
  const receipt = HistoricalBidReceiptSchema.parse(await object.json());
  const { archive } = receipt;
  if (archive.year !== Number(year) || (await archiveHash(archive)) !== receipt.sha256)
    return c.json({ error: 'historical_archive_integrity_failed' }, 409);
  const awards = archive.seats.filter((seat) => seat.shift !== 'D' && seat.status === 'AWARDED');
  // Exclusion is documentary employee-ID comparison only. Never create or repair identity links.
  if (awards.some((seat) => !seat.employeeReference))
    return c.json({ error: 'historical_employee_references_required_for_days_supplement' }, 409);
  const historicalEmployees = new Set(awards.map((seat) => seat.employeeReference?.employeeId));
  const asOf = operationalDate();
  const roster = await loadCurrentRosterProjection(c.env.DB, asOf, [{ name: 'shift', value: 'D' }]);
  if (!roster.ok) return c.json({ error: roster.error }, 409);
  const positions = roster.projection.positions
    .filter((position) => {
      if (position.reviewStatus !== 'approved' || position.temporaryContext.length > 0)
        return false;
      if (
        /light[ _-]?duty|special[ _-]?assignments?/i.test(
          [position.station, position.unit, position.division].join(' '),
        )
      )
        return false;
      if (
        position.member &&
        (!position.member.employeeId || historicalEmployees.has(position.member.employeeId))
      )
        return false;
      return true;
    })
    .map((position) => ({
      id: position.id,
      station: position.station,
      unit: position.unit,
      position: position.positionName,
      name: position.member
        ? [position.member.firstName, position.member.lastName].filter(Boolean).join(' ')
        : null,
      occupancy: position.occupancy,
    }));
  return c.json({
    asOf,
    positions,
    excludedPositions: roster.projection.positions.length - positions.length,
  });
});

// This route has no domain database writes, session creation, roster reconciliation,
// annual-plan mutation or identity matching. R2 conditional create prevents replacement.
router.post(
  '/',
  bodyLimit({
    maxSize: 1_048_576,
    onError: (c) => c.json({ error: 'historical_archive_too_large' }, 413),
  }),
  async (c) => {
    const parsed = HistoricalBidSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid_historical_archive', issues: parsed.error.issues }, 400);
    const archive = parsed.data;
    if (archive.year >= new Date().getUTCFullYear())
      return c.json({ error: 'historical_year_must_be_in_the_past' }, 409);
    const sha256 = await archiveHash(archive);
    const key = `${PREFIX}${archive.year}.json`;
    const existing = await c.env.R2_EXPORTS.get(key);
    if (existing) {
      const receipt = HistoricalBidReceiptSchema.parse(await existing.json());
      if (
        receipt.archive.year !== archive.year ||
        (await archiveHash(receipt.archive)) !== receipt.sha256
      )
        return c.json({ error: 'historical_archive_integrity_failed' }, 409);
      return receipt.sha256 === sha256
        ? c.json({
            year: archive.year,
            sha256,
            publishedAt: receipt.publishedAt,
            alreadyPublished: true,
          })
        : c.json({ error: 'historical_archive_is_immutable' }, 409);
    }
    const publishedAt = new Date().toISOString();
    const receipt = HistoricalBidReceiptSchema.parse({
      archive,
      sha256,
      publishedAt,
      publishedBy: String(c.get('claims').sub),
    });
    const saved = await c.env.R2_EXPORTS.put(key, JSON.stringify(receipt), {
      // The web build also typechecks this route with DOM Headers; production uses Worker Headers.
      onlyIf: new Headers({ 'If-None-Match': '*' }) as unknown as WorkerHeaders,
      httpMetadata: { contentType: 'application/json' },
    });
    if (!saved) return c.json({ error: 'historical_archive_already_published' }, 409);
    return c.json({ year: archive.year, sha256, publishedAt, alreadyPublished: false }, 201);
  },
);

export default router;
