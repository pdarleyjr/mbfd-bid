import { ulid } from 'ulid';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import {
  configurationReceiptStatement,
  loadConfigurationReceipt,
} from './admin-configuration-receipt.js';
import { canonicalBidDefinition } from './bid-definition-content.js';
import {
  captureBidDefinitionControl,
  captureBidDefinitionSource,
} from './bid-definition-source.js';
import { loadBidDefinitionHead, loadBidDefinitionVersion } from './bid-definition-version.js';
import { nextVersion } from './rule-book-version.js';

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Expected = z.union([
  z.object({ kind: z.literal('legacy'), sourceToken: Hash }).strict(),
  z
    .object({
      kind: z.literal('version'),
      versionId: z.string().min(1),
      revision: z.number().int().positive(),
      sha256: Hash,
    })
    .strict(),
]);
const Intent = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), content: z.unknown() }).strict(),
  z.object({ operation: z.literal('restore'), versionId: z.string().min(1) }).strict(),
]);
export const SaveBidDefinitionSchema = z
  .object({
    year: z.number().int().min(2024).max(2100),
    key: z.string().trim().min(1).max(200),
    actorSubject: z.string().min(1),
    actorId: z.number().int().positive().nullable(),
    expected: Expected,
    reason: z.string().trim().min(4).max(1000),
    intent: Intent,
  })
  .strict();
export type SaveBidDefinitionInput = z.infer<typeof SaveBidDefinitionSchema>;
const canonical = (value: unknown) => canonicalize(value as JsonValue);
const conflict = () => ({ ok: false as const, error: 'bid_definition_or_source_changed' as const });

/** Internal store only. Routes may expose adoption after versioned session
 * creation, load-time integrity and competing legacy-writer guards are wired.
 * A Save records editing history; it confers no publication or Live authority. */
export async function saveBidDefinition(database: D1Database, rawInput: SaveBidDefinitionInput) {
  const parsed = SaveBidDefinitionSchema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false as const, error: 'invalid_bid_save_request', issues: parsed.error.issues };
  const input = parsed.data;
  const proposed =
    input.intent.operation === 'save' ? canonicalBidDefinition(input.intent.content) : null;
  if (proposed && !proposed.ok)
    return { ok: false as const, error: 'invalid_bid_definition', issues: proposed.issues };
  const request = JSON.parse(
    canonical({
      year: input.year,
      expected: input.expected,
      reason: input.reason,
      actorId: input.actorId,
      intent: proposed?.ok ? { operation: 'save', content: proposed.content } : input.intent,
    }),
  );
  const receiptInput = {
    key: input.key,
    actorSubject: input.actorSubject,
    operation: `bid-definition-${input.intent.operation}`,
    request,
  };
  const replay = async () => {
    const receipt = await loadConfigurationReceipt(database, receiptInput);
    return receipt?.ok
      ? { ok: true as const, replayed: true, response: receipt.response }
      : receipt;
  };
  const previous = await replay();
  if (previous) return previous;
  // Exact receipt replay precedes every mutable-head/source check, including
  // no-op receipts whose original head has since advanced.
  const head = await loadBidDefinitionHead(database, input.year);
  let current: Awaited<ReturnType<typeof loadBidDefinitionVersion>> | null = null;
  let sourceGuard: NonNullable<Awaited<ReturnType<typeof captureBidDefinitionControl>>>;
  let origin: Record<string, unknown>;
  if (head) {
    if (
      input.expected.kind !== 'version' ||
      head.versionId !== input.expected.versionId ||
      head.revision !== input.expected.revision
    )
      return conflict();
    current = await loadBidDefinitionVersion(database, input.year, head.versionId);
    if (!current.ok) return current;
    if (
      current.row.content_sha256 !== input.expected.sha256 ||
      current.row.version_number !== head.revision
    )
      return conflict();
    const captured = await captureBidDefinitionControl(database, input.year);
    if (!captured) return conflict();
    sourceGuard = captured;
    origin = { predecessorId: head.versionId, capturedControlToken: captured.token };
  } else {
    if (input.expected.kind !== 'legacy' || input.intent.operation !== 'save') return conflict();
    const legacy = await captureBidDefinitionSource(database, input.year);
    if (!legacy.ok) return legacy;
    if (legacy.sourceToken !== input.expected.sourceToken) return conflict();
    sourceGuard = legacy.sourceGuard;
    origin = { legacy: legacy.origin, legacySourceToken: legacy.sourceToken };
  }
  const restored =
    input.intent.operation === 'restore'
      ? await loadBidDefinitionVersion(database, input.year, input.intent.versionId)
      : null;
  if (restored && !restored.ok) return restored;
  const candidate = restored?.ok ? restored : proposed;
  if (!candidate?.ok) return { ok: false as const, error: 'invalid_bid_definition' };
  if (candidate.content.bidYear !== input.year)
    return { ok: false as const, error: 'bid_definition_year_mismatch' };
  const changed =
    input.intent.operation === 'restore' ||
    !current?.ok ||
    candidate.sha256 !== current.sha256 ||
    candidate.serialized !== current.serialized;
  const versions = changed
    ? await database
        .prepare('SELECT version FROM rule_books UNION SELECT version FROM position_templates')
        .all<{ version: string }>()
    : null;
  const alias = changed
    ? nextVersion(input.year, versions?.results.map((entry) => entry.version) ?? [])
    : null;
  const versionId = changed ? ulid() : head?.versionId;
  const ordinal = changed ? (head?.revision ?? 0) + 1 : head?.revision;
  if (!versionId || !ordinal) return conflict();
  const now = Date.now();
  const documentId = changed && candidate.content.policy ? ulid() : null;
  const response = {
    changed,
    versionId,
    versionNumber: ordinal,
    contentSha256: candidate.sha256,
    predecessorId: changed
      ? (head?.versionId ?? null)
      : current?.ok
        ? current.row.predecessor_id
        : null,
    restoredFromId: restored?.ok
      ? restored.row.id
      : !changed && current?.ok
        ? current.row.restored_from_id
        : null,
  };
  const headSql = head
    ? 'EXISTS(SELECT 1 FROM bid_definition_heads h JOIN bid_definition_versions v ON v.id=h.version_id WHERE h.bid_year=? AND h.version_id=? AND h.revision=? AND v.content_sha256=?)'
    : 'NOT EXISTS(SELECT 1 FROM bid_definition_heads WHERE bid_year=?)';
  const headParameters =
    head && current?.ok
      ? [input.year, head.versionId, head.revision, current.sha256]
      : [input.year];
  const statements = [
    database
      .prepare(`INSERT INTO audit_log (id,bid_session_id,seq,actor_type,actor_id,action,target_kind,target_id,
      before_state,after_state,reason,ai_advisory_id,client_meta,created_at)
      SELECT ?,NULL,COALESCE(MAX(seq),0)+1,'admin',?,'bid_configuration_set','bid_definition',?,?,?, ?,NULL,?,?
      FROM audit_log WHERE bid_session_id IS NULL HAVING ${headSql} AND ${sourceGuard.sql}`)
      .bind(
        ulid(),
        input.actorId,
        versionId,
        canonical(input.expected),
        canonical(response),
        input.reason,
        canonical({ operation: receiptInput.operation, idempotencyKey: input.key }),
        Math.floor(now / 1000),
        ...headParameters,
        ...sourceGuard.parameters,
      ),
    // MUST immediately follow the conditional audit. A failed guard makes
    // changes() zero; NOT NULL rejects the receipt and rolls back the batch.
    configurationReceiptStatement(database, receiptInput, response),
  ];
  if (changed && alias) {
    const contentJson = candidate.serialized;
    statements.push(
      database
        .prepare('INSERT INTO position_templates (version,effective_year,notes) VALUES (?,?,?)')
        .bind(alias, input.year, candidate.content.notes.positions),
      database
        .prepare(
          "INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES (?,?,'draft',0,?)",
        )
        .bind(alias, input.year, candidate.content.notes.bid),
      database
        .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count)
        SELECT json_extract(value,'$.id'),?,json_extract(value,'$.shift'),json_extract(value,'$.station'),json_extract(value,'$.division'),
        json_extract(value,'$.unit'),json_extract(value,'$.rankRequired'),json_extract(value,'$.positionName'),json_extract(value,'$.isFloating'),
        json_extract(value,'$.isVacantByDesign'),json_extract(value,'$.isExcludedFromCount') FROM json_each(?,'$.positions')`)
        .bind(alias, contentJson),
      database
        .prepare(`INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
        SELECT ?,json_extract(value,'$.positionId'),?,json_extract(value,'$.requiredCriteriaJson'),json_extract(value,'$.pointsPreferenceJson'),
        json_extract(value,'$.tieBreakChainJson'),json_extract(value,'$.notes') FROM json_each(?,'$.rules')`)
        .bind(alias, alias, contentJson),
      database
        .prepare(`INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        SELECT ?,json_extract(value,'$.positionId'),?,json_extract(value,'$.bidParticipation'),json_extract(value,'$.authoritativeSourceRef'),?
        FROM json_each(?,'$.participation')`)
        .bind(alias, alias, now, contentJson),
      database
        .prepare(`INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
        SELECT json_extract(value,'$.positionId'),?,json_extract(value,'$.staffingPositionId'),json_extract(value,'$.authoritativeSourceRef'),json_extract(value,'$.reviewStatus'),?
        FROM json_each(?,'$.staffingBindings')`)
        .bind(alias, now, contentJson),
    );
    if (documentId && candidate.content.policy)
      statements.push(
        database
          .prepare(`INSERT INTO annual_bid_policy_documents
      (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at)
      VALUES (?,?,?,1,'DRAFT',?,?,?,?,?)`)
          .bind(
            documentId,
            alias,
            input.year,
            candidate.content.policy.policyText,
            canonical(candidate.content.policy.executionPolicy),
            input.actorId,
            now,
            now,
          ),
      );
    statements.push(
      database
        .prepare(`INSERT INTO bid_definition_versions
      (id,bid_year,version_number,schema_version,content_json,content_sha256,origin_json,rule_book_version,rule_book_revision,
      position_template_version,policy_document_id,predecessor_id,restored_from_id,actor_subject,reason,created_at)
      VALUES (?,?,?,1,?,?,?,?,0,?,?,?,?,?,?,?)`)
        .bind(
          versionId,
          input.year,
          ordinal,
          contentJson,
          candidate.sha256,
          canonical({ ...origin, restoredFromId: restored?.ok ? restored.row.id : null }),
          alias,
          alias,
          documentId,
          head?.versionId ?? null,
          restored?.ok ? restored.row.id : null,
          input.actorSubject,
          input.reason,
          now,
        ),
    );
    statements.push(
      head
        ? database
            .prepare(
              'UPDATE bid_definition_heads SET version_id=?,revision=? WHERE bid_year=? AND version_id=? AND revision=?',
            )
            .bind(versionId, ordinal, input.year, head.versionId, head.revision)
        : database
            .prepare(
              'INSERT INTO bid_definition_heads (bid_year,version_id,revision) VALUES (?,?,1)',
            )
            .bind(input.year, versionId),
    );
  }
  try {
    await database.batch(statements);
    return { ok: true as const, replayed: false, response };
  } catch {
    // A timed-out transaction may have committed. Resolve the same immutable
    // receipt before reporting a conflict; never retry with recomputed input.
    return (await replay()) ?? conflict();
  }
}
