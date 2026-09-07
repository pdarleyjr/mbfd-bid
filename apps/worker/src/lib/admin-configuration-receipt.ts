export type ConfigurationRequest = {
  key: string;
  actorSubject: string;
  operation: string;
  request: unknown;
};
export async function loadConfigurationReceipt(db: D1Database, input: ConfigurationRequest) {
  const row = await db
    .prepare(
      'SELECT actor_subject,operation,request_json,response_json FROM admin_configuration_receipts WHERE idempotency_key=?',
    )
    .bind(input.key)
    .first<{
      actor_subject: string;
      operation: string;
      request_json: string;
      response_json: string;
    }>();
  if (!row) return null;
  if (
    row.actor_subject !== input.actorSubject ||
    row.operation !== input.operation ||
    row.request_json !== JSON.stringify(input.request)
  )
    return { ok: false as const, error: 'idempotency_key_reused' };
  return { ok: true as const, response: JSON.parse(row.response_json) as Record<string, unknown> };
}
/** Place immediately after a conditional single-row audit INSERT. A lost CAS
 * causes a NOT NULL failure, rolling the entire mutation batch back. */
export function configurationReceiptStatement(
  db: D1Database,
  input: ConfigurationRequest,
  response: unknown,
) {
  return db
    .prepare(
      'INSERT INTO admin_configuration_receipts (idempotency_key,actor_subject,operation,request_json,response_json,created_at) VALUES (?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?,?)',
    )
    .bind(
      input.key,
      input.actorSubject,
      input.operation,
      JSON.stringify(input.request),
      JSON.stringify(response),
      Date.now(),
    );
}
