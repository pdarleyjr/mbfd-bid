import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import { classifyCertificationReadiness } from '../../lib/certification-readiness.js';
import { operationalDate } from '../../lib/operational-date.js';
import {
  type LegacyCredentialBaseline,
  type QualificationLifecycleEvent,
  type QualificationLifecycleKind,
  deriveMemberQualificationProjection,
  isQualificationCalendarDate,
  normalizePersistedQualificationLifecycleEvent,
} from '../../lib/qualification-lifecycle.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type AdminEnv = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };

interface QualificationEventDbRow {
  id: string;
  member_id: number;
  credential_id: number | null;
  credential_name: string | null;
  specialty_code: string | null;
  specialty_terminal_status: 'EXPIRED' | 'REVOKED' | 'REMOVED' | null;
  kind: string;
  effective_on: string;
  expires_on: string | null;
  evidence_source: string;
  evidence_reference: string | null;
  reason: string;
  actor_subject: string;
  idempotency_key: string;
  before_state: string;
  after_state: string;
  created_at: number;
}

interface LegacyCredentialDbRow {
  member_id: number;
  credential_id: number;
  credential_name: string;
  start_date: string | null;
  expiration_date: string | null;
}

const CertificationKinds = new Set<QualificationLifecycleKind>([
  'CERTIFICATION_GAINED',
  'CERTIFICATION_EXPIRED',
  'CERTIFICATION_REVOKED',
]);
const SpecialtyKinds = new Set<QualificationLifecycleKind>([
  'SPECIALTY_QUALIFIED',
  'SPECIALTY_EXPIRED',
  'SPECIALTY_REVOKED',
  'SPECIALTY_REMOVED',
]);
const SpecialtyTerminalKinds = new Set<QualificationLifecycleKind>([
  'SPECIALTY_EXPIRED',
  'SPECIALTY_REVOKED',
  'SPECIALTY_REMOVED',
]);

const EventInputSchema = z
  .object({
    kind: z.enum([
      'CERTIFICATION_GAINED',
      'CERTIFICATION_EXPIRED',
      'CERTIFICATION_REVOKED',
      'SPECIALTY_QUALIFIED',
      'SPECIALTY_EXPIRED',
      'SPECIALTY_REVOKED',
      'SPECIALTY_REMOVED',
    ]),
    member_id: z.number().int().positive(),
    credential_id: z.number().int().positive().optional(),
    specialty_code: z.string().trim().min(1).max(128).optional(),
    effective_on: z.string(),
    expires_on: z.string().optional(),
    evidence_source: z.string().trim().min(1).max(128),
    evidence_reference: z.string().trim().min(1).max(512).optional(),
    reason: z.string().trim().min(4).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const certification = CertificationKinds.has(value.kind);
    if (certification && value.credential_id === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['credential_id'], message: 'required' });
    }
    if (certification && value.specialty_code !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['specialty_code'],
        message: 'not allowed',
      });
    }
    if (SpecialtyKinds.has(value.kind) && value.specialty_code === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['specialty_code'], message: 'required' });
    }
    if (SpecialtyKinds.has(value.kind) && value.credential_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credential_id'],
        message: 'not allowed',
      });
    }
  });

type EventInput = z.infer<typeof EventInputSchema>;

const ReviewBatchInputSchema = z
  .object({
    source_system: z.string().trim().min(1).max(128),
    source_reference: z.string().trim().min(1).max(512),
  })
  .strict();

const ReviewRowInputSchema = z
  .object({
    source_member_reference: z.string().trim().min(1).max(128),
    source_credential_reference: z.string().trim().min(1).max(256),
    source_status: z.enum(['active', 'expired', 'revoked']).default('active'),
    effective_on: z.string().optional(),
    expires_on: z.string().nullable().optional(),
    provenance: z.string().trim().min(1).max(2_000),
  })
  .strict();

const ReviewDecisionInputSchema = z
  .object({
    decision: z.enum(['accepted', 'rejected', 'needs_review']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const ReviewApplyInputSchema = z
  .object({ reason: z.string().trim().min(4).max(500).optional() })
  .strict();

const router = new Hono<AdminEnv>();
router.use('*', requireAdmin);

async function first<T>(
  db: D1Database,
  query: string,
  ...bindings: unknown[]
): Promise<T | undefined> {
  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all();
  return result.results[0] as T | undefined;
}

async function all<T>(db: D1Database, query: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await db
    .prepare(query)
    .bind(...bindings)
    .all();
  return result.results as T[];
}

function mapEvent(row: QualificationEventDbRow): QualificationLifecycleEvent | null {
  return normalizePersistedQualificationLifecycleEvent({
    id: row.id,
    memberId: row.member_id,
    credentialId: row.credential_id,
    credentialName: row.credential_name,
    specialtyCode: row.specialty_code,
    kind: row.kind,
    specialtyTerminalStatus: row.specialty_terminal_status,
    effectiveOn: row.effective_on,
    expiresOn: row.expires_on,
    evidenceSource: row.evidence_source,
    evidenceReference: row.evidence_reference,
    reason: row.reason,
    actorSubject: row.actor_subject,
    idempotencyKey: row.idempotency_key,
    beforeState: row.before_state,
    afterState: row.after_state,
    createdAt: row.created_at,
  });
}

function presentEvent(event: QualificationLifecycleEvent) {
  return {
    id: event.id,
    memberId: event.memberId,
    credentialId: event.credentialId,
    credentialName: event.credentialName,
    specialtyCode: event.specialtyCode,
    kind: event.kind,
    effectiveOn: event.effectiveOn,
    expiresOn: event.expiresOn,
    evidenceSource: event.evidenceSource,
    evidenceReference: event.evidenceReference,
    reason: event.reason,
    actorSubject: event.actorSubject,
    idempotencyKey: event.idempotencyKey,
    beforeState: JSON.parse(event.beforeState) as unknown,
    afterState: JSON.parse(event.afterState) as unknown,
    createdAt: new Date(event.createdAt).toISOString(),
  };
}

type LoadedEvents = { ok: true; events: QualificationLifecycleEvent[] } | { ok: false };

async function loadEvents(db: D1Database, memberId: number): Promise<LoadedEvents> {
  const rows = await all<QualificationEventDbRow>(
    db,
    `SELECT event.id, event.member_id, event.credential_id, credential.name AS credential_name,
            event.specialty_code, event.specialty_terminal_status, event.kind, event.effective_on, event.expires_on,
            event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
            event.idempotency_key, event.before_state, event.after_state, event.created_at
       FROM member_qualification_events event
       LEFT JOIN credentials credential ON credential.id = event.credential_id
      WHERE event.member_id = ?
      ORDER BY event.effective_on ASC, event.created_at ASC, event.id ASC`,
    memberId,
  );
  const events: QualificationLifecycleEvent[] = [];
  for (const row of rows) {
    const event = mapEvent(row);
    if (event === null) return { ok: false };
    events.push(event);
  }
  return { ok: true, events };
}

async function loadLegacyCredentials(
  db: D1Database,
  memberId: number,
): Promise<LegacyCredentialBaseline[]> {
  const rows = await all<LegacyCredentialDbRow>(
    db,
    `SELECT member_credential.member_id, member_credential.credential_id,
            credential.name AS credential_name, member_credential.start_date,
            member_credential.expiration_date
       FROM member_credentials member_credential
       JOIN credentials credential ON credential.id = member_credential.credential_id
      WHERE member_credential.member_id = ?`,
    memberId,
  );
  return rows.map((row) => ({
    memberId: row.member_id,
    credentialId: row.credential_id,
    credentialName: row.credential_name,
    startDate: row.start_date,
    expirationDate: row.expiration_date,
  }));
}

async function memberExists(db: D1Database, memberId: number): Promise<boolean> {
  return (
    (await first<{ id: number }>(db, 'SELECT id FROM members WHERE id = ?', memberId)) !== undefined
  );
}

function sameReceipt(
  event: QualificationLifecycleEvent,
  input: EventInput,
  actorSubject: string,
): boolean {
  return (
    event.kind === input.kind &&
    event.memberId === input.member_id &&
    event.credentialId === (input.credential_id ?? null) &&
    event.specialtyCode === (input.specialty_code ?? null) &&
    event.effectiveOn === input.effective_on &&
    event.expiresOn === (input.expires_on ?? null) &&
    event.evidenceSource === input.evidence_source &&
    event.evidenceReference === (input.evidence_reference ?? null) &&
    event.reason === input.reason &&
    event.actorSubject === actorSubject
  );
}

function afterStatus(
  kind: QualificationLifecycleKind,
): 'active' | 'expired' | 'revoked' | 'removed' {
  if (kind === 'CERTIFICATION_EXPIRED' || kind === 'SPECIALTY_EXPIRED') return 'expired';
  if (kind === 'CERTIFICATION_REVOKED' || kind === 'SPECIALTY_REVOKED') return 'revoked';
  if (kind === 'SPECIALTY_REMOVED') return 'removed';
  return 'active';
}

function specialtyTerminalStatus(
  kind: QualificationLifecycleKind,
): 'EXPIRED' | 'REVOKED' | 'REMOVED' | null {
  if (kind === 'SPECIALTY_EXPIRED') return 'EXPIRED';
  if (kind === 'SPECIALTY_REVOKED') return 'REVOKED';
  if (kind === 'SPECIALTY_REMOVED') return 'REMOVED';
  return null;
}

router.get('/members/:memberId{\\d+}', async (c) => {
  const memberId = Number(c.req.param('memberId'));
  const asOf = c.req.query('as_of') ?? operationalDate();
  if (!isQualificationCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
  if (!(await memberExists(c.env.DB, memberId))) return c.json({ error: 'member_not_found' }, 404);

  const [legacyCredentials, loadedEvents] = await Promise.all([
    loadLegacyCredentials(c.env.DB, memberId),
    loadEvents(c.env.DB, memberId),
  ]);
  if (!loadedEvents.ok) return c.json({ error: 'qualification_lifecycle_data_invalid' }, 409);
  const projection = deriveMemberQualificationProjection({
    memberId,
    asOf,
    legacyCredentials,
    events: loadedEvents.events,
  });
  return c.json({
    memberId,
    asOf,
    certifications: projection.certifications,
    specialties: projection.specialties,
    events: loadedEvents.events.map(presentEvent),
  });
});

/** Command-staff read model. This is deliberately projection-only: it creates no D1 state. */
router.get('/readiness', async (c) => {
  const asOf = c.req.query('as_of') ?? operationalDate();
  if (!isQualificationCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
  const rawDays = Number(c.req.query('expiring_soon_days') ?? '30');
  const expiringSoonDays =
    Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 365 ? rawDays : 30;
  const rows = await all<{
    member_id: number;
    first_name: string;
    last_name: string;
    rank: string;
    credential_name: string | null;
    specialty_code: string | null;
    specialty_terminal_status: string | null;
    kind: string;
    effective_on: string;
    expires_on: string | null;
    evidence_source: string | null;
    evidence_reference: string | null;
    created_at: number | null;
  }>(
    c.env.DB,
    `
    SELECT member_record.id AS member_id, member_record.first_name, member_record.last_name, member_record.rank,
           credential.name AS credential_name, event.specialty_code, event.specialty_terminal_status, event.kind, event.effective_on, event.expires_on,
           event.evidence_source, event.evidence_reference, event.created_at
      FROM member_qualification_events event
      JOIN members member_record ON member_record.id = event.member_id
      LEFT JOIN credentials credential ON credential.id = event.credential_id
     WHERE event.effective_on <= ?
     ORDER BY member_record.last_name, member_record.first_name, event.effective_on DESC, event.created_at DESC`,
    asOf,
  );
  return c.json(
    classifyCertificationReadiness({
      asOf,
      expiringSoonDays,
      annualEvaluationOn: null,
      rows: rows.map((row) => ({
        memberId: row.member_id,
        memberName: `${row.last_name}, ${row.first_name}`,
        rank: row.rank,
        credential: row.credential_name,
        specialty: row.specialty_code,
        status:
          row.specialty_terminal_status === 'EXPIRED' || row.kind === 'CERTIFICATION_EXPIRED'
            ? 'expired'
            : row.specialty_terminal_status === 'REVOKED' || row.kind === 'CERTIFICATION_REVOKED'
              ? 'revoked'
              : row.specialty_terminal_status === 'REMOVED'
                ? 'removed'
                : 'active',
        effectiveOn: row.effective_on,
        expiresOn: row.expires_on,
        evidenceSource: row.evidence_source,
        evidenceReference: row.evidence_reference,
        changedAt:
          row.created_at === null ? null : new Date(row.created_at).toISOString().slice(0, 10),
      })),
    }),
  );
});

router.get('/reviews/batches', async (c) => {
  const rows = await all<{
    id: string;
    source_system: string;
    source_reference: string;
    status: string;
    created_by_subject: string;
    created_at: number;
    total: number;
    needs_review: number;
    applied: number;
  }>(
    c.env.DB,
    `SELECT batch.id, batch.source_system, batch.source_reference, batch.status, batch.created_by_subject, batch.created_at,
    count(row.id) AS total, sum(CASE WHEN row.decision = 'needs_review' OR row.decision IS NULL THEN 1 ELSE 0 END) AS needs_review,
    sum(CASE WHEN row.applied_event_id IS NOT NULL THEN 1 ELSE 0 END) AS applied
    FROM qualification_review_batches batch LEFT JOIN qualification_review_rows row ON row.batch_id = batch.id
    GROUP BY batch.id ORDER BY batch.created_at DESC`,
  );
  return c.json({
    annualEligibility: 'PENDING_CONFIGURATION',
    batches: rows.map((row) => ({
      ...row,
      total: Number(row.total),
      needsReview: Number(row.needs_review),
      applied: Number(row.applied),
    })),
  });
});

/** A batch detail is deliberately exception-first.  Exact/rejected rows stay
 * available for audit, but normal operators do not have to inspect them before
 * resolving unknown or changed evidence. */
router.get('/reviews/batches/:batchId', async (c) => {
  const batch = await first<{
    id: string;
    source_system: string;
    source_reference: string;
    status: string;
    created_by_subject: string;
    created_at: number;
  }>(
    c.env.DB,
    'SELECT id,source_system,source_reference,status,created_by_subject,created_at FROM qualification_review_batches WHERE id = ?',
    c.req.param('batchId'),
  );
  if (batch === undefined) return c.json({ error: 'review_batch_not_found' }, 404);
  const requestedClassification = c.req.query('classification');
  const requestedDecision = c.req.query('decision');
  const rows = await all<{
    id: string;
    member_id: number | null;
    credential_id: number | null;
    source_member_reference: string;
    source_credential_reference: string;
    source_status: string;
    effective_on: string | null;
    expires_on: string | null;
    provenance: string;
    classification: string;
    decision: string | null;
    reviewed_by_subject: string | null;
    reviewed_at: number | null;
    applied_event_id: string | null;
    created_at: number;
  }>(
    c.env.DB,
    `SELECT id,member_id,credential_id,source_member_reference,source_credential_reference,source_status,
            effective_on,expires_on,provenance,classification,decision,reviewed_by_subject,reviewed_at,
            applied_event_id,created_at
       FROM qualification_review_rows
      WHERE batch_id = ?
        AND (? IS NULL OR classification = ?)
        AND (? IS NULL OR COALESCE(decision, 'undecided') = ?)
      ORDER BY CASE WHEN classification = 'EXACT_MATCH' THEN 1 ELSE 0 END, created_at ASC, id ASC`,
    batch.id,
    requestedClassification ?? null,
    requestedClassification ?? null,
    requestedDecision ?? null,
    requestedDecision ?? null,
  );
  return c.json({
    batch,
    annualEligibility: 'PENDING_CONFIGURATION',
    rows: rows.map((row) => ({
      ...row,
      memberId: row.member_id,
      credentialId: row.credential_id,
      sourceMemberReference: row.source_member_reference,
      sourceCredentialReference: row.source_credential_reference,
      sourceStatus: row.source_status,
      effectiveOn: row.effective_on,
      expiresOn: row.expires_on,
      reviewedBySubject: row.reviewed_by_subject,
      reviewedAt: row.reviewed_at,
      appliedEventId: row.applied_event_id,
    })),
  });
});

router.post('/reviews/batches', requireStepUpAuth(), async (c) => {
  const parsed = ReviewBatchInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (idempotencyKey === undefined || idempotencyKey.trim().length === 0)
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub ?? '');
  if (actor.length === 0) return c.json({ error: 'invalid_actor_subject' }, 400);
  const existing = await first<{ id: string }>(
    c.env.DB,
    'SELECT id FROM qualification_review_batches WHERE source_reference = ? AND created_by_subject = ?',
    parsed.data.source_reference,
    actor,
  );
  if (existing !== undefined) return c.json({ replayed: true, batchId: existing.id });
  const id = ulid();
  try {
    await c.env.DB.prepare(
      `INSERT INTO qualification_review_batches (id, source_system, source_reference, status, created_by_subject, created_at) VALUES (?, ?, ?, 'staged', ?, ?)`,
    )
      .bind(id, parsed.data.source_system, parsed.data.source_reference, actor, Date.now())
      .run();
  } catch {
    return c.json({ error: 'qualification_review_batch_not_created' }, 409);
  }
  return c.json({ replayed: false, batchId: id, annualEligibility: 'PENDING_CONFIGURATION' }, 201);
});

router.post('/reviews/batches/:batchId/rows', requireStepUpAuth(), async (c) => {
  const parsed = ReviewRowInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const raw = parsed.data;
  if (
    (raw.effective_on !== undefined && !isQualificationCalendarDate(raw.effective_on)) ||
    (raw.expires_on !== undefined &&
      raw.expires_on !== null &&
      !isQualificationCalendarDate(raw.expires_on)) ||
    (raw.effective_on !== undefined &&
      raw.expires_on !== null &&
      raw.expires_on !== undefined &&
      raw.expires_on < raw.effective_on)
  )
    return c.json({ error: 'invalid_qualification_dates' }, 422);
  const batch = await first<{ id: string }>(
    c.env.DB,
    "SELECT id FROM qualification_review_batches WHERE id = ? AND status = 'staged'",
    c.req.param('batchId'),
  );
  if (batch === undefined) return c.json({ error: 'review_batch_not_staged' }, 409);
  const [member, credential] = await Promise.all([
    first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM members WHERE employee_id = ?',
      raw.source_member_reference,
    ),
    first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM credentials WHERE name = ?',
      raw.source_credential_reference,
    ),
  ]);
  const key = c.req.header('Idempotency-Key');
  if (key === undefined || key.trim().length === 0)
    return c.json({ error: 'idempotency_key_required' }, 400);
  let classification =
    member === undefined
      ? 'UNKNOWN_MEMBER'
      : credential === undefined
        ? 'UNKNOWN_QUALIFICATION'
        : 'NEW_QUALIFICATION';
  if (member !== undefined && credential !== undefined) {
    const current = await first<{ start_date: string | null; expiration_date: string | null }>(
      c.env.DB,
      'SELECT start_date,expiration_date FROM member_credentials WHERE member_id = ? AND credential_id = ?',
      member.id,
      credential.id,
    );
    if (current !== undefined) {
      const sourceEffective = raw.effective_on ?? null;
      const sourceExpires = raw.expires_on ?? null;
      if (
        raw.source_status === 'active' &&
        current.start_date === sourceEffective &&
        current.expiration_date === sourceExpires
      ) {
        classification = 'EXACT_MATCH';
      } else if (
        current.start_date !== sourceEffective &&
        current.expiration_date !== sourceExpires
      ) {
        classification = 'MULTIPLE_FIELD_CHANGE';
      } else if (current.start_date !== sourceEffective) {
        classification = 'ISSUE_DATE_CHANGE';
      } else if (current.expiration_date !== sourceExpires) {
        classification = 'EXPIRATION_DATE_CHANGE';
      } else {
        classification = 'STATUS_CHANGE';
      }
    }
  }
  const id = ulid();
  try {
    await c.env.DB.prepare(
      'INSERT INTO qualification_review_rows (id,batch_id,member_id,credential_id,source_member_reference,source_credential_reference,source_status,effective_on,expires_on,provenance,classification,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        id,
        batch.id,
        member?.id ?? null,
        credential?.id ?? null,
        raw.source_member_reference,
        raw.source_credential_reference,
        raw.source_status,
        raw.effective_on ?? null,
        raw.expires_on ?? null,
        raw.provenance,
        classification,
        key,
        Date.now(),
      )
      .run();
  } catch {
    return c.json({ error: 'review_row_not_created' }, 409);
  }
  return c.json({ rowId: id, classification, annualEligibility: 'PENDING_CONFIGURATION' }, 201);
});

router.post('/reviews/rows/:rowId/decision', requireStepUpAuth(), async (c) => {
  const parsed = ReviewDecisionInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'invalid_decision', issues: parsed.error.issues }, 400);
  const raw = parsed.data;
  const actor = String(c.get('claims').sub ?? '');
  if (actor.length === 0) return c.json({ error: 'invalid_actor_subject' }, 400);
  const row = await first<{ id: string; classification: string; applied_event_id: string | null }>(
    c.env.DB,
    'SELECT id, classification, applied_event_id FROM qualification_review_rows WHERE id = ?',
    c.req.param('rowId'),
  );
  if (row === undefined) return c.json({ error: 'review_row_not_found' }, 404);
  if (row.applied_event_id !== null) return c.json({ error: 'review_row_already_applied' }, 409);
  if (
    (row.classification === 'UNKNOWN_MEMBER' || row.classification === 'UNKNOWN_QUALIFICATION') &&
    raw.decision === 'accepted'
  )
    return c.json({ error: 'unresolved_row_requires_needs_review' }, 422);
  await c.env.DB.prepare(
    'UPDATE qualification_review_rows SET decision = ?, reviewed_by_subject = ?, reviewed_at = ? WHERE id = ?',
  )
    .bind(raw.decision, actor, Date.now(), row.id)
    .run();
  return c.json({
    rowId: row.id,
    decision: raw.decision,
    annualEligibility: 'PENDING_CONFIGURATION',
  });
});

/**
 * Applies only an explicitly accepted, resolvable review row.  It writes the
 * canonical qualification ledger and links the immutable event back to the
 * source row in the same D1 batch.  It intentionally does not update the old
 * member_credentials projection or an annual Bid snapshot.
 */
router.post('/reviews/rows/:rowId/apply', requireStepUpAuth(), async (c) => {
  const parsed = ReviewApplyInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const idempotencyKey = c.req.header('Idempotency-Key');
  if (
    idempotencyKey === undefined ||
    idempotencyKey.trim().length === 0 ||
    idempotencyKey.length > 256
  )
    return c.json({ error: 'idempotency_key_required' }, 400);
  const actorSubject = String(c.get('claims').sub ?? '');
  if (actorSubject.length === 0 || actorSubject.length > 256)
    return c.json({ error: 'invalid_actor_subject' }, 400);
  const row = await first<{
    id: string;
    member_id: number | null;
    credential_id: number | null;
    source_status: 'active' | 'expired' | 'revoked';
    effective_on: string | null;
    expires_on: string | null;
    provenance: string;
    classification: string;
    decision: string | null;
    applied_event_id: string | null;
  }>(
    c.env.DB,
    `SELECT id,member_id,credential_id,source_status,effective_on,expires_on,provenance,
            classification,decision,applied_event_id
       FROM qualification_review_rows WHERE id = ?`,
    c.req.param('rowId'),
  );
  if (row === undefined) return c.json({ error: 'review_row_not_found' }, 404);
  if (row.applied_event_id !== null)
    return c.json({
      replayed: true,
      rowId: row.id,
      appliedEventId: row.applied_event_id,
      annualEligibility: 'PENDING_CONFIGURATION',
    });
  if (row.decision !== 'accepted') return c.json({ error: 'review_row_not_accepted' }, 422);
  if (row.member_id === null || row.credential_id === null || row.effective_on === null)
    return c.json({ error: 'review_row_not_resolvable' }, 422);
  if (
    !isQualificationCalendarDate(row.effective_on) ||
    (row.expires_on !== null && !isQualificationCalendarDate(row.expires_on))
  )
    return c.json({ error: 'review_row_invalid_dates' }, 422);
  const kind: QualificationLifecycleKind =
    row.source_status === 'active'
      ? 'CERTIFICATION_GAINED'
      : row.source_status === 'expired'
        ? 'CERTIFICATION_EXPIRED'
        : 'CERTIFICATION_REVOKED';
  if (kind === 'CERTIFICATION_EXPIRED' && row.expires_on !== row.effective_on)
    return c.json({ error: 'expired_source_requires_matching_effective_date' }, 422);
  if (kind === 'CERTIFICATION_REVOKED' && row.expires_on !== null)
    return c.json({ error: 'revoked_source_cannot_set_expiration' }, 422);
  const existing = await first<{ id: string }>(
    c.env.DB,
    'SELECT id FROM member_qualification_events WHERE idempotency_key = ?',
    idempotencyKey,
  );
  if (existing !== undefined) return c.json({ error: 'idempotency_key_reused' }, 409);
  const eventId = ulid();
  const now = Date.now();
  const beforeState = { v: 1, reviewRowId: row.id, classification: row.classification };
  const afterState = {
    v: 1,
    reviewRowId: row.id,
    memberId: row.member_id,
    credentialId: row.credential_id,
    kind,
    effectiveOn: row.effective_on,
    expiresOn: row.expires_on,
    annualEligibility: 'PENDING_CONFIGURATION',
  };
  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO member_qualification_events
          (id,member_id,credential_id,specialty_code,specialty_terminal_status,kind,effective_on,expires_on,
           evidence_source,evidence_reference,reason,actor_subject,idempotency_key,before_state,after_state,created_at)
         VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        eventId,
        row.member_id,
        row.credential_id,
        kind,
        row.effective_on,
        row.expires_on,
        'qualification_review',
        row.provenance,
        parsed.data.reason ?? `Applied review row ${row.id}`,
        actorSubject,
        idempotencyKey,
        JSON.stringify(beforeState),
        JSON.stringify(afterState),
        now,
      ),
      c.env.DB.prepare(
        'UPDATE qualification_review_rows SET applied_event_id = ? WHERE id = ? AND applied_event_id IS NULL',
      ).bind(eventId, row.id),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1)
      return c.json({ error: 'qualification_review_apply_rejected' }, 409);
  } catch {
    const race = await first<{ applied_event_id: string | null }>(
      c.env.DB,
      'SELECT applied_event_id FROM qualification_review_rows WHERE id = ?',
      row.id,
    );
    if (race?.applied_event_id !== null && race?.applied_event_id !== undefined)
      return c.json({
        replayed: true,
        rowId: row.id,
        appliedEventId: race.applied_event_id,
        annualEligibility: 'PENDING_CONFIGURATION',
      });
    return c.json({ error: 'qualification_review_apply_rejected' }, 409);
  }
  return c.json(
    {
      replayed: false,
      rowId: row.id,
      appliedEventId: eventId,
      annualEligibility: 'PENDING_CONFIGURATION',
    },
    201,
  );
});

router.post('/events', requireStepUpAuth(), async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = EventInputSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const input = parsed.data;
  if (!isQualificationCalendarDate(input.effective_on)) {
    return c.json({ error: 'invalid_effective_on' }, 422);
  }
  if (input.expires_on !== undefined && !isQualificationCalendarDate(input.expires_on)) {
    return c.json({ error: 'invalid_expires_on' }, 422);
  }
  if (input.expires_on !== undefined && input.expires_on < input.effective_on) {
    return c.json({ error: 'expires_before_effective_on' }, 422);
  }
  if (
    (input.kind === 'CERTIFICATION_EXPIRED' || input.kind === 'SPECIALTY_EXPIRED') &&
    input.expires_on !== input.effective_on
  ) {
    return c.json({ error: 'expiration_must_match_effective_on' }, 422);
  }
  if (
    (input.kind === 'CERTIFICATION_REVOKED' || input.kind === 'SPECIALTY_REVOKED') &&
    input.expires_on !== undefined
  ) {
    return c.json({ error: 'revocation_cannot_set_expiration' }, 422);
  }
  if (input.kind === 'SPECIALTY_REMOVED' && input.expires_on !== undefined) {
    return c.json({ error: 'removal_cannot_set_expiration' }, 422);
  }

  const idempotencyKey = c.req.header('Idempotency-Key');
  if (idempotencyKey === undefined || idempotencyKey.trim().length === 0) {
    return c.json({ error: 'idempotency_key_required' }, 400);
  }
  if (idempotencyKey !== idempotencyKey.trim() || idempotencyKey.length > 256) {
    return c.json({ error: 'invalid_idempotency_key' }, 400);
  }
  const actorSubject = String(c.get('claims').sub ?? '');
  if (actorSubject.length === 0 || actorSubject.length > 256) {
    return c.json({ error: 'invalid_actor_subject' }, 400);
  }

  const existing = await first<QualificationEventDbRow>(
    c.env.DB,
    `SELECT event.id, event.member_id, event.credential_id, credential.name AS credential_name,
            event.specialty_code, event.specialty_terminal_status, event.kind, event.effective_on, event.expires_on,
            event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
            event.idempotency_key, event.before_state, event.after_state, event.created_at
       FROM member_qualification_events event
       LEFT JOIN credentials credential ON credential.id = event.credential_id
      WHERE event.idempotency_key = ?`,
    idempotencyKey,
  );
  if (existing !== undefined) {
    const receipt = mapEvent(existing);
    if (receipt === null) return c.json({ error: 'qualification_lifecycle_data_invalid' }, 409);
    if (sameReceipt(receipt, input, actorSubject))
      return c.json({ replayed: true, event: presentEvent(receipt) });
    return c.json({ error: 'idempotency_key_reused' }, 409);
  }

  if (!(await memberExists(c.env.DB, input.member_id)))
    return c.json({ error: 'member_not_found' }, 404);
  if (input.credential_id !== undefined) {
    const credential = await first<{ id: number }>(
      c.env.DB,
      'SELECT id FROM credentials WHERE id = ?',
      input.credential_id,
    );
    if (credential === undefined) return c.json({ error: 'credential_not_found' }, 404);
  }

  const [legacyCredentials, loadedEvents] = await Promise.all([
    loadLegacyCredentials(c.env.DB, input.member_id),
    loadEvents(c.env.DB, input.member_id),
  ]);
  if (!loadedEvents.ok) return c.json({ error: 'qualification_lifecycle_data_invalid' }, 409);
  const beforeProjection = deriveMemberQualificationProjection({
    memberId: input.member_id,
    asOf: input.effective_on,
    legacyCredentials,
    events: loadedEvents.events,
  });
  const beforeQualification =
    input.credential_id === undefined
      ? (beforeProjection.specialties.find(
          (specialty) => specialty.specialtyCode === input.specialty_code,
        ) ?? null)
      : (beforeProjection.certifications.find(
          (credential) => credential.credentialId === input.credential_id,
        ) ?? null);

  const certificationTerminal =
    input.kind === 'CERTIFICATION_EXPIRED' || input.kind === 'CERTIFICATION_REVOKED';
  const specialtyTerminal = SpecialtyTerminalKinds.has(input.kind);
  if (certificationTerminal && beforeQualification?.status !== 'active') {
    return c.json({ error: 'credential_not_active_at_effective_on' }, 422);
  }
  if (specialtyTerminal && beforeQualification?.status !== 'active') {
    return c.json({ error: 'specialty_not_active_at_effective_on' }, 422);
  }

  const eventId = ulid();
  const now = Date.now();
  const beforeState = {
    v: 1,
    memberId: input.member_id,
    qualification: beforeQualification,
  };
  const afterState = {
    v: 1,
    memberId: input.member_id,
    credentialId: input.credential_id ?? null,
    specialtyCode: input.specialty_code ?? null,
    kind: input.kind,
    status: afterStatus(input.kind),
    effectiveOn: input.effective_on,
    expiresOn: input.expires_on ?? null,
    evidenceSource: input.evidence_source,
    evidenceReference: input.evidence_reference ?? null,
  };
  const targetKind = input.credential_id === undefined ? 'specialty' : 'credential';
  const targetId =
    input.credential_id === undefined
      ? `${input.member_id}:${input.specialty_code}`
      : `${input.member_id}:${input.credential_id}`;
  const actorId = c.get('claims').member_id;
  const terminalStatus = specialtyTerminalStatus(input.kind);
  const persistedKind = terminalStatus === null ? input.kind : 'SPECIALTY_QUALIFIED';

  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO member_qualification_events
            (id, member_id, credential_id, specialty_code, specialty_terminal_status, kind, effective_on, expires_on,
             evidence_source, evidence_reference, reason, actor_subject, idempotency_key,
             before_state, after_state, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        eventId,
        input.member_id,
        input.credential_id ?? null,
        input.specialty_code ?? null,
        terminalStatus,
        persistedKind,
        input.effective_on,
        input.expires_on ?? null,
        input.evidence_source,
        input.evidence_reference ?? null,
        input.reason,
        actorSubject,
        idempotencyKey,
        JSON.stringify(beforeState),
        JSON.stringify(afterState),
        now,
      ),
      c.env.DB.prepare(
        `INSERT INTO audit_log
           (id, bid_session_id, seq, actor_type, actor_id, action, target_kind, target_id,
            before_state, after_state, reason, ai_advisory_id, client_meta, created_at)
         SELECT ?, NULL, COALESCE(MAX(seq), 0) + 1, 'admin', ?, 'qualification_lifecycle', ?, ?,
                ?, ?, ?, NULL, ?, ?
           FROM audit_log WHERE bid_session_id IS NULL`,
      ).bind(
        ulid(),
        actorId,
        targetKind,
        targetId,
        JSON.stringify(beforeState),
        JSON.stringify(afterState),
        input.reason,
        JSON.stringify({ v: 1, qualification_event_id: eventId, effective_on: input.effective_on }),
        Math.floor(now / 1_000),
      ),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return c.json({ error: 'qualification_write_rejected' }, 409);
    }
  } catch {
    const raced = await first<QualificationEventDbRow>(
      c.env.DB,
      `SELECT event.id, event.member_id, event.credential_id, credential.name AS credential_name,
              event.specialty_code, event.specialty_terminal_status, event.kind, event.effective_on, event.expires_on,
              event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
              event.idempotency_key, event.before_state, event.after_state, event.created_at
         FROM member_qualification_events event
         LEFT JOIN credentials credential ON credential.id = event.credential_id
        WHERE event.idempotency_key = ?`,
      idempotencyKey,
    );
    if (raced !== undefined) {
      const receipt = mapEvent(raced);
      if (receipt === null) return c.json({ error: 'qualification_lifecycle_data_invalid' }, 409);
      if (sameReceipt(receipt, input, actorSubject)) {
        return c.json({ replayed: true, event: presentEvent(receipt) });
      }
    }
    return c.json({ error: 'qualification_write_rejected' }, 409);
  }

  const saved = await first<QualificationEventDbRow>(
    c.env.DB,
    `SELECT event.id, event.member_id, event.credential_id, credential.name AS credential_name,
            event.specialty_code, event.specialty_terminal_status, event.kind, event.effective_on, event.expires_on,
            event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
            event.idempotency_key, event.before_state, event.after_state, event.created_at
       FROM member_qualification_events event
       LEFT JOIN credentials credential ON credential.id = event.credential_id
      WHERE event.id = ?`,
    eventId,
  );
  if (saved === undefined) return c.json({ error: 'qualification_write_rejected' }, 409);
  const event = mapEvent(saved);
  if (event === null) return c.json({ error: 'qualification_lifecycle_data_invalid' }, 409);
  return c.json({ replayed: false, event: presentEvent(event) }, 201);
});

export default router;
