import { z } from 'zod';
import { auditInsertStatement } from './audit.js';

export const AnnualPlanExpectedSchema = z.object({
  expected_rule_revision: z.number().int().nonnegative(),
  expected_configuration_revision: z.number().int().nonnegative(),
  expected_source_revision: z.number().int().nonnegative(),
});

export async function replayAnnualPlanMutation(
  db: D1Database,
  input: { year: number; operation: string; request: unknown; key: string; actorSubject: string },
) {
  const request = JSON.stringify({
    year: input.year,
    operation: input.operation,
    body: input.request,
  });
  const row = await db
    .prepare(
      'SELECT actor_subject,request_json,response_json FROM annual_plan_receipts WHERE idempotency_key=?',
    )
    .bind(input.key)
    .first<{ actor_subject: string; request_json: string; response_json: string }>();
  if (!row) return null;
  return row.actor_subject === input.actorSubject && row.request_json === request
    ? {
        ok: true as const,
        replayed: true,
        response: JSON.parse(row.response_json) as Record<string, unknown>,
      }
    : { ok: false as const, error: 'idempotency_key_reused' };
}

/** Receipts and revision checks are committed with every managed draft mutation. */
export async function mutateAnnualPlan(
  db: D1Database,
  input: {
    year: number;
    key: string;
    actorSubject: string;
    actorId: number | null;
    body: z.infer<typeof AnnualPlanExpectedSchema>;
    operation: string;
    request: unknown;
    response: Record<string, unknown>;
    reason: string;
    statements: D1PreparedStatement[];
  },
) {
  const request = JSON.stringify({
    year: input.year,
    operation: input.operation,
    body: input.request,
  });
  const receipt = () => replayAnnualPlanMutation(db, input);
  const prior = await receipt();
  if (prior) return prior;
  try {
    await db.batch([
      db
        .prepare(`INSERT INTO annual_plan_receipts (idempotency_key,actor_subject,request_json,response_json,created_at)
        SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM bid_years y JOIN annual_plan_reviews p ON p.bid_year=y.year JOIN rule_books b ON b.version=y.rule_book_version
          WHERE y.year=? AND y.status='configuring' AND b.status='draft' AND b.revision=? AND y.configuration_revision=?
            AND (SELECT revision FROM annual_source_revision WHERE id=1)=?
            AND NOT EXISTS(SELECT 1 FROM bid_sessions s WHERE s.bid_year=y.year AND s.is_mock=0)
            AND NOT EXISTS(SELECT 1 FROM bid_years other WHERE other.year<>y.year AND other.position_template_version=y.position_template_version)
            AND NOT EXISTS(SELECT 1 FROM position_rules rules WHERE rules.template_version=y.position_template_version AND rules.rule_book_version<>y.rule_book_version)) THEN ? ELSE NULL END,?,?,?`)
        .bind(
          input.key,
          input.year,
          input.body.expected_rule_revision,
          input.body.expected_configuration_revision,
          input.body.expected_source_revision,
          input.actorSubject,
          request,
          JSON.stringify(input.response),
          Date.now(),
        ),
      ...input.statements,
      db
        .prepare('UPDATE annual_plan_reviews SET revision=revision+1 WHERE bid_year=?')
        .bind(input.year),
      auditInsertStatement(db, {
        bidSessionId: null,
        actorType: 'admin',
        actorId: input.actorId,
        action: 'bid_configuration_set',
        targetKind: 'bid_year',
        targetId: String(input.year),
        reason: input.reason,
        afterState: input.response,
        clientMeta: { annual_plan_key: input.key, operation: input.operation },
      }),
    ]);
    return { ok: true as const, replayed: false, response: input.response };
  } catch {
    const prior = await receipt();
    if (prior) return prior;
    return { ok: false as const, error: 'annual_plan_or_source_changed' };
  }
}
