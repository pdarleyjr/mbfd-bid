import {
  type BidDefinitionContent,
  type BidSessionPolicySnapshot,
  FrozenAnnualPolicyEvidenceSchema,
} from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { bidContentHash, definitionRuleRows } from './bid-definition-content.js';
import type { BidDefinitionVersionRow } from './bid-definition-version.js';

type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;
const canonical = (value: unknown) => canonicalize(value as JsonValue);
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Identity of the frozen execution context, separate from policy content.
 * Clock time and minted aliases are excluded; an actual fallback evaluation
 * DATE is retained. Optional historical evidence remains absent, never empty.
 * Mock participation concessions are retained and cannot masquerade as Live.
 * Array ordering within evidence is preserved unless it is a documented set. */
export function bidDefinitionContextHash(snapshot: Snapshot) {
  const members = snapshot.members
    .map((member) => ({
      ...member,
      credentialNames: [...member.credentialNames].sort(),
      ...(member.scoringEvidence
        ? {
            scoringEvidence: {
              ...member.scoringEvidence,
              completedCredentialNames: [...member.scoringEvidence.completedCredentialNames].sort(),
            },
          }
        : {}),
    }))
    .sort((a, b) => a.memberId - b.memberId);
  return bidContentHash(
    canonical({
      v: 1,
      personnelEvaluationOn:
        snapshot.settings.v !== 1 && snapshot.settings.personnelEvaluationOn
          ? snapshot.settings.personnelEvaluationOn
          : new Date(snapshot.capturedAtMs).toISOString().slice(0, 10),
      credentialEvaluationOn: snapshot.credentialEvaluationOn ?? null,
      members,
      staffingBaseline: snapshot.staffingBaseline ?? null,
      tenureEvidence: snapshot.tenureEvidence ? [...snapshot.tenureEvidence].sort(byId) : null,
      authoringCredentialNames: snapshot.authoringCredentialNames
        ? [...snapshot.authoringCredentialNames].sort()
        : null,
      operatorIdentityProjection: snapshot.operatorIdentityProjection
        ? [...snapshot.operatorIdentityProjection].sort((a, b) => a.memberId - b.memberId)
        : null,
    }),
  );
}

/** Compare exact executable material to its version. Notes, source decisions
 * and authoring history remain in the authenticated content bundle; they do
 * not become invented evaluator inputs. No current-head lookup occurs. */
export function snapshotMatchesBidDefinition(
  snapshot: Snapshot,
  version: {
    row: BidDefinitionVersionRow;
    content: BidDefinitionContent;
  },
) {
  const { row, content } = version;
  if (
    snapshot.configurationRevision !== row.version_number ||
    canonical(snapshot.settings) !== canonical(content.settings)
  )
    return false;
  const participation = new Map(
    content.participation.map((entry) => [entry.positionId, entry.bidParticipation]),
  );
  const material = {
    v: 1,
    rules: definitionRuleRows(content, row.rule_book_version, row.position_template_version).map(
      ({ notes: _notes, ...rule }) => rule,
    ),
    positions: content.positions.map((position) => ({
      ...position,
      templateVersion: row.position_template_version,
      bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
    })),
  };
  const actual = {
    ...snapshot.ruleBookMaterial,
    rules: [...snapshot.ruleBookMaterial.rules].sort((a, b) =>
      byId({ id: a.positionId }, { id: b.positionId }),
    ),
    positions: [...snapshot.ruleBookMaterial.positions].sort(byId),
  };
  if (canonical(actual) !== canonical(material)) return false;
  const expectedEvidence = content.policy
    ? {
        documentId: row.policy_document_id,
        documentRevision: 1,
        ruleBookVersion: row.rule_book_version,
        executablePolicyRevision: content.policy.executionPolicy.policyRevision,
        policyText: content.policy.policyText,
      }
    : null;
  const normalizedEvidence =
    expectedEvidence === null ? null : FrozenAnnualPolicyEvidenceSchema.safeParse(expectedEvidence);
  if (normalizedEvidence !== null && !normalizedEvidence.success) return false;
  return (
    canonical(snapshot.annualPolicyEvidence ?? null) === canonical(normalizedEvidence?.data ?? null)
  );
}
