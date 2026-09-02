import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import { loadCanonicalBidSessionState } from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import { projectCanonicalAnnualCompletion } from '../../lib/annual-completion-result.js';
import { loadFrozenSessionBidPolicy } from '../../lib/bid-policy.js';
import { createCsvStream } from '../../lib/csv-stream.js';
import {
  type FutureRosterObservation,
  evaluateFinalization,
  evaluateLeadTime,
  reconcileFutureRoster,
} from '../../lib/post-bid-transition.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin, requireLiveBidAction } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };
const router = new Hono<AdminEnv>();
router.use('*', requireAdmin);

const policySchema = z
  .object({
    policy_version: z.string().trim().min(1).max(200),
    lead_time: z
      .object({
        mode: z.enum(['HARD_MINIMUM', 'TARGET', 'WARNING_ONLY']),
        days: z.number().int().min(0).max(366),
      })
      .strict(),
    publication_gates: z
      .array(z.enum(['APPROVED', 'PACKAGE_GENERATED', 'RECONCILED']))
      .min(1)
      .max(3),
  })
  .strict();
const reviewSchema = z
  .object({ policy: policySchema, reason: z.string().trim().min(4).max(500) })
  .strict();
const approveSchema = z
  .object({ effective_on: z.string(), reason: z.string().trim().min(4).max(500) })
  .strict();
const reconcileSchema = z
  .object({
    observed: z
      .array(
        z
          .object({
            memberId: z.number().int().positive(),
            shift: z.string().nullable(),
            station: z.string().nullable(),
            unit: z.string().nullable(),
            position: z.string().nullable(),
            aDay: z.string().nullable(),
          })
          .strict(),
      )
      .max(2_000),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
const reasonSchema = z.object({ reason: z.string().trim().min(4).max(500) }).strict();

interface TransitionRow {
  status: string;
  policy_json: string;
  effective_on: string | null;
  future_roster_json: string;
  reconciliation_json: string | null;
}
interface CanonicalStateMetadataRow {
  current_seq: number;
  last_command_id: string | null;
}
interface CompletionReceiptRow {
  command_type: string;
  outcome: string;
  result_seq: number;
}
interface AmendmentRow {
  original_bid_id: string;
  replacement_bid_id: string;
}

function idempotency(c: { req: { header(name: string): string | undefined } }) {
  const key = c.req.header('Idempotency-Key');
  return key !== undefined && key === key.trim() && key.length > 0 && key.length <= 256
    ? key
    : null;
}
function actor(c: { get(key: 'claims'): JwtPayload }): number | null {
  const value = c.get('claims').sub;
  return Number.isInteger(value) && value > 0 ? value : null;
}
function opaque(value: string): boolean {
  return value.trim() === value && value.length > 0 && value.length <= 256;
}
function parse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function receipt(db: D1Database, key: string): Promise<Record<string, unknown> | null> {
  const result = await db
    .prepare('SELECT response_json FROM bid_post_bid_operation_receipts WHERE idempotency_key = ?')
    .bind(key)
    .first<{ response_json: string }>();
  return result === null ? null : parse<Record<string, unknown>>(result.response_json);
}
async function transition(db: D1Database, sessionId: string): Promise<TransitionRow | null> {
  return db
    .prepare(
      'SELECT status, policy_json, effective_on, future_roster_json, reconciliation_json FROM bid_post_bid_transitions WHERE bid_session_id = ?',
    )
    .bind(sessionId)
    .first<TransitionRow>();
}
async function roster(
  db: D1Database,
  sessionId: string,
): Promise<
  | { ok: true; rows: FutureRosterObservation[]; completionAt: number; year: number }
  | { ok: false; error: string }
> {
  const session = await db
    .prepare('SELECT bid_year, is_mock FROM bid_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ bid_year: number; is_mock: number }>();
  if (session === null) return { ok: false, error: 'session_not_found' };
  if (session.is_mock !== 0) return { ok: false, error: 'mock_session_not_transitionable' };
  const canonical = await loadCanonicalBidSessionState(db, sessionId);
  if (canonical === null) return { ok: false, error: 'annual_completion_required' };
  const frozen = await loadFrozenSessionBidPolicy(getDb(db), sessionId);
  if (!frozen.ok || frozen.snapshot.settings.v !== 3)
    return { ok: false, error: 'frozen_policy_required' };
  const metadata = await db
    .prepare(
      'SELECT current_seq, last_command_id FROM canonical_bid_session_state WHERE bid_session_id = ?',
    )
    .bind(sessionId)
    .first<CanonicalStateMetadataRow>();
  if (metadata === null || metadata.last_command_id === null)
    return { ok: false, error: 'annual_completion_receipt_required' };
  const receipt = await db
    .prepare(
      'SELECT command_type, outcome, result_seq FROM bid_command_receipts WHERE command_id = ? AND bid_session_id = ?',
    )
    .bind(metadata.last_command_id, sessionId)
    .first<CompletionReceiptRow>();
  if (
    receipt === null ||
    receipt.command_type !== 'live.complete_session' ||
    receipt.outcome !== 'accepted' ||
    receipt.result_seq !== metadata.current_seq
  )
    return { ok: false, error: 'annual_completion_receipt_required' };
  const amendments = (
    await db
      .prepare(
        'SELECT original_bid_id, replacement_bid_id FROM bid_award_amendments WHERE bid_session_id = ? ORDER BY created_at, id',
      )
      .bind(sessionId)
      .all()
  ).results as unknown as AmendmentRow[];
  const projected = projectCanonicalAnnualCompletion({
    session: { id: sessionId, mode: 'REAL', bidYear: session.bid_year },
    completion: {
      commandId: metadata.last_command_id,
      revision: metadata.current_seq,
      completedAtMs: canonical.annual?.completion?.readyForFinalizationAtMs ?? 0,
      receiptIntegrity: 'VERIFIED',
    },
    frozen: {
      ruleBookVersion: frozen.snapshot.ruleBookVersion,
      topologyReference: frozen.snapshot.positionTemplateVersion,
      staffingReference: frozen.snapshot.staffingBaseline?.baselineAcceptanceId ?? null,
      members: frozen.snapshot.members.map((member) => ({
        memberId: member.memberId,
        rank: member.rank,
      })),
      positions: frozen.snapshot.ruleBookMaterial.positions.map((position) => ({
        id: position.id,
        shift: position.shift,
        station: position.station,
        unit: position.unit,
        position: position.positionName,
        specialty: null,
      })),
    },
    state: canonical,
    amendmentLinks: amendments.map((amendment) => ({
      originalBidId: amendment.original_bid_id,
      replacementBidId: amendment.replacement_bid_id,
    })),
  });
  if (!projected.ok) return { ok: false, error: projected.code };
  const finalization = evaluateFinalization({
    annualCompletionAtMs: projected.value.completion.completedAtMs,
    expectedPositionIds: frozen.coverage.validRulePositionIds,
    awards: projected.value.participants.map((participant) => ({
      memberId: participant.memberId,
      positionId: participant.positionId,
    })),
    unresolvedMemberIds: projected.value.unresolvedMemberIds,
    topologyReference: projected.value.frozen.topologyReference,
    ruleBookVersion: projected.value.frozen.ruleBookVersion,
  });
  if (!finalization.ok) return { ok: false, error: finalization.blockingCodes.join(',') };
  return {
    ok: true,
    rows: [...projected.value.futureRoster],
    completionAt: projected.value.completion.completedAtMs,
    year: session.bid_year,
  };
}

function audit(
  db: D1Database,
  sessionId: string,
  actorId: number,
  action: string,
  reason: string,
  after: unknown,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit_log (id,bid_session_id,seq,actor_type,actor_id,action,target_kind,target_id,before_state,after_state,reason,client_meta,created_at) SELECT ?,?,COALESCE(MAX(seq),0)+1,'admin',? ,?,'post_bid_transition',?,NULL,?,?,?,? FROM audit_log WHERE bid_session_id = ?",
    )
    .bind(
      ulid(),
      sessionId,
      actorId,
      action,
      sessionId,
      JSON.stringify(after),
      reason,
      JSON.stringify({ v: 1, operation: action }),
      Math.floor(now / 1000),
      sessionId,
    );
}
function receiptStatement(
  db: D1Database,
  key: string,
  sessionId: string,
  operation: string,
  request: unknown,
  response: unknown,
  actorId: number,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO bid_post_bid_operation_receipts (idempotency_key,bid_session_id,operation,request_json,response_json,actor_member_id,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(
      key,
      sessionId,
      operation,
      JSON.stringify(request),
      JSON.stringify(response),
      actorId,
      now,
    );
}

router.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!opaque(id)) return c.json({ error: 'invalid_session_id' }, 400);
  const row = await transition(c.env.DB, id);
  return row === null
    ? c.json({ error: 'not_found' }, 404)
    : c.json({
        transition: {
          ...row,
          policy: parse(row.policy_json),
          futureRoster: parse(row.future_roster_json),
          reconciliation: row.reconciliation_json === null ? null : parse(row.reconciliation_json),
        },
      });
});

router.post(
  '/:id/review',
  requireStepUpAuth(),
  requireLiveBidAction('approve_transition'),
  async (c) => {
    const sessionId = c.req.param('id');
    const key = idempotency(c);
    const actorId = actor(c);
    const body = reviewSchema.safeParse(await c.req.json().catch(() => null));
    if (!opaque(sessionId) || key === null || actorId === null || !body.success)
      return c.json({ error: 'invalid_request' }, 400);
    const prior = await receipt(c.env.DB, key);
    if (prior !== null) return c.json({ ...prior, replayed: true });
    const loaded = await roster(c.env.DB, sessionId);
    if (!loaded.ok) return c.json({ error: loaded.error }, 409);
    const now = Date.now();
    const response = {
      replayed: false,
      status: 'REVIEWED',
      futureRosterCount: loaded.rows.length,
      annualCompletionAt: loaded.completionAt,
    };
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO bid_post_bid_transitions (bid_session_id,bid_year,status,policy_version,policy_json,annual_completion_at,reviewed_at,reviewed_by_member_id,future_roster_json,updated_at) VALUES (?,?, 'REVIEWED',?,?,?,?,?,?,?)",
        ).bind(
          sessionId,
          loaded.year,
          body.data.policy.policy_version,
          JSON.stringify(body.data.policy),
          loaded.completionAt,
          now,
          actorId,
          JSON.stringify(loaded.rows),
          now,
        ),
        receiptStatement(
          c.env.DB,
          key,
          sessionId,
          'FINALIZATION_REVIEW',
          body.data,
          response,
          actorId,
          now,
        ),
        audit(
          c.env.DB,
          sessionId,
          actorId,
          'post_bid_finalization_review',
          body.data.reason,
          response,
          now,
        ),
      ]);
    } catch {
      return c.json({ error: 'finalization_review_not_applied' }, 409);
    }
    return c.json(response, 201);
  },
);

router.post(
  '/:id/approve',
  requireStepUpAuth(),
  requireLiveBidAction('approve_transition'),
  async (c) => {
    const sessionId = c.req.param('id');
    const key = idempotency(c);
    const actorId = actor(c);
    const body = approveSchema.safeParse(await c.req.json().catch(() => null));
    if (!opaque(sessionId) || key === null || actorId === null || !body.success)
      return c.json({ error: 'invalid_request' }, 400);
    const prior = await receipt(c.env.DB, key);
    if (prior !== null) return c.json({ ...prior, replayed: true });
    const row = await transition(c.env.DB, sessionId);
    if (row === null || row.status !== 'REVIEWED')
      return c.json({ error: 'finalization_review_required' }, 409);
    const policy = parse<{
      lead_time: { mode: 'HARD_MINIMUM' | 'TARGET' | 'WARNING_ONLY'; days: number };
    }>(row.policy_json);
    const loaded = await roster(c.env.DB, sessionId);
    if (!loaded.ok || policy === null)
      return c.json({ error: loaded.ok ? 'transition_policy_missing' : loaded.error }, 409);
    const lead = evaluateLeadTime({
      completionOn: new Date(loaded.completionAt).toISOString().slice(0, 10),
      effectiveOn: body.data.effective_on,
      policy: policy.lead_time,
    });
    if (!lead.ok) return c.json({ error: lead.code }, 409);
    const now = Date.now();
    const response = {
      replayed: false,
      status: 'APPROVED',
      effectiveOn: body.data.effective_on,
      ...(lead.warning === undefined ? {} : { warning: lead.warning }),
    };
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE bid_post_bid_transitions SET status='APPROVED',approved_at=?,approved_by_member_id=?,effective_on=?,updated_at=? WHERE bid_session_id=? AND status='REVIEWED'",
        ).bind(now, actorId, body.data.effective_on, now, sessionId),
        receiptStatement(c.env.DB, key, sessionId, 'APPROVE', body.data, response, actorId, now),
        audit(c.env.DB, sessionId, actorId, 'post_bid_approved', body.data.reason, response, now),
      ]);
    } catch {
      return c.json({ error: 'approval_not_applied' }, 409);
    }
    return c.json(response, 201);
  },
);

router.get('/:id/telestaff-package.csv', async (c) => {
  const sessionId = c.req.param('id');
  if (!opaque(sessionId)) return c.json({ error: 'invalid_session_id' }, 400);
  const row = await transition(c.env.DB, sessionId);
  if (
    row === null ||
    !['APPROVED', 'PACKAGE_GENERATED', 'RECONCILED', 'PUBLISHED'].includes(row.status)
  )
    return c.json({ error: 'approval_required' }, 409);
  const rows = parse<FutureRosterObservation[]>(row.future_roster_json);
  if (rows === null) return c.json({ error: 'future_roster_invalid' }, 409);
  const safeRows = rows;
  async function* source() {
    for (const item of safeRows) yield item;
  }
  return new Response(
    createCsvStream(source(), [
      { header: 'member_id', value: (r) => r.memberId },
      { header: 'new_shift', value: (r) => r.shift },
      { header: 'new_station', value: (r) => r.station },
      { header: 'new_unit', value: (r) => r.unit },
      { header: 'new_position', value: (r) => r.position },
      { header: 'new_a_day', value: (r) => r.aDay },
      { header: 'effective_date', value: () => row.effective_on },
      { header: 'source_annual_session', value: () => sessionId },
      { header: 'validation_status', value: () => 'APPROVED' },
    ]),
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mbfd-telestaff-package-${sessionId}.csv"`,
        'Cache-Control': 'no-store',
      },
    },
  );
});

router.post(
  '/:id/package',
  requireStepUpAuth(),
  requireLiveBidAction('approve_transition'),
  async (c) => {
    const sessionId = c.req.param('id');
    const key = idempotency(c);
    const actorId = actor(c);
    const body = reasonSchema.safeParse(await c.req.json().catch(() => null));
    if (!opaque(sessionId) || key === null || actorId === null || !body.success)
      return c.json({ error: 'invalid_request' }, 400);
    const prior = await receipt(c.env.DB, key);
    if (prior !== null) return c.json({ ...prior, replayed: true });
    const row = await transition(c.env.DB, sessionId);
    if (row === null || row.status !== 'APPROVED')
      return c.json({ error: 'approval_required' }, 409);
    const now = Date.now();
    const response = {
      replayed: false,
      status: 'PACKAGE_GENERATED',
      export: 'telestaff-package.csv',
      writeback: 'not_supported_or_enabled',
    };
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE bid_post_bid_transitions SET status='PACKAGE_GENERATED',package_generated_at=?,updated_at=? WHERE bid_session_id=? AND status='APPROVED'",
        ).bind(now, now, sessionId),
        receiptStatement(c.env.DB, key, sessionId, 'PACKAGE', body.data, response, actorId, now),
        audit(
          c.env.DB,
          sessionId,
          actorId,
          'post_bid_package_generated',
          body.data.reason,
          response,
          now,
        ),
      ]);
    } catch {
      return c.json({ error: 'package_not_applied' }, 409);
    }
    return c.json(response, 201);
  },
);

router.post(
  '/:id/reconcile',
  requireStepUpAuth(),
  requireLiveBidAction('approve_final_results'),
  async (c) => {
    const sessionId = c.req.param('id');
    const key = idempotency(c);
    const actorId = actor(c);
    const body = reconcileSchema.safeParse(await c.req.json().catch(() => null));
    if (!opaque(sessionId) || key === null || actorId === null || !body.success)
      return c.json({ error: 'invalid_request' }, 400);
    const prior = await receipt(c.env.DB, key);
    if (prior !== null) return c.json({ ...prior, replayed: true });
    const row = await transition(c.env.DB, sessionId);
    const expected = row === null ? null : parse<FutureRosterObservation[]>(row.future_roster_json);
    if (
      row === null ||
      expected === null ||
      !['APPROVED', 'PACKAGE_GENERATED'].includes(row.status)
    )
      return c.json({ error: 'package_or_approval_required' }, 409);
    const findings = reconcileFutureRoster(expected, body.data.observed);
    const now = Date.now();
    const response = { replayed: false, status: 'RECONCILED', findings };
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE bid_post_bid_transitions SET status='RECONCILED',reconciliation_json=?,reconciled_at=?,reconciled_by_member_id=?,updated_at=? WHERE bid_session_id=? AND status IN ('APPROVED','PACKAGE_GENERATED')",
        ).bind(JSON.stringify(findings), now, actorId, now, sessionId),
        receiptStatement(c.env.DB, key, sessionId, 'RECONCILE', body.data, response, actorId, now),
        audit(c.env.DB, sessionId, actorId, 'post_bid_reconciled', body.data.reason, response, now),
      ]);
    } catch {
      return c.json({ error: 'reconciliation_not_applied' }, 409);
    }
    return c.json(response, 201);
  },
);

router.post('/:id/publish', requireStepUpAuth(), requireLiveBidAction('publish'), async (c) => {
  const sessionId = c.req.param('id');
  const key = idempotency(c);
  const actorId = actor(c);
  const body = reasonSchema.safeParse(await c.req.json().catch(() => null));
  if (!opaque(sessionId) || key === null || actorId === null || !body.success)
    return c.json({ error: 'invalid_request' }, 400);
  const prior = await receipt(c.env.DB, key);
  if (prior !== null) return c.json({ ...prior, replayed: true });
  const row = await transition(c.env.DB, sessionId);
  const policy = row === null ? null : parse<{ publication_gates: string[] }>(row.policy_json);
  if (row === null || policy === null) return c.json({ error: 'transition_policy_missing' }, 409);
  const gates = new Set(policy.publication_gates);
  if (
    (gates.has('APPROVED') &&
      !['APPROVED', 'PACKAGE_GENERATED', 'RECONCILED'].includes(row.status)) ||
    (gates.has('PACKAGE_GENERATED') && !['PACKAGE_GENERATED', 'RECONCILED'].includes(row.status)) ||
    (gates.has('RECONCILED') && row.status !== 'RECONCILED')
  )
    return c.json({ error: 'publication_gate_not_satisfied' }, 409);
  const now = Date.now();
  const response = { replayed: false, status: 'PUBLISHED', publishedAt: now };
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE bid_post_bid_transitions SET status='PUBLISHED',published_at=?,published_by_member_id=?,updated_at=? WHERE bid_session_id=? AND status <> 'PUBLISHED'",
      ).bind(now, actorId, now, sessionId),
      receiptStatement(c.env.DB, key, sessionId, 'PUBLISH', body.data, response, actorId, now),
      audit(c.env.DB, sessionId, actorId, 'post_bid_published', body.data.reason, response, now),
    ]);
  } catch {
    return c.json({ error: 'publication_not_applied' }, 409);
  }
  return c.json(response, 201);
});

export default router;
