import { BidConfigurationSettingsSchema } from '@mbfd/shared';
import { ulid } from 'ulid';
import { replayAnnualPlanMutation } from './annual-plan-mutation.js';
import { auditInsertStatement } from './audit.js';
import { parseBidConfigurationSettings } from './bid-policy.js';

/** A new designation, never an edit to the approved book or its evidence. */
export async function createAnnualPlanSuccessor(
  database: D1Database,
  input: {
    year: number;
    key: string;
    actorSubject: string;
    actorId: number | null;
    body: {
      expected_rule_revision: number;
      expected_configuration_revision: number;
      expected_source_revision: number;
      effective_on: string;
      credential_evaluation_on: string;
      expected_duration_days: number;
      turn_timer_seconds: number;
      reason: string;
      accept_successor: true;
    };
  },
) {
  const operation = 'create-successor-setup';
  const intent = { ...input, operation, request: input.body };
  const previous = await replayAnnualPlanMutation(database, intent);
  if (previous) return previous;
  const old = await database.prepare('SELECT * FROM bid_years WHERE year=?').bind(input.year).first<
    {
      rule_book_version: string;
      position_template_version: string;
      annual_policy_document_id: string | null;
      config_json: string;
      configuration_revision: number;
    } & Record<string, unknown>
  >();
  const settings = parseBidConfigurationSettings(old?.config_json ?? null);
  if (!old?.rule_book_version || !old.position_template_version || !settings)
    return { ok: false as const, error: 'approved_configuration_required' };
  const real = await database
    .prepare('SELECT id FROM bid_sessions WHERE bid_year=? AND is_mock=0 LIMIT 1')
    .bind(input.year)
    .first();
  if (real) return { ok: false as const, error: 'real_session_exists_use_authorized_amendment' };
  const review = await database
    .prepare('SELECT * FROM annual_plan_reviews WHERE bid_year=?')
    .bind(input.year)
    .first();
  const book = await database
    .prepare('SELECT * FROM rule_books WHERE version=?')
    .bind(old.rule_book_version)
    .first();
  const now = Date.now();
  const version = `${input.year}.${now}`;
  const policyId = old.annual_policy_document_id ? ulid() : null;
  const nextSettings = BidConfigurationSettingsSchema.parse({
    ...settings,
    v: settings.v === 3 ? 3 : 2,
    personnelEvaluationOn: input.body.effective_on,
    credentialEvaluationOn: input.body.credential_evaluation_on,
    expectedDurationDays: input.body.expected_duration_days,
    turnTimerSeconds: input.body.turn_timer_seconds,
  });
  const response = {
    year: input.year,
    lifecycle: 'DRAFT',
    ruleBookVersion: version,
    templateVersion: version,
    annualPolicyDocumentId: policyId,
    effectiveOn: input.body.effective_on,
    predecessor: { configuration: old, review, ruleBook: book },
    notice:
      'Previous approval preserved. Review copied positions, staffing links, policy and practice before approving this draft.',
  };
  const inherited = `inherited-unreviewed:successor:${old.rule_book_version}`;
  try {
    await database.batch([
      database
        .prepare(`INSERT INTO annual_plan_receipts (idempotency_key,actor_subject,request_json,response_json,created_at)
        SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM bid_years y JOIN rule_books b ON b.version=y.rule_book_version
          WHERE y.year=? AND y.status='configuring' AND b.status='active' AND b.version=? AND b.revision=?
          AND y.position_template_version=? AND y.configuration_revision=?
          AND (SELECT revision FROM annual_source_revision WHERE id=1)=?
          AND NOT EXISTS(SELECT 1 FROM bid_sessions s WHERE s.bid_year=y.year AND s.is_mock=0))
          THEN ? ELSE NULL END,?,?,?`)
        .bind(
          input.key,
          input.year,
          old.rule_book_version,
          input.body.expected_rule_revision,
          old.position_template_version,
          input.body.expected_configuration_revision,
          input.body.expected_source_revision,
          input.actorSubject,
          JSON.stringify({ year: input.year, operation, body: input.body }),
          JSON.stringify(response),
          now,
        ),
      database
        .prepare('INSERT INTO position_templates (version,effective_year,notes) VALUES (?,?,?)')
        .bind(
          version,
          input.year,
          `Successor of ${old.position_template_version}: ${input.body.reason}`,
        ),
      database
        .prepare(
          "INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES (?,?,'draft',0,?)",
        )
        .bind(version, input.year, `Successor of ${old.rule_book_version}: ${input.body.reason}`),
      database
        .prepare(`INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count)
        SELECT id,?,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count FROM positions WHERE template_version=?`)
        .bind(version, old.position_template_version),
      database
        .prepare(`INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
        SELECT ?,position_id,?,required_criteria,points_preference,tie_break_chain,notes FROM position_rules WHERE rule_book_version=? AND template_version=?`)
        .bind(version, version, old.rule_book_version, old.position_template_version),
      database
        .prepare(`INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
        SELECT ?,position_id,?,bid_participation,?,? FROM rule_book_position_participation WHERE rule_book_version=? AND template_version=?`)
        .bind(
          version,
          version,
          inherited,
          now,
          old.rule_book_version,
          old.position_template_version,
        ),
      database
        .prepare(`INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
        SELECT position_id,?,staffing_position_id,?,'draft',? FROM position_staffing_bindings WHERE template_version=?`)
        .bind(version, inherited, now, old.position_template_version),
      ...(policyId
        ? [
            database
              .prepare(`INSERT INTO annual_bid_policy_documents
        (id,rule_book_version,effective_year,revision,status,policy_text,execution_policy_json,created_by,created_at,updated_at,supersedes_document_id)
        SELECT ?,?,?,1,'DRAFT',policy_text,execution_policy_json,?,?,?,id FROM annual_bid_policy_documents WHERE id=?`)
              .bind(
                policyId,
                version,
                input.year,
                input.actorId,
                now,
                now,
                old.annual_policy_document_id,
              ),
          ]
        : []),
      database
        .prepare(`INSERT INTO annual_plan_reviews (bid_year,effective_on,source_policy_text,created_at)
        VALUES (?,?,(SELECT policy_text FROM annual_bid_policy_documents WHERE id=?),?)
        ON CONFLICT(bid_year) DO UPDATE SET effective_on=excluded.effective_on,revision=annual_plan_reviews.revision+1,
          reviewed_source_revision=NULL,reviewed_rule_revision=NULL,reviewed_configuration_revision=NULL,
          source_policy_text=excluded.source_policy_text`)
        .bind(input.year, input.body.effective_on, policyId, now),
      database
        .prepare(`UPDATE bid_years SET rule_book_version=?,position_template_version=?,annual_policy_document_id=?,
        config_json=?,configuration_revision=configuration_revision+1 WHERE year=?`)
        .bind(version, version, policyId, JSON.stringify(nextSettings), input.year),
      // Keep profiles and their provenance without compiling over advanced individual rules.
      database
        .prepare(`INSERT INTO annual_rule_profile_revisions (bid_year,revision,rule_revision,profiles_json,compiled_json,actor_subject,reason,created_at)
        SELECT bid_year,revision+1,(SELECT revision FROM rule_books WHERE version=?),profiles_json,compiled_json,?,?,?
        FROM annual_rule_profile_revisions WHERE bid_year=? ORDER BY revision DESC LIMIT 1`)
        .bind(
          version,
          input.actorSubject,
          `Copied for successor review: ${input.body.reason}`,
          now,
          input.year,
        ),
      auditInsertStatement(database, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: input.actorId,
        action: 'bid_configuration_set',
        targetKind: 'bid_year',
        targetId: String(input.year),
        reason: input.body.reason,
        beforeState: old,
        afterState: response,
        clientMeta: { operation, annual_plan_key: input.key },
      }),
    ]);
    return { ok: true as const, replayed: false, response };
  } catch {
    return (
      (await replayAnnualPlanMutation(database, intent)) ?? {
        ok: false as const,
        error: 'annual_plan_or_source_changed',
      }
    );
  }
}
