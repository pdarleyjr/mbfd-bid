import {
  type BidDefinitionContent,
  type BidEvaluation,
  RetainedParticipationDerivationSchema,
} from '@mbfd/shared';
import { type JsonValue, canonicalize } from '../audit/canonical-json.js';
import { bidContentHash } from './bid-definition-content.js';
import {
  type BidEvidenceFreezeRow,
  evidenceFreezeDigests,
  evidenceSourceDigests,
} from './bid-evidence-freeze.js';
import type { BidEvaluationEvidence } from './bid-policy.js';
import {
  deriveFrozenReservedRetention,
  projectRetainedParticipationContent,
} from './retained-participation-derivation.js';

const canonical = (value: unknown) => canonicalize(JSON.parse(JSON.stringify(value)) as JsonValue);
const invalid = () => ({
  ok: false as const,
  code: 'retained_participation_derivation_invalid' as const,
});

/** The receipt cannot include its own digest. Every other field, including the
 * original freeze and source imports, remains in the material digest. */
export function retainedParticipationMaterialHash(content: BidDefinitionContent) {
  const material = structuredClone(content);
  if (material.settings?.v === 3 && material.settings.evidenceFreeze) {
    const { derivation: _derivation, ...freeze } = material.settings.evidenceFreeze;
    material.settings.evidenceFreeze = freeze;
  }
  return bidContentHash(canonical(material));
}

export type RetainedParticipationReceiptInput = {
  baseline: { id: string; sha256: string; content: BidDefinitionContent };
  source: BidEvidenceFreezeRow;
  original: BidEvaluation;
  recomputed: BidEvaluation;
  evidence: BidEvaluationEvidence;
};

/** Generate solely from an integrity-checked immutable baseline and original
 * source documents. A caller-supplied member list is never an authority input. */
export function createRetainedParticipationReceipt(input: RetainedParticipationReceiptInput) {
  let sourceDigests: ReturnType<typeof evidenceSourceDigests>;
  try {
    sourceDigests = evidenceSourceDigests(input.evidence);
  } catch {
    return invalid();
  }
  const freeze =
    input.baseline.content.settings?.v === 3
      ? input.baseline.content.settings.evidenceFreeze
      : undefined;
  if (
    !freeze ||
    freeze.derivation !== undefined ||
    freeze.freezeId !== input.source.id ||
    freeze.evaluationSha256 !== input.source.evaluation_sha256 ||
    freeze.sourceVersionId !== input.source.source_version_id ||
    freeze.sourceVersionSha256 !== input.source.source_version_sha256 ||
    freeze.personnelSnapshot.sha256 !== input.source.personnel_sha256 ||
    freeze.credentialSnapshot.sha256 !== input.source.credential_sha256 ||
    sourceDigests.personnelSha256 !== input.source.personnel_sha256 ||
    sourceDigests.credentialSha256 !== input.source.credential_sha256 ||
    freeze.evidenceCutoffAt !== input.source.cutoff_at ||
    freeze.timeZone !== input.source.time_zone ||
    freeze.personnelSnapshot.asOfAt !== input.source.cutoff_at ||
    freeze.credentialSnapshot.asOfAt !== input.source.cutoff_at ||
    freeze.personnelSnapshot.capturedAt !== new Date(input.source.captured_at).toISOString() ||
    freeze.credentialSnapshot.capturedAt !== new Date(input.source.captured_at).toISOString() ||
    Date.parse(freeze.approvedAt) < input.source.captured_at ||
    canonical(freeze.sourceImports) !== canonical(JSON.parse(input.source.source_imports_json)) ||
    evidenceFreezeDigests(input.original).evaluationSha256 !== input.source.evaluation_sha256 ||
    bidContentHash(canonical(input.baseline.content)) !== input.baseline.sha256
  )
    return invalid();
  const derived = deriveFrozenReservedRetention({
    original: input.original,
    recomputed: input.recomputed,
    approvedContent: input.baseline.content,
    evidence: input.evidence,
  });
  if (!derived.ok || derived.retainedMemberIds.length === 0) return invalid();
  const content = projectRetainedParticipationContent(
    input.baseline.content,
    derived.retainedMemberIds,
  );
  const receipt = RetainedParticipationDerivationSchema.parse({
    v: 1,
    method: 'VERIFIED_RESERVED_RETENTION',
    evaluatorRevision: 'reserved-retention-with-sealed-qualifications-v1',
    baselineVersionId: input.baseline.id,
    baselineVersionSha256: input.baseline.sha256,
    sourceFreezeId: input.source.id,
    sourceEvaluationSha256: input.source.evaluation_sha256,
    sourceVersionId: input.source.source_version_id,
    sourceVersionSha256: input.source.source_version_sha256,
    personnelSha256: input.source.personnel_sha256,
    credentialSha256: input.source.credential_sha256,
    materialSha256: retainedParticipationMaterialHash(content),
    derivedEvaluationSha256: evidenceFreezeDigests(derived.evaluation).evaluationSha256,
  });
  if (content.settings?.v !== 3 || !content.settings.evidenceFreeze) return invalid();
  content.settings.evidenceFreeze.derivation = receipt;
  return {
    ok: true as const,
    content,
    receipt,
    evaluation: derived.evaluation,
    retainedMemberIds: derived.retainedMemberIds,
  };
}

/** Reconstruct the proof on every preparation, never trust a receipt's claimed
 * derived digest or silently apply it to edited policy/material. */
export function verifyRetainedParticipationReceipt(
  input: RetainedParticipationReceiptInput & { content: BidDefinitionContent },
) {
  const receipt =
    input.content.settings?.v === 3 ? input.content.settings.evidenceFreeze?.derivation : undefined;
  const parsed = RetainedParticipationDerivationSchema.safeParse(receipt);
  if (!parsed.success) return invalid();
  const expected = createRetainedParticipationReceipt(input);
  if (
    !expected.ok ||
    canonical(expected.receipt) !== canonical(parsed.data) ||
    canonical(expected.content) !== canonical(input.content)
  )
    return invalid();
  return expected;
}
