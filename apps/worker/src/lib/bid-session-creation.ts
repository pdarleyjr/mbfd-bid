import type { BidSessionPolicySnapshot } from '@mbfd/shared';
import {
  type ConfigurationRequest,
  configurationReceiptStatement,
} from './admin-configuration-receipt.js';
import { auditInsertStatement } from './audit.js';
import type { BidWriteCondition } from './bid-definition-legacy-write.js';
import type { BidDefinitionSnapshotColumns } from './bid-definition-pin.js';
import { summarizeBidSessionPolicySnapshot } from './bid-policy.js';

type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;

export function bidSessionCreationResponse(id: string, snapshot: Snapshot, isMock: boolean) {
  return {
    id,
    current_phase: 'config' as const,
    is_mock: isMock,
    rule_book_version: snapshot.ruleBookVersion,
    rule_book_revision: snapshot.ruleBookRevision,
    position_template_version: snapshot.positionTemplateVersion,
    configuration_revision: snapshot.configurationRevision,
    settings: {
      expected_duration_days: snapshot.settings.expectedDurationDays,
      turn_timer_seconds: snapshot.settings.turnTimerSeconds,
    },
    pool: summarizeBidSessionPolicySnapshot(snapshot),
  };
}

/** Shared creation transaction. Selection/preparation and receipt replay stay
 * with the caller. This creates no order, canonical state, or DO projection. */
export async function persistBidSessionCreation(
  database: D1Database,
  input: {
    id: string;
    year: number;
    capturedAtMs: number;
    isMock: boolean;
    snapshot: Snapshot;
    snapshotJson: string;
    pins?: {
      [K in keyof BidDefinitionSnapshotColumns]: NonNullable<BidDefinitionSnapshotColumns[K]>;
    };
    guard: BidWriteCondition;
    actorId: number | null;
    receipt?: ConfigurationRequest;
    response: Record<string, unknown>;
  },
) {
  const { snapshot, pins } = input;
  return database.batch([
    database
      .prepare(`INSERT INTO bid_sessions
      (id,bid_year,started_at,current_phase,turn_timer_seconds,expected_duration_days,day_count,is_mock)
      SELECT ?,?,?,'config',?,?,0,? WHERE ${input.guard.sql}`)
      .bind(
        input.id,
        input.year,
        input.capturedAtMs,
        snapshot.settings.turnTimerSeconds,
        snapshot.settings.expectedDurationDays,
        input.isMock ? 1 : 0,
        ...input.guard.parameters,
      ),
    database
      .prepare(`INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,
       bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1`)
      .bind(
        input.id,
        snapshot.ruleBookVersion,
        snapshot.positionTemplateVersion,
        snapshot.ruleBookRevision,
        input.snapshotJson,
        input.capturedAtMs,
        pins?.bidVersionId ?? null,
        pins?.bidVersionSha256 ?? null,
        pins?.snapshotSha256 ?? null,
        pins?.contextSha256 ?? null,
      ),
    auditInsertStatement(
      database,
      {
        bidSessionId: input.id,
        actorType: 'admin',
        actorId: input.actorId,
        action: 'session_start',
        targetKind: 'bid_session',
        targetId: input.id,
        afterState: {
          bid_year: input.year,
          current_phase: 'config',
          is_mock: input.isMock,
          rule_book_version: snapshot.ruleBookVersion,
          rule_book_revision: snapshot.ruleBookRevision,
          position_template_version: snapshot.positionTemplateVersion,
          configuration_revision: snapshot.configurationRevision,
          settings: snapshot.settings,
          pool: summarizeBidSessionPolicySnapshot(snapshot),
        },
      },
      new Date(input.capturedAtMs),
      true,
      {
        sql: 'EXISTS(SELECT 1 FROM bid_sessions s JOIN bid_session_policy_snapshots p ON p.bid_session_id=s.id WHERE s.id=?)',
        parameters: [input.id],
      },
    ),
    ...(input.receipt
      ? [configurationReceiptStatement(database, input.receipt, input.response)]
      : []),
  ]);
}
