import type { BidDefinitionContent } from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { canonicalBidDefinition } from './bid-definition-content.js';
import { bidDefinitionReferenceIssues } from './bid-definition-references.js';
import { captureBidDefinitionSource } from './bid-definition-source.js';
import type { SaveBidDefinitionInput } from './bid-definition-store.js';
import {
  type BidDefinitionVersionRow,
  loadBidDefinitionHead,
  loadBidDefinitionVersion,
} from './bid-definition-version.js';
import type { RuleBookCoverage } from './bid-policy.js';

const canonical = (value: unknown) => canonicalize(value as JsonValue);

export function bidVersionMetadata(row: BidDefinitionVersionRow) {
  return {
    id: row.id,
    versionNumber: row.version_number,
    contentSha256: row.content_sha256,
    createdAtMs: row.created_at,
    actorSubject: row.actor_subject,
    reason: row.reason,
    predecessorId: row.predecessor_id,
    restoredFromId: row.restored_from_id,
  };
}

/** Only named product fields cross HTTP; storage/control objects never do. */
export function bidDefinitionSummary(content: BidDefinitionContent, coverage: RuleBookCoverage) {
  return {
    coverage: {
      valid: coverage.valid,
      ruleCount: coverage.ruleCount,
      missingBiddablePositionIds: coverage.missingBiddablePositionIds,
      invalidPositionIds: coverage.invalidPositionIds,
      duplicatePositionIds: coverage.duplicatePositionIds,
      nonBiddablePositionIds: coverage.nonBiddablePositionIds,
      unexpectedPositionIds: coverage.unexpectedPositionIds,
    },
    stats: {
      opportunityCount: content.positions.length,
      ruleCount: coverage.ruleCount,
      biddableCount: coverage.expectedBiddablePositionIds.length,
      administrativelyAssignedCount: coverage.administrativelyAssignedPositionIds.length,
      reservedCount: coverage.reservedPositionIds.length,
      excludedCount: coverage.legacyExcludedPositionIds.length,
      missingRuleCount: coverage.missingBiddablePositionIds.length,
    },
  };
}

export async function loadCurrentBidDefinition(database: D1Database, year: number) {
  const head = await loadBidDefinitionHead(database, year);
  if (head) {
    const version = await loadBidDefinitionVersion(database, year, head.versionId);
    if (!version.ok) return version;
    const after = await loadBidDefinitionHead(database, year);
    if (
      after?.versionId !== head.versionId ||
      after.revision !== head.revision ||
      version.row.version_number !== head.revision
    )
      return { ok: false as const, error: 'bid_definition_or_source_changed' };
    return {
      ok: true as const,
      response: {
        bidYear: year,
        state: 'VERSIONED' as const,
        version: bidVersionMetadata(version.row),
        content: version.content,
        expected: {
          kind: 'version' as const,
          versionId: head.versionId,
          revision: head.revision,
          sha256: version.sha256,
        },
        ...bidDefinitionSummary(version.content, version.coverage),
      },
    };
  }
  const source = await captureBidDefinitionSource(database, year);
  if (!source.ok) return source;
  if (await loadBidDefinitionHead(database, year))
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  return {
    ok: true as const,
    response: {
      bidYear: year,
      state: 'LEGACY_UNADOPTED' as const,
      version: null,
      content: source.content,
      expected: { kind: 'legacy' as const, sourceToken: source.sourceToken },
      ...bidDefinitionSummary(source.content, source.coverage),
    },
  };
}

function keyedDiff<T>(before: T[], after: T[], key: (value: T) => string) {
  const left = new Map(before.map((value) => [key(value), canonical(value)]));
  const right = new Map(after.map((value) => [key(value), canonical(value)]));
  return {
    addedIds: [...right.keys()].filter((id) => !left.has(id)).sort(),
    removedIds: [...left.keys()].filter((id) => !right.has(id)).sort(),
    changedIds: [...right.keys()]
      .filter((id) => left.has(id) && left.get(id) !== right.get(id))
      .sort(),
  };
}

export function bidDefinitionDiff(before: BidDefinitionContent, after: BidDefinitionContent) {
  return {
    positions: keyedDiff(before.positions, after.positions, (row) => row.id),
    rules: keyedDiff(before.rules, after.rules, (row) => row.positionId),
    participation: keyedDiff(before.participation, after.participation, (row) => row.positionId),
    staffingBindings: keyedDiff(
      before.staffingBindings,
      after.staffingBindings,
      (row) => row.positionId,
    ),
    sourceDecisions: keyedDiff(before.sourceDecisions, after.sourceDecisions, (row) => row.issueId),
    changedSections: (['settings', 'notes', 'policy', 'planning', 'authoring'] as const).filter(
      (section) => canonical(before[section]) !== canonical(after[section]),
    ),
  };
}

export async function previewBidDefinition(
  database: D1Database,
  year: number,
  input: {
    expected: SaveBidDefinitionInput['expected'];
    intent: SaveBidDefinitionInput['intent'];
  },
) {
  const current = await loadCurrentBidDefinition(database, year);
  if (!current.ok) return current;
  if (canonical(current.response.expected) !== canonical(input.expected))
    return { ok: false as const, error: 'bid_definition_or_source_changed' };
  const mockReadiness = {
    status: 'NOT_EVALUATED' as const,
    code: 'saved_version_required_for_mock_preview',
  };
  const candidate =
    input.intent.operation === 'restore'
      ? await loadBidDefinitionVersion(database, year, input.intent.versionId)
      : canonicalBidDefinition(input.intent.content);
  if (!candidate.ok) {
    if ('error' in candidate) return candidate;
    return {
      ok: true as const,
      response: { valid: false as const, issues: candidate.issues, mockReadiness },
    };
  }
  const issues = await bidDefinitionReferenceIssues(database, candidate.content);
  if (candidate.content.bidYear !== year)
    issues.push({
      path: ['bidYear'],
      code: 'bid_definition_year_mismatch',
      message: 'The definition belongs to another Bid year',
    });
  if (issues.length)
    return { ok: true as const, response: { valid: false as const, issues, mockReadiness } };
  return {
    ok: true as const,
    response: {
      valid: true as const,
      content: candidate.content,
      contentSha256: candidate.sha256,
      ...bidDefinitionSummary(candidate.content, candidate.coverage),
      diff: bidDefinitionDiff(current.response.content, candidate.content),
      wouldCreateVersion:
        input.intent.operation === 'restore' ||
        current.response.state === 'LEGACY_UNADOPTED' ||
        canonical(current.response.content) !== candidate.serialized,
      mockReadiness,
    },
  };
}
