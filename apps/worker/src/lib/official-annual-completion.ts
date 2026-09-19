import { loadCanonicalBidSessionState } from '../commands/canonical-command-service.js';
import { getDb } from '../db/index.js';
import {
  type CanonicalAnnualCompletionSource,
  projectCanonicalAnnualCompletion,
  projectCanonicalMockCompletion,
} from './annual-completion-result.js';
import { loadFrozenSessionBidPolicy } from './bid-policy.js';
import { hasAcceptedTermElection } from './term-departure.js';

export async function loadCanonicalAmendmentLinks(
  db: D1Database,
  sessionId: string,
): Promise<{ original_bid_id: string; replacement_bid_id: string }[]> {
  return (
    await db
      .prepare(
        `SELECT json_extract(event_json, '$.supersedesBidId') AS original_bid_id,
                json_extract(event_json, '$.replacementBidId') AS replacement_bid_id
           FROM bid_command_events
          WHERE bid_session_id = ?
            AND json_type(event_json, '$.supersedesBidId') = 'text'
            AND json_type(event_json, '$.replacementBidId') = 'text'
          ORDER BY seq, id`,
      )
      .bind(sessionId)
      .all()
  ).results as unknown as { original_bid_id: string; replacement_bid_id: string }[];
}

export async function loadOfficialAnnualCompletion(db: D1Database, sessionId: string) {
  const loaded = await loadVerifiedAnnualCompletionSource(db, sessionId, 'REAL');
  if (!loaded.ok) return loaded;
  const projected = projectCanonicalAnnualCompletion(loaded.source);
  if (!projected.ok) return { ok: false as const, error: projected.code };
  return {
    ok: true as const,
    completion: projected.value,
    snapshot: loaded.snapshot,
    coverage: loaded.coverage,
  };
}

export async function loadRehearsalAnnualCompletion(db: D1Database, sessionId: string) {
  const loaded = await loadVerifiedAnnualCompletionSource(db, sessionId, 'MOCK');
  if (!loaded.ok) return loaded;
  const projected = projectCanonicalMockCompletion(loaded.source);
  if (!projected.ok) return { ok: false as const, error: projected.code };
  return {
    ok: true as const,
    completion: projected.value,
    snapshot: loaded.snapshot,
    coverage: loaded.coverage,
  };
}

async function loadVerifiedAnnualCompletionSource(
  db: D1Database,
  sessionId: string,
  mode: 'REAL' | 'MOCK',
) {
  const session = await db
    .prepare('SELECT bid_year, is_mock FROM bid_sessions WHERE id = ?')
    .bind(sessionId)
    .first<{ bid_year: number; is_mock: number }>();
  if (session === null) return { ok: false as const, error: 'session_not_found' };
  if ((session.is_mock !== 0) !== (mode === 'MOCK'))
    return {
      ok: false as const,
      error: mode === 'REAL' ? 'mock_session_not_transitionable' : 'mock_session_required',
    };
  const canonical = await loadCanonicalBidSessionState(db, sessionId);
  if (canonical === null) return { ok: false as const, error: 'annual_completion_required' };
  const frozen = await loadFrozenSessionBidPolicy(getDb(db), sessionId);
  if (!frozen.ok || frozen.snapshot.settings.v !== 3)
    return { ok: false as const, error: 'frozen_policy_required' };
  for (const fill of Object.values(canonical.fills)) {
    const member = frozen.snapshot.members.find(
      (candidate) => candidate.memberId === fill.memberId,
    );
    if (member && !(await hasAcceptedTermElection(db, sessionId, member, fill)))
      return { ok: false as const, error: 'term_departure_election_required' };
  }
  const metadata = await db
    .prepare(
      'SELECT current_seq, last_command_id FROM canonical_bid_session_state WHERE bid_session_id = ?',
    )
    .bind(sessionId)
    .first<{ current_seq: number; last_command_id: string | null }>();
  if (metadata === null || metadata.last_command_id === null)
    return { ok: false as const, error: 'annual_completion_receipt_required' };
  const receipt = await db
    .prepare(
      'SELECT command_type, outcome, result_seq FROM bid_command_receipts WHERE command_id = ? AND bid_session_id = ?',
    )
    .bind(metadata.last_command_id, sessionId)
    .first<{ command_type: string; outcome: string; result_seq: number }>();
  if (
    receipt === null ||
    receipt.command_type !== 'live.complete_session' ||
    receipt.outcome !== 'accepted' ||
    receipt.result_seq !== metadata.current_seq
  )
    return { ok: false as const, error: 'annual_completion_receipt_required' };
  const amendments = await loadCanonicalAmendmentLinks(db, sessionId);
  const source: CanonicalAnnualCompletionSource = {
    session: { id: sessionId, mode, bidYear: session.bid_year },
    completion: {
      commandId: metadata.last_command_id,
      revision: metadata.current_seq,
      completedAtMs: canonical.annual?.completion?.readyForFinalizationAtMs ?? 0,
      receiptIntegrity: 'VERIFIED',
    },
    frozen: {
      ruleBookVersion: frozen.snapshot.ruleBookVersion,
      topologyReference: frozen.snapshot.positionTemplateVersion,
      staffingReference: frozen.snapshot.staffingBaseline?.baselineAcceptanceId ?? null,
      members: frozen.snapshot.members.map((member) => ({
        memberId: member.memberId,
        rank: member.rank,
      })),
      positions: frozen.snapshot.ruleBookMaterial.positions.map((position) => ({
        id: position.id,
        shift: position.shift,
        station: position.station,
        unit: position.unit,
        position: position.positionName,
        specialty: null,
      })),
    },
    state: canonical,
    amendmentLinks: amendments.map((amendment) => ({
      originalBidId: amendment.original_bid_id,
      replacementBidId: amendment.replacement_bid_id,
    })),
  };
  return {
    ok: true as const,
    source,
    snapshot: frozen.snapshot,
    coverage: frozen.coverage,
  };
}
