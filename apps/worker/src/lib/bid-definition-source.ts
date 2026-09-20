import { type BidDefinitionIssue, BidDefinitionProvenanceSchema } from '@mbfd/shared';
import { z } from 'zod';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { bidContentHash, canonicalBidDefinition } from './bid-definition-content.js';

/** Every scalar source that lacks a global source-revision trigger is also
 * compared before and after capture. Profile and document payloads are included
 * so their legacy replacement gaps cannot produce a mixed capture. */
const CONTROL_SQL = `SELECT y.year, y.configuration_revision AS configurationRevision,
  y.rule_book_version AS ruleBookVersion, y.position_template_version AS positionTemplateVersion,
  y.config_json AS settingsJson, y.annual_policy_document_id AS policyDocumentId,
  b.effective_year AS ruleYear, b.revision AS ruleBookRevision, b.status AS ruleBookStatus, b.notes AS bidNotes,
  t.effective_year AS templateYear, t.notes AS positionNotes,
  p.id AS documentId, p.revision AS documentRevision, p.status AS documentStatus,
  p.effective_year AS documentYear, p.rule_book_version AS documentBook,
  p.policy_text AS policyText, p.execution_policy_json AS executionPolicyJson,
  r.effective_on AS effectiveOn, r.revision AS planningRevision,
  r.source_session_id AS sourceSessionId, r.source_policy_text AS sourcePolicyText,
  profile.revision AS profileRevision, profile.rule_revision AS profileRuleRevision,
  profile.profiles_json AS profilesJson, profile.compiled_json AS compiledJson,
  source.snapshot_json AS selectedSourceSnapshotJson,
  (SELECT revision FROM annual_source_revision WHERE id=1) AS sourceRevision
  FROM bid_years y LEFT JOIN rule_books b ON b.version=y.rule_book_version
  LEFT JOIN position_templates t ON t.version=y.position_template_version
  LEFT JOIN annual_bid_policy_documents p ON p.id=y.annual_policy_document_id
  LEFT JOIN annual_plan_reviews r ON r.bid_year=y.year
  LEFT JOIN annual_rule_profile_revisions profile ON profile.bid_year=y.year
    AND profile.revision=(SELECT MAX(latest.revision) FROM annual_rule_profile_revisions latest WHERE latest.bid_year=y.year)
  LEFT JOIN bid_session_policy_snapshots source ON source.bid_session_id=r.source_session_id
  WHERE y.year=?`;

const Revision = z.number().int().nonnegative();
const ControlSchema = z
  .object({
    year: z.number().int(),
    configurationRevision: Revision,
    sourceRevision: Revision,
    ruleBookVersion: z.string().nullable(),
    positionTemplateVersion: z.string().nullable(),
    ruleBookRevision: Revision.nullable(),
    ruleBookStatus: z.enum(['draft', 'active', 'archived']).nullable(),
    ruleYear: z.number().int().nullable(),
    templateYear: z.number().int().nullable(),
    settingsJson: z.string().nullable(),
    bidNotes: z.string().nullable(),
    positionNotes: z.string().nullable(),
    policyDocumentId: z.string().nullable(),
    documentId: z.string().nullable(),
    documentRevision: Revision.nullable(),
    documentStatus: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED']).nullable(),
    documentYear: z.number().int().nullable(),
    documentBook: z.string().nullable(),
    policyText: z.string().nullable(),
    executionPolicyJson: z.string().nullable(),
    effectiveOn: z.string().nullable(),
    planningRevision: Revision.nullable(),
    sourceSessionId: z.string().nullable(),
    sourcePolicyText: z.string().nullable(),
    profileRevision: Revision.nullable(),
    profileRuleRevision: Revision.nullable(),
    profilesJson: z.string().nullable(),
    compiledJson: z.string().nullable(),
    selectedSourceSnapshotJson: z.string().nullable(),
  })
  .strict();

const CompiledSchema = z.array(
  z
    .object({
      rule: z
        .object({
          positionId: z.string().min(1),
          ruleBookVersion: z.string().min(1),
          requiredCriteria: z.unknown(),
          pointsPreference: z.unknown(),
          tieBreakChain: z.unknown(),
        })
        .strict(),
      provenance: BidDefinitionProvenanceSchema,
    })
    .strict(),
);

type RuleRow = {
  positionId: string;
  templateVersion: string;
  requiredCriteriaJson: string;
  pointsPreferenceJson: string;
  tieBreakChainJson: string;
  notes: string | null;
};
type ParticipationRow = {
  positionId: string;
  templateVersion: string;
  bidParticipation: string;
  authoritativeSourceRef: string;
};
type PositionRow = {
  id: string;
  shift: string;
  station: string;
  division: string;
  unit: string;
  rankRequired: string;
  positionName: string;
  isFloating: number;
  isVacantByDesign: number;
  isExcludedFromCount: number;
};
type SourceFailure = {
  ok: false;
  error: 'bid_year_not_found' | 'bid_definition_source_invalid' | 'bid_definition_source_changed';
  issues?: BidDefinitionIssue[];
};
const invalid = (issues: BidDefinitionIssue[]): SourceFailure => ({
  ok: false,
  error: 'bid_definition_source_invalid',
  issues,
});
const issue = (path: string, code: string, message: string): BidDefinitionIssue => ({
  path: [path],
  code,
  message,
});
const booleanFlag = (flag: number) => (flag === 0 ? false : flag === 1 ? true : flag);

/** Server-created predicate for the first statement of a material transaction.
 * Exact control values cover legacy sources without revision triggers. Never
 * accept this SQL or its parameters from an API request. */
function controlGuard(year: number, control: z.infer<typeof ControlSchema>) {
  const entries = Object.entries(control);
  return {
    sql: `EXISTS(SELECT 1 FROM (${CONTROL_SQL}) captured WHERE ${entries
      .map(([key]) => `captured.${key} IS ?`)
      .join(' AND ')})`,
    parameters: [year, ...entries.map(([, value]) => value)],
    token: bidContentHash(canonicalize(control as JsonValue)),
  };
}

export async function captureBidDefinitionControl(database: D1Database, year: number) {
  const row = await database.prepare(CONTROL_SQL).bind(year).first();
  const parsed = ControlSchema.safeParse(row);
  return parsed.success ? controlGuard(year, parsed.data) : null;
}

/** Read the currently designated legacy Bid into one typed, canonical source.
 * No year retargeting, rule compilation, source approval, or database write.
 * This is the adoption input; existing version loads must read their own
 * immutable material instead of calling this mutable-year adapter. */
export async function captureBidDefinitionSource(database: D1Database, year: number) {
  const before = await database.prepare(CONTROL_SQL).bind(year).first();
  if (before === null) return { ok: false, error: 'bid_year_not_found' } satisfies SourceFailure;
  const checked = ControlSchema.safeParse(before);
  if (!checked.success)
    return invalid(
      checked.error.issues.map((entry) => ({
        path: entry.path,
        code: entry.code,
        message: entry.message,
      })),
    );
  const source = checked.data;
  const issues: BidDefinitionIssue[] = [];
  if (
    source.ruleBookVersion !== null &&
    (source.ruleYear !== year || source.ruleBookRevision === null)
  )
    issues.push(
      issue(
        'ruleBookVersion',
        'designated_book_invalid',
        'Designated rule book is missing or belongs to another year',
      ),
    );
  if (source.positionTemplateVersion !== null && source.templateYear !== year)
    issues.push(
      issue(
        'positionTemplateVersion',
        'designated_template_invalid',
        'Designated positions are missing or belong to another year',
      ),
    );
  if (
    source.policyDocumentId !== null &&
    (source.documentId !== source.policyDocumentId ||
      source.documentYear !== year ||
      source.documentBook !== source.ruleBookVersion)
  )
    issues.push(
      issue(
        'policy',
        'designated_document_invalid',
        'Designated source document does not match the Bid year and book',
      ),
    );
  if (issues.length) return invalid(issues);

  const [rules, positions, participation, bindings, decisions] = await Promise.all([
    database
      .prepare(`SELECT position_id AS positionId,template_version AS templateVersion,
      required_criteria AS requiredCriteriaJson,points_preference AS pointsPreferenceJson,
      tie_break_chain AS tieBreakChainJson,notes FROM position_rules WHERE rule_book_version=?`)
      .bind(source.ruleBookVersion)
      .all<RuleRow>(),
    database
      .prepare(`SELECT id,shift,station,division,unit,rank_required AS rankRequired,
      position_name AS positionName,is_floating AS isFloating,is_vacant_by_design AS isVacantByDesign,
      is_excluded_from_count AS isExcludedFromCount FROM positions WHERE template_version=?`)
      .bind(source.positionTemplateVersion)
      .all<PositionRow>(),
    database
      .prepare(`SELECT position_id AS positionId,template_version AS templateVersion,
      bid_participation AS bidParticipation,authoritative_source_ref AS authoritativeSourceRef
      FROM rule_book_position_participation WHERE rule_book_version=?`)
      .bind(source.ruleBookVersion)
      .all<ParticipationRow>(),
    database
      .prepare(`SELECT position_id AS positionId,staffing_position_id AS staffingPositionId,
      authoritative_source_ref AS authoritativeSourceRef,review_status AS reviewStatus
      FROM position_staffing_bindings WHERE template_version=?`)
      .bind(source.positionTemplateVersion)
      .all(),
    database
      .prepare(`SELECT d.issue_id AS issueId,d.title,d.question,d.area,d.status,d.decision,
      d.source_ref AS sourceRef,d.effective_on AS effectiveOn,d.revision FROM bid_source_decisions d
      WHERE d.bid_year=? AND d.revision=(SELECT MAX(r.revision) FROM bid_source_decisions r
        WHERE r.bid_year=d.bid_year AND r.issue_id=d.issue_id)`)
      .bind(year)
      .all<Record<string, unknown> & { issueId: string; revision: number }>(),
  ]);
  const after = await database.prepare(CONTROL_SQL).bind(year).first();
  if (JSON.stringify(before) !== JSON.stringify(after))
    return { ok: false, error: 'bid_definition_source_changed' } satisfies SourceFailure;
  for (const [field, rows] of [
    ['rules', rules.results],
    ['participation', participation.results],
  ] as const) {
    rows.forEach((row, index) => {
      if (row.templateVersion !== source.positionTemplateVersion)
        issues.push({
          path: [field, index, 'templateVersion'],
          code: 'foreign_template',
          message: 'Book material references a different position template',
        });
    });
  }
  if (issues.length) return invalid(issues);
  try {
    const compiled =
      source.compiledJson === null ? null : CompiledSchema.parse(JSON.parse(source.compiledJson));
    const authoring =
      source.profileRevision === null
        ? null
        : {
            profiles: JSON.parse(source.profilesJson ?? 'null'),
            compiled: compiled?.map((entry) => ({
              rule: {
                positionId: entry.rule.positionId,
                requiredCriteriaJson: JSON.stringify(entry.rule.requiredCriteria),
                pointsPreferenceJson: JSON.stringify(entry.rule.pointsPreference),
                tieBreakChainJson: JSON.stringify(entry.rule.tieBreakChain),
                notes: null,
              },
              provenance: entry.provenance,
            })),
            // Reconciliation cannot be reset by minting an unrelated revision-zero book.
            reconciliation:
              source.profileRuleRevision === source.ruleBookRevision
                ? 'MATCHES_CAPTURED_RULE_REVISION'
                : 'RULES_CHANGED_AFTER_COMPILATION',
          };
    const result = canonicalBidDefinition({
      v: 1,
      bidYear: year,
      settings:
        source.settingsJson === null || source.settingsJson === ''
          ? null
          : JSON.parse(source.settingsJson),
      notes: { bid: source.bidNotes, positions: source.positionNotes },
      policy:
        source.documentId === null
          ? null
          : {
              policyText: source.policyText,
              executionPolicy: JSON.parse(source.executionPolicyJson ?? 'null'),
            },
      planning:
        source.planningRevision === null
          ? null
          : {
              effectiveOn: source.effectiveOn,
              sourceSessionId: source.sourceSessionId,
              sourcePolicyText: source.sourcePolicyText,
            },
      authoring,
      positions: positions.results.map((row) => ({
        ...row,
        isFloating: booleanFlag(row.isFloating),
        isVacantByDesign: booleanFlag(row.isVacantByDesign),
        isExcludedFromCount: booleanFlag(row.isExcludedFromCount),
      })),
      rules: rules.results.map(({ templateVersion: _template, ...row }) => row),
      participation: participation.results.map(({ templateVersion: _template, ...row }) => row),
      staffingBindings: bindings.results,
      sourceDecisions: decisions.results.map(({ revision: _revision, ...row }) => row),
    });
    if (!result.ok) return invalid(result.issues);
    return {
      ...result,
      sourceToken: bidContentHash(`${result.sha256}:${controlGuard(year, source).token}`),
      sourceGuard: controlGuard(year, source),
      origin: {
        ruleBookVersion: source.ruleBookVersion,
        positionTemplateVersion: source.positionTemplateVersion,
        ruleBookRevision: source.ruleBookRevision,
        configurationRevision: source.configurationRevision,
        sourceRevision: source.sourceRevision,
        ruleBookStatus: source.ruleBookStatus,
        policyDocumentId: source.documentId,
        policyDocumentRevision: source.documentRevision,
        policyDocumentStatus: source.documentStatus,
        profileRevision: source.profileRevision,
        profileRuleRevision: source.profileRuleRevision,
        planningRevision: source.planningRevision,
        // A byte hash identifies selected source evidence. It does not claim
        // official completion or approval; the existing Live gates verify that.
        selectedSourceSnapshotSha256:
          source.selectedSourceSnapshotJson === null
            ? null
            : bidContentHash(source.selectedSourceSnapshotJson),
        sourceDecisionRevisions: decisions.results.map((row) => ({
          issueId: row.issueId,
          revision: row.revision,
        })),
      },
    };
  } catch {
    return invalid([
      issue(
        'content',
        'malformed_source_material',
        'Persisted JSON or authoring provenance cannot be decoded',
      ),
    ]);
  }
}
