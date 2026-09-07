import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { z } from 'zod';
import { auditInsertStatement } from '../../lib/audit.js';
import { operationalDate } from '../../lib/operational-date.js';
import {
  type LegacyCredentialBaseline,
  deriveMemberQualificationProjection,
  isQualificationCalendarDate,
} from '../../lib/qualification-lifecycle.js';
import {
  type TargetCredentialRow,
  classifyTargetCredential,
  credentialSourceKey,
  parseTargetSolutions,
} from '../../lib/targetsolutions.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';
import { mapEvent } from './qualification-lifecycle.js';

const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
const SAFE = ['NEW_QUALIFICATION', 'FILL_MISSING_DATE', 'RENEWAL', 'UNCHANGED', 'REFERENCE_ONLY'];
type Import = {
  id: string;
  filename: string;
  observed_on: string;
  source_row_count: number;
  unique_row_count: number;
  coverage_json: string;
  status: string;
};
type SourceRow = {
  id: string;
  source_json: string;
  member_id: number | null;
  credential_id: number | null;
  classification: string;
  before_json: string | null;
  applied_at: number | null;
  applied_event_id: string | null;
};
const all = async <T>(db: D1Database, sql: string, ...args: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
const revision = async (db: D1Database) =>
  (
    await db
      .prepare('SELECT revision FROM annual_source_revision WHERE id=1')
      .first<{ revision: number }>()
  )?.revision ?? -1;
const getImport = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM targetsolutions_imports WHERE id=?').bind(id).first<Import>();
const chunks = <T>(items: T[], size = 100): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

async function state(db: D1Database) {
  const [members, catalog, mappings, baseline, eventRows] = await Promise.all([
    all<{ id: number; employee_id: string; first_name: string; last_name: string }>(
      db,
      'SELECT id,employee_id,first_name,last_name FROM members',
    ),
    all<{ id: number; name: string; display_name: string | null; retired_on: string | null }>(
      db,
      'SELECT c.id,c.name,m.display_name,m.retired_on FROM credentials c LEFT JOIN credential_catalog_metadata m ON m.credential_id=c.id',
    ),
    all<{ source_key: string; credential_id: number | null; treatment: string }>(
      db,
      'SELECT source_key,credential_id,treatment FROM targetsolutions_mappings',
    ),
    all<LegacyCredentialBaseline>(
      db,
      'SELECT mc.member_id AS memberId,mc.credential_id AS credentialId,c.name AS credentialName,mc.start_date AS startDate,mc.expiration_date AS expirationDate FROM member_credentials mc JOIN credentials c ON c.id=mc.credential_id',
    ),
    all<Parameters<typeof mapEvent>[0]>(
      db,
      'SELECT event.*,credential.name AS credential_name FROM member_qualification_events event LEFT JOIN credentials credential ON credential.id=event.credential_id ORDER BY event.effective_on,event.created_at,event.id',
    ),
  ]);
  const events = eventRows.map(mapEvent);
  if (events.some((v) => v === null))
    throw new Error('Qualification history requires review before import.');
  return { members, catalog, mappings, baseline, events: events.filter((v) => v !== null) };
}
type State = Awaited<ReturnType<typeof state>>;
function assess(raw: TargetCredentialRow, snapshot: State, observedOn: string) {
  const members = snapshot.members.filter((m) => m.employee_id === raw.employeeId);
  const member = members.length === 1 ? members[0] : undefined;
  const key = credentialSourceKey(raw.credentialName);
  const mapping = snapshot.mappings.find((m) => m.source_key === key);
  const candidates = snapshot.catalog.filter((c) =>
    mapping
      ? c.id === mapping.credential_id
      : [c.name, c.display_name].some((n) => n && credentialSourceKey(n) === key),
  );
  const credential =
    candidates.length === 1 && !candidates[0]?.retired_on ? candidates[0] : undefined;
  const base =
    member && credential
      ? snapshot.baseline.filter(
          (r) => r.memberId === member.id && r.credentialId === credential.id,
        )
      : [];
  const events =
    member && credential
      ? snapshot.events.filter((r) => r.memberId === member.id && r.credentialId === credential.id)
      : [];
  const current =
    member && credential
      ? deriveMemberQualificationProjection({
          memberId: member.id,
          asOf: observedOn,
          legacyCredentials: base,
          events,
        }).certifications[0]
      : undefined;
  const fingerprint = JSON.stringify({
    member: member?.id ?? null,
    credential: credential?.id ?? null,
    treatment: mapping?.treatment ?? null,
    base,
    events: events.map((e) => e.id),
  });
  let classification: string = !member
    ? 'UNKNOWN_MEMBER'
    : mapping?.treatment === 'reference_only'
      ? 'REFERENCE_ONLY'
      : !mapping && /failed|do not use/i.test(raw.credentialName)
        ? 'REFERENCE_REVIEW'
        : !credential
          ? 'UNKNOWN_QUALIFICATION'
          : events.some((e) => e.effectiveOn > observedOn)
            ? 'CONFLICT'
            : classifyTargetCredential(raw, current, observedOn);
  if (members.length > 1) classification = 'AMBIGUOUS_MEMBER';
  return {
    memberId: member?.id ?? null,
    memberName: member ? `${member.last_name}, ${member.first_name}` : null,
    credentialId: credential?.id ?? null,
    classification,
    before: { fingerprint, current: current ?? null },
  };
}

router.get('/imports', async (c) =>
  c.json({
    imports: await all(
      c.env.DB,
      'SELECT id,filename,observed_on,status,source_row_count,unique_row_count,created_at FROM targetsolutions_imports ORDER BY created_at DESC LIMIT 50',
    ),
  }),
);
router.get('/catalog', async (c) =>
  c.json({
    credentials: await all(
      c.env.DB,
      'SELECT c.id,c.name,COALESCE(m.display_name,c.name) AS displayName FROM credentials c LEFT JOIN credential_catalog_metadata m ON m.credential_id=c.id WHERE m.retired_on IS NULL ORDER BY c.name',
    ),
    mappings: await all(
      c.env.DB,
      'SELECT source_key,source_name,credential_id,treatment,created_at FROM targetsolutions_mappings',
    ),
  }),
);

router.get('/imports/:id/names', async (c) => {
  if (!(await getImport(c.env.DB, c.req.param('id'))))
    return c.json({ error: 'import_not_found' }, 404);
  const rows = await all<{ name: string; classification: string; n: number }>(
    c.env.DB,
    "SELECT json_extract(source_json,'$.credentialName') AS name,classification,COUNT(*) AS n FROM targetsolutions_rows WHERE import_id=? AND applied_at IS NULL AND classification IN ('UNKNOWN_QUALIFICATION','REFERENCE_REVIEW') GROUP BY 1,2 ORDER BY 1",
    c.req.param('id'),
  );
  return c.json({ names: rows });
});

// Explicit reviewed batch registration of distinct definitions. This never guesses aliases.
router.post('/imports/:id/register-names', requireStepUpAuth(), async (c) => {
  const parsed = z
    .object({
      names: z.array(z.string().trim().min(1).max(160)).min(1).max(250),
      reason: z.string().trim().min(4).max(500),
      confirm_distinct: z.literal(true),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'review_and_confirm_distinct_names' }, 400);
  const batch = await getImport(c.env.DB, c.req.param('id'));
  if (!batch || batch.status !== 'reviewed')
    return c.json({ error: 'review_import_before_registering_names' }, 409);
  const rev = await revision(c.env.DB);
  const snapshot = await state(c.env.DB);
  const pending = await all<{ source_json: string; classification: string }>(
    c.env.DB,
    'SELECT source_json,classification FROM targetsolutions_rows WHERE import_id=? AND applied_at IS NULL',
    batch.id,
  );
  const allowed = new Set(
    pending
      .filter((r) => r.classification === 'UNKNOWN_QUALIFICATION')
      .map((r) =>
        credentialSourceKey((JSON.parse(r.source_json) as TargetCredentialRow).credentialName),
      ),
  );
  const keys = parsed.data.names.map(credentialSourceKey);
  if (
    new Set(keys).size !== keys.length ||
    keys.some(
      (key) =>
        !allowed.has(key) ||
        snapshot.mappings.some((m) => m.source_key === key) ||
        snapshot.catalog.some((r) =>
          [r.name, r.display_name].some((n) => n && credentialSourceKey(n) === key),
        ),
    )
  )
    return c.json({ error: 'names_changed_or_require_individual_mapping_refresh' }, 409);
  const actor = String(c.get('claims').sub);
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO targetsolutions_commands VALUES(?,?,?,?,?,CASE WHEN (SELECT revision FROM annual_source_revision WHERE id=1)=? THEN 1 ELSE 0 END)',
      ).bind(ulid(), batch.id, actor, parsed.data.reason, now, rev),
      c.env.DB.prepare(
        'INSERT INTO credentials(name,fy_points_default) SELECT value,0 FROM json_each(?)',
      ).bind(JSON.stringify(parsed.data.names)),
      c.env.DB.prepare(
        "INSERT INTO targetsolutions_mappings SELECT json_extract(value,'$.key'),json_extract(value,'$.name'),(SELECT id FROM credentials WHERE name=json_extract(value,'$.name')),'qualification',?,?,? FROM json_each(?)",
      ).bind(
        parsed.data.reason,
        actor,
        now,
        JSON.stringify(parsed.data.names.map((name, i) => ({ name, key: keys[i] }))),
      ),
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'targetsolutions_mapping',
        targetKind: 'qualification_import',
        targetId: batch.id,
        reason: parsed.data.reason,
        afterState: { distinctNames: parsed.data.names, defaultPoints: 0 },
      }),
    ]);
  } catch {
    return c.json({ error: 'catalog_changed_refresh_before_registering' }, 409);
  }
  return c.json({
    registered: keys.length,
    notice:
      'Definitions registered with zero default points. Refresh the comparison before applying member evidence.',
  });
});

router.post('/imports', requireStepUpAuth(), async (c) => {
  const input = z
    .object({
      csv: z.string().min(1).max(10000000),
      filename: z.string().trim().min(1).max(160),
      observed_on: z.string().optional(),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'valid_csv_and_filename_required' }, 400);
  const report = parseTargetSolutions(input.data.csv);
  const observedOn = input.data.observed_on ?? report.observedOn;
  if (!observedOn || !isQualificationCalendarDate(observedOn) || observedOn > operationalDate())
    return c.json(
      { error: 'valid_report_date_required_no_future_date', errors: report.errors },
      422,
    );
  if (report.observedOn && input.data.observed_on && report.observedOn !== input.data.observed_on)
    return c.json({ error: 'report_date_conflicts_with_file' }, 422);
  if (report.errors.length)
    return c.json(
      { error: 'source_file_requires_correction', errors: report.errors.slice(0, 100) },
      422,
    );
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.data.csv));
  const id = Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, '0')).join('');
  const prior = await getImport(c.env.DB, id);
  if (prior && prior.observed_on !== observedOn)
    return c.json({ error: 'same_file_already_registered_with_different_date' }, 409);
  if (prior && prior.status !== 'uploading') return c.json({ id, replayed: true });
  const actor = String(c.get('claims').sub);
  await c.env.DB.prepare(
    "INSERT INTO targetsolutions_imports(id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at) VALUES(?,?,?,?,?,?,'uploading',?,?) ON CONFLICT(id) DO NOTHING",
  )
    .bind(
      id,
      input.data.filename,
      observedOn,
      report.sourceRowCount,
      report.rows.length,
      JSON.stringify({ ...report.coverage, runDate: report.runDate }),
      actor,
      Date.now(),
    )
    .run();
  // Bounded JSON chunks permit retries after an interrupted upload without a giant SQL statement.
  for (const part of chunks(report.rows))
    await c.env.DB.prepare(
      "INSERT INTO targetsolutions_rows(id,import_id,row_number,source_json) SELECT ? || ':' || json_extract(value,'$.rowNumber'),?,json_extract(value,'$.rowNumber'),value FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING",
    )
      .bind(id, id, JSON.stringify(part))
      .run();
  await c.env.DB.prepare(
    "UPDATE targetsolutions_imports SET status='staged' WHERE id=? AND status='uploading' AND unique_row_count=(SELECT COUNT(*) FROM targetsolutions_rows WHERE import_id=?)",
  )
    .bind(id, id)
    .run();
  return c.json({ id, replayed: !!prior }, prior ? 200 : 201);
});

router.get('/imports/:id', async (c) => {
  const batch = await getImport(c.env.DB, c.req.param('id'));
  if (!batch) return c.json({ error: 'import_not_found' }, 404);
  const counts = await all<{ classification: string; n: number }>(
    c.env.DB,
    "SELECT CASE WHEN classification='REJECTED' THEN 'REJECTED' WHEN applied_at IS NOT NULL THEN 'APPLIED' ELSE classification END AS classification,COUNT(*) AS n FROM targetsolutions_rows WHERE import_id=? GROUP BY 1",
    batch.id,
  );
  const category = c.req.query('category') ?? '';
  const offset = Math.max(0, Math.min(25000, Number(c.req.query('offset')) || 0));
  const rows = await all<SourceRow>(
    c.env.DB,
    `SELECT * FROM targetsolutions_rows WHERE import_id=? ${category === 'APPLIED' ? "AND applied_at IS NOT NULL AND classification<>'REJECTED'" : category === 'REJECTED' ? "AND classification='REJECTED'" : category ? 'AND classification=? AND applied_at IS NULL' : ''} ORDER BY row_number LIMIT 100 OFFSET ?`,
    batch.id,
    ...(category && !['APPLIED', 'REJECTED'].includes(category) ? [category] : []),
    offset,
  );
  return c.json({
    ...batch,
    coverage: JSON.parse(batch.coverage_json),
    counts: Object.fromEntries(counts.map((r) => [r.classification, r.n])),
    rows: rows.map((r) => ({
      ...r,
      source: JSON.parse(r.source_json),
      before: r.before_json ? JSON.parse(r.before_json) : null,
    })),
    offset,
  });
});

router.post('/imports/:id/review', requireStepUpAuth(), async (c) => {
  const batch = await getImport(c.env.DB, c.req.param('id'));
  if (!batch || batch.status === 'uploading')
    return c.json({ error: 'complete_upload_required' }, 409);
  const rev = await revision(c.env.DB);
  const snapshot = await state(c.env.DB);
  const rows = await all<SourceRow>(
    c.env.DB,
    'SELECT * FROM targetsolutions_rows WHERE import_id=? AND applied_at IS NULL ORDER BY row_number',
    batch.id,
  );
  const assessments = rows.map((r) => ({
    id: r.id,
    ...assess(JSON.parse(r.source_json), snapshot, batch.observed_on),
  }));
  const groups = new Map<string, Set<string>>();
  for (const [i, row] of rows.entries()) {
    const a = assessments[i];
    if (!a) throw new Error('Import comparison row missing');
    const source = JSON.parse(row.source_json) as TargetCredentialRow;
    if (a.memberId && a.credentialId) {
      const key = `${a.memberId}:${a.credentialId}`;
      const values = groups.get(key) ?? new Set<string>();
      values.add(JSON.stringify([source.status, source.effectiveOn, source.expiresOn]));
      groups.set(key, values);
    }
  }
  for (const a of assessments)
    if ((groups.get(`${a.memberId}:${a.credentialId}`)?.size ?? 0) > 1)
      a.classification = 'CONFLICT';
  const actor = String(c.get('claims').sub);
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO targetsolutions_commands VALUES(?,?,?,?,?,CASE WHEN (SELECT revision FROM annual_source_revision WHERE id=1)=? THEN 1 ELSE 0 END)',
      ).bind(ulid(), batch.id, actor, 'Review credential import', now, rev),
      ...chunks(assessments).map((part) =>
        c.env.DB.prepare(`WITH input AS (SELECT value FROM json_each(?)) UPDATE targetsolutions_rows SET
        member_id=json_extract(input.value,'$.memberId'),credential_id=json_extract(input.value,'$.credentialId'),classification=json_extract(input.value,'$.classification'),before_json=json_extract(input.value,'$.before'),reviewed_by=?,reviewed_at=?
        FROM input WHERE targetsolutions_rows.id=json_extract(input.value,'$.id') AND applied_at IS NULL`).bind(
          JSON.stringify(part),
          actor,
          now,
        ),
      ),
      c.env.DB.prepare("UPDATE targetsolutions_imports SET status='reviewed' WHERE id=?").bind(
        batch.id,
      ),
    ]);
  } catch {
    return c.json({ error: 'source_changed_refresh_review' }, 409);
  }
  return c.json({ reviewed: assessments.length });
});

router.post('/mappings', requireStepUpAuth(), async (c) => {
  const parsed = z
    .object({
      source_name: z.string().trim().min(1).max(160),
      credential_id: z.number().int().positive().optional(),
      create_new: z.boolean().optional(),
      expected_mapping_revision: z.number().int().optional(),
      reference_only: z.boolean().optional(),
      reason: z.string().trim().min(4).max(500),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_mapping' }, 400);
  const body = parsed.data;
  if ([!!body.credential_id, !!body.create_new, !!body.reference_only].filter(Boolean).length !== 1)
    return c.json({ error: 'choose_exactly_one_mapping_action' }, 422);
  const key = credentialSourceKey(body.source_name);
  const actor = String(c.get('claims').sub);
  const now = Date.now();
  const prior = await c.env.DB.prepare('SELECT * FROM targetsolutions_mappings WHERE source_key=?')
    .bind(key)
    .first();
  if (prior && body.expected_mapping_revision !== prior.created_at)
    return c.json({ error: 'mapping_changed_refresh_catalog', mapping: prior }, 409);
  if (!prior && body.expected_mapping_revision !== undefined)
    return c.json({ error: 'mapping_no_longer_exists' }, 409);
  const catalog = await all<{
    id: number;
    name: string;
    display_name: string | null;
    retired_on: string | null;
  }>(
    c.env.DB,
    'SELECT c.id,c.name,m.display_name,m.retired_on FROM credentials c LEFT JOIN credential_catalog_metadata m ON m.credential_id=c.id',
  );
  if (
    body.create_new &&
    catalog.some((r) => [r.name, r.display_name].some((n) => n && credentialSourceKey(n) === key))
  )
    return c.json({ error: 'qualification_already_exists_choose_existing' }, 409);
  if (body.credential_id && !catalog.some((r) => r.id === body.credential_id && !r.retired_on))
    return c.json({ error: 'active_qualification_required' }, 422);
  const statements: D1PreparedStatement[] = [];
  if (prior)
    statements.push(
      c.env.DB.prepare(
        'INSERT INTO targetsolutions_mapping_guards VALUES(?,CASE WHEN (SELECT created_at FROM targetsolutions_mappings WHERE source_key=?)=? THEN 1 ELSE 0 END)',
      ).bind(ulid(), key, body.expected_mapping_revision),
    );
  if (body.create_new)
    statements.push(
      c.env.DB.prepare('INSERT INTO credentials(name,fy_points_default) VALUES(?,0)').bind(
        body.source_name,
      ),
    );
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO targetsolutions_mappings VALUES(?,?,${body.create_new ? '(SELECT id FROM credentials WHERE name=?)' : '?'},?,?,?,?)${prior ? ` ON CONFLICT(source_key) DO UPDATE SET source_name=excluded.source_name,credential_id=excluded.credential_id,treatment=excluded.treatment,reason=excluded.reason,actor_subject=excluded.actor_subject,created_at=excluded.created_at WHERE targetsolutions_mappings.created_at=${Number(body.expected_mapping_revision)}` : ''}`,
    ).bind(
      key,
      body.source_name,
      body.create_new ? body.source_name : (body.credential_id ?? null),
      body.reference_only ? 'reference_only' : 'qualification',
      body.reason,
      actor,
      prior ? Math.max(now, Number(prior.created_at) + 1) : now,
    ),
  );
  statements.push(
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'targetsolutions_mapping',
      targetKind: 'credential_catalog',
      targetId: key,
      reason: body.reason,
      beforeState: prior,
      afterState: body,
    }),
  );
  try {
    await c.env.DB.batch(statements);
  } catch {
    return c.json({ error: 'mapping_conflict_refresh_catalog' }, 409);
  }
  return c.json({
    saved: true,
    notice:
      'Mapping saved for pending and future imports. Previously applied qualification evidence is preserved; correct affected member records through qualification history when needed.',
  });
});

router.post('/imports/:id/reject', requireStepUpAuth(), async (c) => {
  const input = z
    .object({
      row_ids: z.array(z.string()).min(1).max(100),
      reason: z.string().trim().min(4).max(500),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'reviewed_rejection_reason_required' }, 400);
  const actor = String(c.get('claims').sub);
  const now = Date.now();
  const importId = c.req.param('id');
  if (!(await getImport(c.env.DB, importId))) return c.json({ error: 'import_not_found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE targetsolutions_rows SET classification='REJECTED',applied_at=?,applied_by=? WHERE import_id=? AND id IN (SELECT value FROM json_each(?)) AND applied_at IS NULL",
    ).bind(now, actor, importId, JSON.stringify(input.data.row_ids)),
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'targetsolutions_apply',
      targetKind: 'qualification_import',
      targetId: importId,
      reason: input.data.reason,
      afterState: { decision: 'reject_source_keep_current', rows: input.data.row_ids },
    }),
  ]);
  return c.json({
    rejected: true,
    notice: 'Source rows retained; existing qualification records unchanged.',
  });
});

router.post('/imports/:id/apply', requireStepUpAuth(), async (c) => {
  const parsed = z
    .object({
      safe: z.boolean().default(false),
      row_ids: z.array(z.string()).max(20).optional(),
      accept_adverse: z.boolean().default(false),
      reason: z.string().trim().min(4).max(500),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'review_reason_required' }, 400);
  const body = parsed.data;
  const batch = await getImport(c.env.DB, c.req.param('id'));
  if (!batch || batch.status !== 'reviewed')
    return c.json({ error: 'review_import_before_applying' }, 409);
  const rev = await revision(c.env.DB);
  const snapshot = await state(c.env.DB);
  const pending = await all<SourceRow>(
    c.env.DB,
    'SELECT * FROM targetsolutions_rows WHERE import_id=? AND applied_at IS NULL ORDER BY row_number',
    batch.id,
  );
  const selected = pending
    .filter((r) => body.row_ids?.includes(r.id) || (body.safe && SAFE.includes(r.classification)))
    .slice(0, 20);
  const actor = String(c.get('claims').sub);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO targetsolutions_commands VALUES(?,?,?,?,?,CASE WHEN (SELECT revision FROM annual_source_revision WHERE id=1)=? THEN 1 ELSE 0 END)',
    ).bind(ulid(), batch.id, actor, body.reason, now, rev),
  ];
  let added = 0;
  const appliedPairs = new Map<string, string | null>();
  for (const row of selected) {
    if (
      !row.before_json ||
      [
        'UNKNOWN_MEMBER',
        'AMBIGUOUS_MEMBER',
        'UNKNOWN_QUALIFICATION',
        'REFERENCE_REVIEW',
        'NOT_REVIEWED',
      ].includes(row.classification)
    )
      return c.json({ error: 'resolve_identity_and_mapping_before_apply', rowId: row.id }, 409);
    if (!SAFE.includes(row.classification) && !body.accept_adverse)
      return c.json({ error: 'explicit_adverse_change_approval_required', rowId: row.id }, 409);
    const source = JSON.parse(row.source_json) as TargetCredentialRow;
    const checked = assess(source, snapshot, batch.observed_on);
    const before = JSON.parse(row.before_json) as ReturnType<typeof assess>['before'];
    if (
      checked.memberId !== row.member_id ||
      checked.credentialId !== row.credential_id ||
      (checked.before.fingerprint !== before.fingerprint && checked.classification !== 'UNCHANGED')
    )
      return c.json({ error: 'member_evidence_changed_refresh_review', rowId: row.id }, 409);
    // A conflict is not resolved merely by clicking approval: the source/current evidence needs an explicit correction first.
    if (row.classification === 'CONFLICT' || checked.classification === 'CONFLICT')
      return c.json(
        {
          error: 'conflicting_evidence_requires_individual_qualification_correction',
          rowId: row.id,
        },
        409,
      );
    const pair = `${row.member_id}:${row.credential_id}`;
    let eventId = appliedPairs.get(pair) ?? null;
    if (
      !appliedPairs.has(pair) &&
      !['UNCHANGED', 'REFERENCE_ONLY'].includes(checked.classification)
    ) {
      if (!row.member_id || !row.credential_id)
        return c.json({ error: 'resolved_member_and_qualification_required' }, 409);
      const expires = source.expiresOn ?? checked.before.current?.expiresOn ?? null;
      const adverse =
        source.status === 'revoked'
          ? 'CERTIFICATION_REVOKED'
          : source.status === 'expired' || (expires && expires < batch.observed_on)
            ? 'CERTIFICATION_EXPIRED'
            : 'CERTIFICATION_GAINED';
      let effective =
        source.effectiveOn ?? checked.before.current?.effectiveOn ?? batch.observed_on;
      let eventExpires = expires;
      if (adverse === 'CERTIFICATION_EXPIRED') {
        effective = source.expiresOn
          ? new Date(Date.parse(`${source.expiresOn}T00:00:00Z`) + 86400000)
              .toISOString()
              .slice(0, 10)
          : batch.observed_on;
        eventExpires = effective;
      }
      if (adverse === 'CERTIFICATION_REVOKED') {
        effective = batch.observed_on;
        eventExpires = null;
      }
      if (eventExpires && eventExpires < effective)
        return c.json({ error: 'effective_date_requires_review' }, 422);
      eventId = ulid();
      added++;
      const after = {
        v: 1,
        importId: batch.id,
        rowId: row.id,
        sourceObservedOn: batch.observed_on,
        sourceExpiresOn: source.expiresOn,
        kind: adverse,
        effectiveOn: effective,
        expiresOn: eventExpires,
      };
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO member_qualification_events(id,member_id,credential_id,specialty_code,kind,effective_on,expires_on,evidence_source,evidence_reference,reason,actor_subject,idempotency_key,before_state,after_state,created_at) VALUES(?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          eventId,
          row.member_id,
          row.credential_id,
          adverse,
          effective,
          eventExpires,
          'TargetSolutions',
          `import:${batch.id};row:${source.rowNumber}`,
          body.reason,
          actor,
          `ts:${row.id}`,
          JSON.stringify(before),
          JSON.stringify(after),
          now,
        ),
      );
      appliedPairs.set(pair, eventId);
    }
    statements.push(
      c.env.DB.prepare(
        'UPDATE targetsolutions_rows SET applied_at=?,applied_by=?,applied_event_id=? WHERE id=? AND applied_at IS NULL',
      ).bind(now, actor, eventId, row.id),
    );
  }
  if (!selected.length) return c.json({ processed: 0, eventsAdded: 0, remainingSafe: 0 });
  statements.push(
    auditInsertStatement(c.env.DB, {
      bidSessionId: null,
      actorType: 'admin',
      actorId: c.get('claims').member_id,
      action: 'targetsolutions_apply',
      targetKind: 'qualification_import',
      targetId: batch.id,
      reason: body.reason,
      afterState: { rows: selected.map((r) => r.id), eventsAdded: added },
    }),
  );
  try {
    await c.env.DB.batch(statements);
  } catch {
    return c.json({ error: 'source_changed_or_import_interrupted_refresh_review' }, 409);
  }
  return c.json({
    processed: selected.length,
    eventsAdded: added,
    remainingSafe:
      pending.filter((r) => SAFE.includes(r.classification)).length -
      selected.filter((r) => SAFE.includes(r.classification)).length,
  });
});
export default router;
