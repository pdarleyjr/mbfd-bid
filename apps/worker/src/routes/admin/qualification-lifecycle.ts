import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';

import {
  type LegacyCredentialBaseline,
  type QualificationLifecycleEvent,
  type QualificationLifecycleKind,
  deriveMemberQualificationProjection,
  isQualificationCalendarDate,
  isQualificationLifecycleKind,
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

const EventInputSchema = z
  .object({
    kind: z.enum([
      'CERTIFICATION_GAINED',
      'CERTIFICATION_EXPIRED',
      'CERTIFICATION_REVOKED',
      'SPECIALTY_QUALIFIED',
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
    if (value.kind === 'SPECIALTY_QUALIFIED' && value.specialty_code === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['specialty_code'], message: 'required' });
    }
    if (value.kind === 'SPECIALTY_QUALIFIED' && value.credential_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['credential_id'],
        message: 'not allowed',
      });
    }
  });

type EventInput = z.infer<typeof EventInputSchema>;

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

function mapEvent(row: QualificationEventDbRow): QualificationLifecycleEvent {
  return {
    id: row.id,
    memberId: row.member_id,
    credentialId: row.credential_id,
    credentialName: row.credential_name,
    specialtyCode: row.specialty_code,
    kind: row.kind as QualificationLifecycleKind,
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
  };
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

async function loadEvents(
  db: D1Database,
  memberId: number,
): Promise<QualificationLifecycleEvent[]> {
  const rows = await all<QualificationEventDbRow>(
    db,
    `SELECT event.id, event.member_id, event.credential_id, credential.name AS credential_name,
            event.specialty_code, event.kind, event.effective_on, event.expires_on,
            event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
            event.idempotency_key, event.before_state, event.after_state, event.created_at
       FROM member_qualification_events event
       LEFT JOIN credentials credential ON credential.id = event.credential_id
      WHERE event.member_id = ?
      ORDER BY event.effective_on ASC, event.created_at ASC, event.id ASC`,
    memberId,
  );
  return rows.filter((row) => isQualificationLifecycleKind(row.kind)).map(mapEvent);
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

function afterStatus(kind: QualificationLifecycleKind): 'active' | 'expired' | 'revoked' {
  if (kind === 'CERTIFICATION_EXPIRED') return 'expired';
  if (kind === 'CERTIFICATION_REVOKED') return 'revoked';
  return 'active';
}

router.get('/members/:memberId{\\d+}', async (c) => {
  const memberId = Number(c.req.param('memberId'));
  const asOf = c.req.query('as_of') ?? new Date().toISOString().slice(0, 10);
  if (!isQualificationCalendarDate(asOf)) return c.json({ error: 'invalid_as_of' }, 400);
  if (!(await memberExists(c.env.DB, memberId))) return c.json({ error: 'member_not_found' }, 404);

  const [legacyCredentials, events] = await Promise.all([
    loadLegacyCredentials(c.env.DB, memberId),
    loadEvents(c.env.DB, memberId),
  ]);
  const projection = deriveMemberQualificationProjection({
    memberId,
    asOf,
    legacyCredentials,
    events,
  });
  return c.json({
    memberId,
    asOf,
    certifications: projection.certifications,
    specialties: projection.specialties,
    events: events.map(presentEvent),
  });
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
  if (input.kind === 'CERTIFICATION_EXPIRED' && input.expires_on !== input.effective_on) {
    return c.json({ error: 'expiration_must_match_effective_on' }, 422);
  }
  if (input.kind === 'CERTIFICATION_REVOKED' && input.expires_on !== undefined) {
    return c.json({ error: 'revocation_cannot_set_expiration' }, 422);
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
            event.specialty_code, event.kind, event.effective_on, event.expires_on,
            event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
            event.idempotency_key, event.before_state, event.after_state, event.created_at
       FROM member_qualification_events event
       LEFT JOIN credentials credential ON credential.id = event.credential_id
      WHERE event.idempotency_key = ?`,
    idempotencyKey,
  );
  if (existing !== undefined) {
    const receipt = mapEvent(existing);
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

  const [legacyCredentials, events] = await Promise.all([
    loadLegacyCredentials(c.env.DB, input.member_id),
    loadEvents(c.env.DB, input.member_id),
  ]);
  const beforeProjection = deriveMemberQualificationProjection({
    memberId: input.member_id,
    asOf: input.effective_on,
    legacyCredentials,
    events,
  });
  const beforeQualification =
    input.credential_id === undefined
      ? (beforeProjection.specialties.find(
          (specialty) => specialty.specialtyCode === input.specialty_code,
        ) ?? null)
      : (beforeProjection.certifications.find(
          (credential) => credential.credentialId === input.credential_id,
        ) ?? null);

  if (
    (input.kind === 'CERTIFICATION_EXPIRED' || input.kind === 'CERTIFICATION_REVOKED') &&
    beforeQualification?.status !== 'active'
  ) {
    return c.json({ error: 'credential_not_active_at_effective_on' }, 422);
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
  const actorId = typeof c.get('claims').sub === 'number' ? c.get('claims').sub : null;

  try {
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO member_qualification_events
           (id, member_id, credential_id, specialty_code, kind, effective_on, expires_on,
            evidence_source, evidence_reference, reason, actor_subject, idempotency_key,
            before_state, after_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        eventId,
        input.member_id,
        input.credential_id ?? null,
        input.specialty_code ?? null,
        input.kind,
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
              event.specialty_code, event.kind, event.effective_on, event.expires_on,
              event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
              event.idempotency_key, event.before_state, event.after_state, event.created_at
         FROM member_qualification_events event
         LEFT JOIN credentials credential ON credential.id = event.credential_id
        WHERE event.idempotency_key = ?`,
      idempotencyKey,
    );
    if (raced !== undefined && sameReceipt(mapEvent(raced), input, actorSubject)) {
      return c.json({ replayed: true, event: presentEvent(mapEvent(raced)) });
    }
    return c.json({ error: 'qualification_write_rejected' }, 409);
  }

  const saved = await first<QualificationEventDbRow>(
    c.env.DB,
    `SELECT event.id, event.member_id, event.credential_id, credential.name AS credential_name,
            event.specialty_code, event.kind, event.effective_on, event.expires_on,
            event.evidence_source, event.evidence_reference, event.reason, event.actor_subject,
            event.idempotency_key, event.before_state, event.after_state, event.created_at
       FROM member_qualification_events event
       LEFT JOIN credentials credential ON credential.id = event.credential_id
      WHERE event.id = ?`,
    eventId,
  );
  if (saved === undefined) return c.json({ error: 'qualification_write_rejected' }, 409);
  return c.json({ replayed: false, event: presentEvent(mapEvent(saved)) }, 201);
});

export default router;
