import type { JwtPayload } from '@mbfd/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { loadConfigurationReceipt } from '../../lib/admin-configuration-receipt.js';
import { auditInsertStatement } from '../../lib/audit.js';
import { parseCredentialsXlsx, parseLegacyWideMatrix } from '../../lib/xlsx-cred-parser.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';
const router = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
router.use('*', requireAdmin);
type ImportRow = {
  name: string;
  fyPointsDefault: number;
  credentialId: number | null;
  revision: number;
  previousPoints: number | null;
  operation: 'CREATE' | 'UPDATE' | 'UNCHANGED';
};
type Preview = {
  previewKey: string;
  sourceHash: string;
  sourceRevision: number;
  mode: string;
  rows: ImportRow[];
  errors: { rowNumber: number; message: string }[];
  ready: boolean;
};
function validKey(key: string | undefined): key is string {
  return !!key && key === key.trim() && key.length <= 256;
}
router.post('/preview', requireStepUpAuth(), async (c) => {
  const key = c.req.header('Idempotency-Key');
  if (!validKey(key)) return c.json({ error: 'idempotency_key_required' }, 400);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > 10_000_000)
    return c.json({ error: 'xlsx_file_required_max_10mb' }, 400);
  const mode = form?.get('mode') ?? 'normalized';
  const metadataColumns = Number(form?.get('metadata_columns') ?? 0);
  if (
    !['normalized', 'legacy_wide_matrix'].includes(String(mode)) ||
    !Number.isInteger(metadataColumns) ||
    metadataColumns < 0 ||
    metadataColumns > 100
  )
    return c.json({ error: 'invalid_import_mode_or_metadata_columns' }, 400);
  const bytes = await file.arrayBuffer();
  const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const actor = String(c.get('claims').sub);
  const request = { sourceHash, mode, metadataColumns };
  const receiptInput = {
    key,
    actorSubject: actor,
    operation: 'credential.import.preview',
    request,
  };
  const prior = await loadConfigurationReceipt(c.env.DB, receiptInput);
  if (prior)
    return prior.ok
      ? c.json({ ...prior.response, replayed: true })
      : c.json({ error: prior.error }, 409);
  const parsed =
    mode === 'legacy_wide_matrix'
      ? await parseLegacyWideMatrix(bytes, { metadataColumns })
      : await parseCredentialsXlsx(bytes);
  const errors = parsed.errors.map(({ rowNumber, message }) => ({ rowNumber, message }));
  if (parsed.ok.length > 500)
    errors.push({
      rowNumber: 0,
      message: 'Split the catalog into files of no more than 500 qualifications.',
    });
  const before = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  const catalog = (
    await c.env.DB.prepare(
      'SELECT c.id,c.name,c.fy_points_default AS points,m.display_name AS displayName,COALESCE(m.revision,0) AS revision,m.retired_on AS retiredOn FROM credentials c LEFT JOIN credential_catalog_metadata m ON m.credential_id=c.id',
    ).all<{
      id: number;
      name: string;
      points: number;
      displayName: string | null;
      revision: number;
      retiredOn: string | null;
    }>()
  ).results;
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  for (const [index, row] of parsed.ok.slice(0, 500).entries()) {
    const normalized = row.name.toLowerCase();
    if (seen.has(normalized)) {
      errors.push({ rowNumber: index + 2, message: `Duplicate qualification: ${row.name}` });
      continue;
    }
    seen.add(normalized);
    if (
      row.name.length < 2 ||
      row.name.length > 160 ||
      !Number.isInteger(row.fyPointsDefault) ||
      row.fyPointsDefault < 0 ||
      row.fyPointsDefault > 10000
    ) {
      errors.push({
        rowNumber: index + 2,
        message: 'Qualification label or points are outside supported limits.',
      });
      continue;
    }
    const matches = catalog.filter(
      (c) => c.name.toLowerCase() === normalized || c.displayName?.toLowerCase() === normalized,
    );
    const existing = matches[0];
    if (matches.length > 1 || (existing && existing.name !== row.name)) {
      errors.push({
        rowNumber: index + 2,
        message: `Review the stable policy token and display-label collision for ${row.name}.`,
      });
      continue;
    }
    if (existing?.retiredOn) {
      errors.push({
        rowNumber: index + 2,
        message: `Retired qualification requires individual catalog review: ${row.name}.`,
      });
      continue;
    }
    // Header-only legacy files do not carry approved default points.
    const points =
      mode === 'legacy_wide_matrix' && existing ? existing.points : row.fyPointsDefault;
    rows.push({
      name: row.name,
      fyPointsDefault: points,
      credentialId: existing?.id ?? null,
      revision: existing?.revision ?? 0,
      previousPoints: existing?.points ?? null,
      operation: !existing ? 'CREATE' : existing.points === points ? 'UNCHANGED' : 'UPDATE',
    });
  }
  if (!rows.length)
    errors.push({ rowNumber: 0, message: 'No catalog qualifications were parsed.' });
  const after = await c.env.DB.prepare(
    'SELECT revision FROM annual_source_revision WHERE id=1',
  ).first<{ revision: number }>();
  if (!before || before.revision !== after?.revision)
    return c.json({ error: 'catalog_source_changed_review_again' }, 409);
  const preview: Preview = {
    previewKey: key,
    sourceHash,
    sourceRevision: before.revision,
    mode: String(mode),
    rows,
    errors,
    ready: errors.length === 0,
  };
  try {
    await c.env.DB.prepare(
      'INSERT INTO admin_configuration_receipts (idempotency_key,actor_subject,operation,request_json,response_json,created_at) VALUES (?,?,?,?,?,?)',
    )
      .bind(
        key,
        actor,
        receiptInput.operation,
        JSON.stringify(request),
        JSON.stringify(preview),
        Date.now(),
      )
      .run();
  } catch {
    const replay = await loadConfigurationReceipt(c.env.DB, receiptInput);
    if (replay)
      return replay.ok
        ? c.json({ ...replay.response, replayed: true })
        : c.json({ error: replay.error }, 409);
    return c.json({ error: 'preview_could_not_be_saved' }, 409);
  }
  return c.json(preview);
});
const Commit = z
  .object({
    preview_key: z.string().min(1).max(256),
    expected_source_revision: z.number().int().nonnegative(),
    accept: z.literal(true),
    source_ref: z.string().trim().min(4).max(500),
    reason: z.string().trim().min(4).max(500),
  })
  .strict();
router.post('/commit', requireStepUpAuth(), async (c) => {
  const parsed = Commit.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  const body = parsed.data;
  const key = c.req.header('Idempotency-Key');
  if (!validKey(key)) return c.json({ error: 'idempotency_key_required' }, 400);
  const actor = String(c.get('claims').sub);
  const receiptInput = {
    key,
    actorSubject: actor,
    operation: 'credential.import.commit',
    request: body,
  };
  const prior = await loadConfigurationReceipt(c.env.DB, receiptInput);
  if (prior)
    return prior.ok
      ? c.json({ ...prior.response, replayed: true })
      : c.json({ error: prior.error }, 409);
  const saved = await c.env.DB.prepare(
    "SELECT actor_subject,response_json FROM admin_configuration_receipts WHERE idempotency_key=? AND operation='credential.import.preview'",
  )
    .bind(body.preview_key)
    .first<{ actor_subject: string; response_json: string }>();
  if (!saved || saved.actor_subject !== actor)
    return c.json({ error: 'own_reviewed_import_preview_required' }, 409);
  const preview = JSON.parse(saved.response_json) as Preview;
  if (
    !preview.ready ||
    preview.errors.length ||
    preview.sourceRevision !== body.expected_source_revision
  )
    return c.json({ error: 'import_preview_has_unresolved_errors' }, 409);
  const response = {
    inserted: preview.rows.filter((r) => r.operation === 'CREATE').length,
    updated: preview.rows.filter((r) => r.operation === 'UPDATE').length,
    unchanged: preview.rows.filter((r) => r.operation === 'UNCHANGED').length,
    sourceHash: preview.sourceHash,
    previewKey: preview.previewKey,
  };
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO admin_configuration_receipts (idempotency_key,actor_subject,operation,request_json,response_json,created_at) VALUES (?,?,?,CASE WHEN (SELECT revision FROM annual_source_revision WHERE id=1)=? THEN ? ELSE NULL END,?,?)',
      ).bind(
        key,
        actor,
        receiptInput.operation,
        preview.sourceRevision,
        JSON.stringify(body),
        JSON.stringify(response),
        Date.now(),
      ),
      ...preview.rows
        .filter((r) => r.operation !== 'UNCHANGED')
        .map((r) =>
          r.operation === 'CREATE'
            ? c.env.DB.prepare(
                'INSERT INTO credentials (name,fy_points_default) VALUES (?,?)',
              ).bind(r.name, r.fyPointsDefault)
            : c.env.DB.prepare('UPDATE credentials SET fy_points_default=? WHERE id=?').bind(
                r.fyPointsDefault,
                r.credentialId,
              ),
        ),
      auditInsertStatement(c.env.DB, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: c.get('claims').member_id,
        action: 'credentials_import',
        targetKind: 'credential_catalog',
        targetId: preview.previewKey,
        reason: body.reason,
        afterState: {
          ...response,
          sourceRef: body.source_ref,
          reviewedSourceRevision: preview.sourceRevision,
        },
        clientMeta: { idempotency_key: key },
      }),
    ]);
  } catch {
    const replay = await loadConfigurationReceipt(c.env.DB, receiptInput);
    if (replay)
      return replay.ok
        ? c.json({ ...replay.response, replayed: true })
        : c.json({ error: replay.error }, 409);
    return c.json({ error: 'catalog_changed_or_import_failed_review_again' }, 409);
  }
  return c.json({ ...response, replayed: false });
});
export default router;
