import { HTTPException } from 'hono/http-exception';

/** A write target comes from a stored identity, never from parsing an alias. */
export type LegacyBidWriteTarget =
  | { kind: 'year'; year: number }
  | { kind: 'book'; version: string }
  | { kind: 'template'; version: string }
  | { kind: 'document'; id: string };

export type BidWriteCondition = { sql: string; parameters: unknown[] };

export class BidDefinitionManagedWriteError extends HTTPException {}

function managedTargetQuery(target: LegacyBidWriteTarget): BidWriteCondition {
  const prefix = 'SELECT h.bid_year,h.version_id,h.revision FROM bid_definition_heads h WHERE ';
  switch (target.kind) {
    case 'year':
      return { sql: `${prefix}h.bid_year=?`, parameters: [target.year] };
    case 'book':
      return {
        sql: `${prefix}h.bid_year IN (
          SELECT effective_year FROM rule_books WHERE version=?
          UNION SELECT year FROM bid_years WHERE rule_book_version=?
          UNION SELECT bid_year FROM bid_definition_versions WHERE rule_book_version=?)`,
        parameters: [target.version, target.version, target.version],
      };
    case 'template':
      return {
        sql: `${prefix}h.bid_year IN (
          SELECT effective_year FROM position_templates WHERE version=?
          UNION SELECT year FROM bid_years WHERE position_template_version=?
          UNION SELECT bid_year FROM bid_definition_versions WHERE position_template_version=?)`,
        parameters: [target.version, target.version, target.version],
      };
    case 'document':
      return {
        sql: `${prefix}h.bid_year IN (
          SELECT effective_year FROM annual_bid_policy_documents WHERE id=?
          UNION SELECT year FROM bid_years WHERE annual_policy_document_id=?
          UNION SELECT bid_year FROM bid_definition_versions WHERE policy_document_id=?
          UNION SELECT b.effective_year FROM rule_books b JOIN annual_bid_policy_documents d ON d.rule_book_version=b.version WHERE d.id=?
          UNION SELECT y.year FROM bid_years y JOIN annual_bid_policy_documents d ON d.rule_book_version=y.rule_book_version WHERE d.id=?)`,
        parameters: [target.id, target.id, target.id, target.id, target.id],
      };
  }
}

export async function assertLegacyBidWrite(d1: D1Database, target: LegacyBidWriteTarget) {
  const conflict = await findManagedLegacyBidWrite(d1, target);
  if (conflict)
    throw new BidDefinitionManagedWriteError(409, {
      res: Response.json(conflict, { status: 409 }),
    });
}

/** The caller also guards its real audit/receipt in these same statements. */
export async function runLegacyBidWriteBatch<T = unknown>(
  d1: D1Database,
  target: LegacyBidWriteTarget,
  statements: D1PreparedStatement[],
): Promise<D1Result<T>[]> {
  await assertLegacyBidWrite(d1, target);
  try {
    return await d1.batch<T>(statements);
  } catch (error) {
    await assertLegacyBidWrite(d1, target);
    throw error;
  }
}

/** Server-only SQL, used inside the same D1 transaction as the legacy write. */
export function legacyBidWriteCondition(target: LegacyBidWriteTarget): BidWriteCondition {
  const query = managedTargetQuery(target);
  return { sql: `NOT EXISTS (${query.sql})`, parameters: query.parameters };
}

export async function findManagedLegacyBidWrite(d1: D1Database, target: LegacyBidWriteTarget) {
  const query = managedTargetQuery(target);
  const head = await d1
    .prepare(`${query.sql} ORDER BY h.bid_year LIMIT 1`)
    .bind(...query.parameters)
    .first<{ bid_year: number; version_id: string; revision: number }>();
  return head
    ? {
        error: 'bid_definition_managed' as const,
        bid_year: head.bid_year,
        version_id: head.version_id,
        current_bid_url: `/admin/current-bid?year=${head.bid_year}`,
      }
    : null;
}
