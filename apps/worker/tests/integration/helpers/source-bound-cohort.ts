import {
  type BidDefinitionContent,
  BidDefinitionContentSchema,
  type BidEvaluation,
  BidEvaluationSchema,
  type BidSessionPolicySnapshot,
} from '@mbfd/shared';
import { getDb } from '../../../src/db/index.js';
import { app } from '../../../src/index.js';
import { definitionRuleBookMaterial } from '../../../src/lib/bid-definition-content.js';
import { compileBidDefinitionStagePolicy } from '../../../src/lib/bid-definition-context.js';
import { captureBidDefinitionSource } from '../../../src/lib/bid-definition-source.js';
import { loadBidDefinitionVersion } from '../../../src/lib/bid-definition-version.js';
import { evidenceFreezeDigests } from '../../../src/lib/bid-evidence-freeze.js';
import { encodeBidEvidenceDocument } from '../../../src/lib/bid-evidence-storage.js';
import { loadFrozenSessionBidPolicy } from '../../../src/lib/bid-policy.js';
import { signJwt } from '../../../src/lib/jwt.js';
import type { WorkerEnv } from '../../../src/types/env.js';

export interface CohortFixtureInput {
  kind: 'PSEUDONYMIZED_SEALED_V11';
  sourceDefinitionSha256: string;
  sourceEvaluationSha256: string;
  definition: BidDefinitionContent;
  evaluation: BidEvaluation;
  sourceFreeze: {
    evaluation_sha256: string;
    personnel_sha256: string;
    credential_sha256: string;
    personnel_source_json: string;
    credential_source_json: string;
    source_imports_json: string;
    captured_at: number;
    source_token: string;
  };
}

/** Local fixture only. These transport identities mirror sealed normalized
 * facts; they do not substitute a current Department source. The evaluator's
 * employee-ID overrides are never rerun and omitted qualification holds are
 * never reconstructed. Production input bytes remain outside the repository. */
export async function prepareSourceBoundCohort(env: WorkerEnv, input: CohortFixtureInput) {
  if (input.kind !== 'PSEUDONYMIZED_SEALED_V11') throw new Error('source_cohort_kind_invalid');
  const content = BidDefinitionContentSchema.parse(structuredClone(input.definition));
  const evaluation = BidEvaluationSchema.parse(structuredClone(input.evaluation));
  if (input.sourceEvaluationSha256 !== input.sourceFreeze.evaluation_sha256)
    throw new Error('source_cohort_authority_digest_invalid');
  if (content.settings?.v !== 3 || content.policy === null || evaluation.settings.v !== 3)
    throw new Error('source_cohort_annual_policy_required');
  const originalFreezeBinding = content.settings.evidenceFreeze;
  if (!originalFreezeBinding) throw new Error('source_cohort_sealed_binding_required');
  const { evidenceFreeze: _sourceBinding, ...settings } = content.settings;
  content.settings = settings;
  const cutoffDecision = content.sourceDecisions.find(
    (decision) => decision.issueId === '2026-eligibility-cutoff-evidence',
  );
  if (!cutoffDecision) throw new Error('source_cohort_cutoff_decision_required');
  content.sourceDecisions = content.sourceDecisions.filter(
    (decision) => decision.issueId !== cutoffDecision.issueId,
  );
  const grants = content.policy.executionPolicy.actionPermissions.map(
    (permission) => new Set(permission.actorMemberIds),
  );
  const actor = [...(grants[0] ?? [])].find((id) => grants.every((grant) => grant.has(id)));
  if (!actor || !evaluation.members.some((member) => member.memberId === actor))
    throw new Error('source_cohort_reviewed_operator_required');

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO position_templates(version,effective_year) VALUES ('local-source-bootstrap',2026)",
    ),
    env.DB.prepare(
      "INSERT INTO rule_books(version,effective_year,status,revision) VALUES ('local-source-bootstrap',2026,'draft',0)",
    ),
    env.DB.prepare(`INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json)
      VALUES (2026,'configuring','local-source-bootstrap','local-source-bootstrap',1,?)
      ON CONFLICT(year) DO UPDATE SET rule_book_version=excluded.rule_book_version,
        position_template_version=excluded.position_template_version,
        configuration_revision=excluded.configuration_revision,config_json=excluded.config_json
      WHERE bid_years.status='configuring' AND bid_years.rule_book_version IS NULL
        AND bid_years.position_template_version IS NULL`).bind(JSON.stringify(settings)),
  ]);
  const seeds: D1PreparedStatement[] = [];
  for (const position of content.positions) {
    seeds.push(
      env.DB.prepare(`INSERT INTO positions
        (id,template_version,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count)
        VALUES (?,'local-source-bootstrap',?,?,?,?,?,?,?,?,?)`).bind(
        position.id,
        position.shift,
        position.station,
        position.division,
        position.unit,
        position.rankRequired,
        position.positionName,
        position.isFloating ? 1 : 0,
        position.isVacantByDesign ? 1 : 0,
        position.isExcludedFromCount ? 1 : 0,
      ),
    );
  }
  for (const rule of content.rules) {
    seeds.push(
      env.DB.prepare(`INSERT INTO position_rules
      (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES ('local-source-bootstrap',?,'local-source-bootstrap',?,?,?)`).bind(
        rule.positionId,
        rule.requiredCriteriaJson,
        rule.pointsPreferenceJson,
        rule.tieBreakChainJson,
      ),
    );
  }
  for (const participation of content.participation) {
    seeds.push(
      env.DB.prepare(`INSERT INTO rule_book_position_participation
      (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
      VALUES ('local-source-bootstrap',?,'local-source-bootstrap',?,?,1)`).bind(
        participation.positionId,
        participation.bidParticipation,
        participation.authoritativeSourceRef,
      ),
    );
  }
  for (const member of evaluation.members) {
    seeds.push(
      env.DB.prepare(`INSERT INTO members
      (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,employment_status,employment_status_effective_on,created_at,updated_at)
      VALUES (?,?,'Frozen',?,?,?,?,?,?,'active','2020-01-01',1,1)`).bind(
        member.memberId,
        `LOCAL-FROZEN-${member.memberId}`,
        `Member ${member.memberId}`,
        member.rank,
        member.rank === 'FF' ? 'FF' : 'OFC',
        member.rscSeniority,
        member.rankSeniority,
        member.isProbationary ? 1 : 0,
      ),
    );
  }
  for (const [index, name] of (evaluation.authoringCredentialNames ?? []).entries())
    seeds.push(
      env.DB.prepare('INSERT INTO credentials(id,name) VALUES (?,?)').bind(800001 + index, name),
    );
  for (const binding of content.staffingBindings) {
    const position = content.positions.find((row) => row.id === binding.positionId);
    if (!position) throw new Error('source_cohort_binding_position_missing');
    seeds.push(
      env.DB.prepare(`INSERT INTO staffing_positions
      (id,stable_slot_key,shift,station,unit,position_name,applicable_rank,active_from,review_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'2020-01-01','approved',1,1)`).bind(
        binding.staffingPositionId,
        `local-source/${position.id}`,
        position.shift,
        position.station,
        position.unit,
        position.positionName,
        position.rankRequired,
      ),
    );
  }
  for (let index = 0; index < seeds.length; index += 40)
    await env.DB.batch(seeds.slice(index, index + 40));
  const token = await signJwt(
    {
      sub: actor,
      hub_user_id: actor,
      member_id: actor,
      security_version: 1,
      authz_checked_at: Math.floor(Date.now() / 1000),
      emp: `LOCAL-FROZEN-${actor}`,
      role: 'admin',
      rank: 'LT',
      first_name: 'Frozen',
      last_name: 'Operator',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    env.JWT_SIGNING_KEY,
  );
  let nextKey = 0;
  async function request(path: string, body?: unknown) {
    return app.fetch(
      new Request(`https://local.engineering.invalid/api/admin/${path}`, {
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `local-source-cohort-${++nextKey}`,
        },
      }),
      env,
    );
  }
  const captured = await captureBidDefinitionSource(env.DB, 2026);
  if (!captured.ok)
    throw new Error(`source_cohort_bootstrap_capture_failed:${JSON.stringify(captured)}`);
  const baselineResponse = await request('bid/2026/versions', {
    content,
    expected: { kind: 'legacy', sourceToken: captured.sourceToken },
    reason: 'Isolated source-bound pseudonym identity transport baseline',
  });
  if (baselineResponse.status !== 201)
    throw new Error(`source_cohort_baseline_save_failed:${await baselineResponse.text()}`);
  const baseline = (await baselineResponse.json()) as {
    versionId: string;
    contentSha256: string;
    versionNumber: number;
  };
  const loaded = await loadBidDefinitionVersion(env.DB, 2026, baseline.versionId);
  if (!loaded.ok) throw new Error('source_cohort_baseline_load_failed');
  const compiled = compileBidDefinitionStagePolicy({ pinnedEvaluation: evaluation, content });
  if (!compiled.ok || !('executionPolicy' in compiled))
    throw new Error('source_cohort_stage_compile_failed');
  evaluation.settings = { ...settings, livePolicy: compiled.executionPolicy };
  evaluation.ruleBookVersion = loaded.row.rule_book_version;
  evaluation.positionTemplateVersion = loaded.row.position_template_version;
  evaluation.ruleBookMaterial = definitionRuleBookMaterial(
    loaded.content,
    evaluation.ruleBookVersion,
    evaluation.positionTemplateVersion,
  );
  // Seal exactly the normalized envelope that the production reader verifies.
  // The immutable member facts were parsed before transport; only local
  // version/settings identifiers above change for the owned engineering pin.
  const localEvaluation = BidEvaluationSchema.parse(evaluation);
  if (JSON.stringify(localEvaluation.members) !== JSON.stringify(evaluation.members))
    throw new Error('source_cohort_normalized_member_facts_changed');
  const digests = evidenceFreezeDigests(localEvaluation);
  const freezeId = 'LOCAL_SOURCE_COHORT_V11_FREEZE';
  await env.DB.prepare(`INSERT INTO bid_evidence_freezes
    (id,bid_year,cutoff_at,time_zone,captured_at,actor_subject,source_version_id,source_version_sha256,source_token,
     evaluation_json,personnel_source_json,credential_source_json,evaluation_sha256,personnel_sha256,credential_sha256,source_imports_json)
    VALUES (?,2026,?,'America/New_York',?,'local-source-fixture',?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      freezeId,
      originalFreezeBinding.evidenceCutoffAt,
      input.sourceFreeze.captured_at,
      baseline.versionId,
      baseline.contentSha256,
      input.sourceFreeze.source_token,
      encodeBidEvidenceDocument(digests.evaluationJson),
      input.sourceFreeze.personnel_source_json,
      input.sourceFreeze.credential_source_json,
      digests.evaluationSha256,
      input.sourceFreeze.personnel_sha256,
      input.sourceFreeze.credential_sha256,
      input.sourceFreeze.source_imports_json,
    )
    .run();
  content.sourceDecisions.push(cutoffDecision);
  content.settings = {
    ...settings,
    evidenceFreeze: {
      ...originalFreezeBinding,
      freezeId,
      evaluationSha256: digests.evaluationSha256,
      sourceVersionId: baseline.versionId,
      sourceVersionSha256: baseline.contentSha256,
    },
  };
  const savedResponse = await request('bid/2026/versions', {
    content,
    expected: {
      kind: 'version',
      versionId: baseline.versionId,
      revision: baseline.versionNumber,
      sha256: baseline.contentSha256,
    },
    reason: 'Isolated source-bound sealed normalized V11 cohort with reversible identities',
  });
  if (savedResponse.status !== 201)
    throw new Error(`source_cohort_sealed_save_failed:${await savedResponse.text()}`);
  const saved = (await savedResponse.json()) as { versionId: string; contentSha256: string };
  const selection = { versionId: saved.versionId, versionSha256: saved.contentSha256 };
  const previewResponse = await request('bid/2026/preview', { kind: 'mock', ...selection });
  const preview = (await previewResponse.json()) as {
    contextSha256?: string;
    runtimeSourceToken?: string;
    error?: string;
  };
  if (previewResponse.status !== 200 || !preview.contextSha256 || !preview.runtimeSourceToken)
    throw new Error(`source_cohort_preview_failed:${JSON.stringify(preview)}`);
  const createdResponse = await request('bid/2026/mock-sessions', {
    ...selection,
    expectedContextSha256: preview.contextSha256,
    expectedSourceToken: preview.runtimeSourceToken,
  });
  if (createdResponse.status !== 201)
    throw new Error(`source_cohort_create_failed:${await createdResponse.text()}`);
  const created = (await createdResponse.json()) as { id: string };
  const frozen = await loadFrozenSessionBidPolicy(getDb(env.DB), created.id);
  if (!frozen.ok || frozen.snapshot.v !== 3) throw new Error('source_cohort_created_pin_invalid');
  return {
    actor,
    token,
    request,
    sessionId: created.id,
    preview,
    saved,
    snapshot: frozen.snapshot as Extract<BidSessionPolicySnapshot, { v: 3 }>,
  };
}
