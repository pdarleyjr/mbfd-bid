import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { type DB, getDb } from '../db/index.js';
import { canonicalBidDefinition } from './bid-definition-content.js';

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Integer = z.number().int().nonnegative();
export const BidDefinitionVersionRowSchema = z
  .object({
    id: z.string().min(1),
    bid_year: z.number().int(),
    version_number: Integer.positive(),
    schema_version: z.literal(1),
    content_json: z.string(),
    content_sha256: Hash,
    origin_json: z.string(),
    rule_book_version: z.string().min(1),
    rule_book_revision: Integer,
    position_template_version: z.string().min(1),
    policy_document_id: z.string().min(1).nullable(),
    predecessor_id: z.string().min(1).nullable(),
    restored_from_id: z.string().min(1).nullable(),
    actor_subject: z.string().min(1),
    reason: z.string().trim().min(4),
    created_at: Integer,
  })
  .strict();
export type BidDefinitionVersionRow = z.infer<typeof BidDefinitionVersionRowSchema>;
const canonical = (value: unknown) => canonicalize(value as JsonValue);
const flag = (value: unknown) => (value === 0 ? false : value === 1 ? true : value);
const invalid = () => ({ ok: false as const, error: 'bid_version_integrity_failed' as const });

/** Validate a version against its own sealed material. The current head and
 * mutable Department evidence are deliberately absent from this read. */
export async function loadBidDefinitionVersion(database: D1Database, year: number, id: string) {
  return loadBidDefinitionVersionFromDb(getDb(database), year, id);
}

export async function loadBidDefinitionVersionFromDb(database: DB, year: number, id: string) {
  const raw = await database.get(
    sql`SELECT * FROM bid_definition_versions WHERE bid_year=${year} AND id=${id}`,
  );
  if (raw === undefined || raw === null)
    return { ok: false as const, error: 'bid_version_not_found' as const };
  try {
    const row = BidDefinitionVersionRowSchema.parse(raw);
    const result = canonicalBidDefinition(JSON.parse(row.content_json));
    if (
      !result.ok ||
      result.content.bidYear !== year ||
      result.sha256 !== row.content_sha256 ||
      result.serialized !== row.content_json
    )
      return invalid();
    const origin = z.record(z.unknown()).parse(JSON.parse(row.origin_json));
    const [book, template, positions, rules, participation, bindings, documents] =
      await Promise.all([
        database.get(
          sql`SELECT effective_year,notes,revision FROM rule_books WHERE version=${row.rule_book_version}`,
        ),
        database.get(
          sql`SELECT effective_year,notes FROM position_templates WHERE version=${row.position_template_version}`,
        ),
        database.all<
          Record<string, unknown>
        >(sql`SELECT id,shift,station,division,unit,rank_required AS rankRequired,position_name AS positionName,
        is_floating AS isFloating,is_vacant_by_design AS isVacantByDesign,is_excluded_from_count AS isExcludedFromCount
        FROM positions WHERE template_version=${row.position_template_version} ORDER BY id`),
        database.all<
          Record<string, unknown>
        >(sql`SELECT position_id AS positionId,template_version AS templateVersion,rule_book_version AS ruleBookVersion,
        required_criteria AS requiredCriteriaJson,points_preference AS pointsPreferenceJson,tie_break_chain AS tieBreakChainJson,notes
        FROM position_rules WHERE rule_book_version=${row.rule_book_version} OR template_version=${row.position_template_version} ORDER BY position_id`),
        database.all<
          Record<string, unknown>
        >(sql`SELECT position_id AS positionId,template_version AS templateVersion,rule_book_version AS ruleBookVersion,
        bid_participation AS bidParticipation,authoritative_source_ref AS authoritativeSourceRef
        FROM rule_book_position_participation WHERE rule_book_version=${row.rule_book_version} OR template_version=${row.position_template_version} ORDER BY position_id`),
        database.all<
          Record<string, unknown>
        >(sql`SELECT position_id AS positionId,staffing_position_id AS staffingPositionId,
        authoritative_source_ref AS authoritativeSourceRef,review_status AS reviewStatus
        FROM position_staffing_bindings WHERE template_version=${row.position_template_version} ORDER BY position_id`),
        database.all<
          Record<string, unknown>
        >(sql`SELECT id,effective_year,policy_text,execution_policy_json
          FROM annual_bid_policy_documents WHERE rule_book_version=${row.rule_book_version}`),
      ]);
    const content = result.content;
    if (
      canonical(book) !==
        canonical({
          effective_year: year,
          notes: content.notes.bid,
          revision: row.rule_book_revision,
        }) ||
      canonical(template) !== canonical({ effective_year: year, notes: content.notes.positions })
    )
      return invalid();
    for (const entries of [rules, participation])
      if (
        entries.some(
          (entry) =>
            entry.templateVersion !== row.position_template_version ||
            entry.ruleBookVersion !== row.rule_book_version,
        )
      )
        return invalid();
    const stripAliases = ({
      templateVersion: _template,
      ruleBookVersion: _book,
      ...entry
    }: Record<string, unknown>) => entry;
    const stored = canonicalBidDefinition({
      ...content,
      positions: positions.map((position) => ({
        ...position,
        isFloating: flag(position.isFloating),
        isVacantByDesign: flag(position.isVacantByDesign),
        isExcludedFromCount: flag(position.isExcludedFromCount),
      })),
      rules: rules.map(stripAliases),
      participation: participation.map(stripAliases),
      staffingBindings: bindings,
    });
    if (!stored.ok || stored.serialized !== result.serialized) return invalid();
    if (content.policy === null) {
      if (row.policy_document_id !== null || documents.length !== 0) return invalid();
    } else {
      const document = documents[0];
      if (
        documents.length !== 1 ||
        !document ||
        document.id !== row.policy_document_id ||
        document.effective_year !== year ||
        document.policy_text !== content.policy.policyText ||
        canonical(JSON.parse(String(document.execution_policy_json))) !==
          canonical(content.policy.executionPolicy)
      )
        return invalid();
    }
    return { row, ...result, origin };
  } catch {
    return invalid();
  }
}

export async function loadBidDefinitionHead(database: D1Database, year: number) {
  return database
    .prepare('SELECT version_id AS versionId,revision FROM bid_definition_heads WHERE bid_year=?')
    .bind(year)
    .first<{ versionId: string; revision: number }>();
}
