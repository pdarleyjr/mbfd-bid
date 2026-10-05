import { evaluateEligibility } from '@mbfd/eligibility';
import { type JwtPayload, LiveBidCommandSchema, isLiveBidActionAuthorized } from '@mbfd/shared';
import { Hono } from 'hono';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../commands/canonical-command-service.js';
import { getDb } from '../../db/index.js';
import type { BidSessionState } from '../../durable/bid-session-state.js';
import { hasAdminBidOverride } from '../../lib/admin-bid-override.js';
import { unresolvedBidCorrections } from '../../lib/bid-corrections.js';
import {
  eligibilityMemberFromFrozen,
  frozenEligibilityMemberForSession,
  loadFrozenSessionBidPolicy,
} from '../../lib/bid-policy.js';
import { currentLiveBidStage } from '../../lib/live-bid-stages.js';
import { requireStepUpAuth } from '../../middleware/require-step-up.js';
import type { WorkerEnv } from '../../types/env.js';
import { requireAdmin } from './middleware.js';

type Env = { Bindings: WorkerEnv; Variables: { claims: JwtPayload } };
const router = new Hono<Env>();
router.use('*', requireAdmin);

function aDayCounts(state: BidSessionState) {
  const counts = new Map<string, number>();
  for (const pick of state.aDay?.picks ?? []) {
    const key = `${pick.shift}:${pick.aDay}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

router.get('/:id/corrections', async (c) => {
  c.header('Cache-Control', 'no-store');
  const sessionId = c.req.param('id');
  const [state, frozen] = await Promise.all([
    loadCanonicalBidSessionState(c.env.DB, sessionId),
    loadFrozenSessionBidPolicy(getDb(c.env.DB), sessionId),
  ]);
  if (!state || !frozen.ok || frozen.snapshot.settings.v !== 3)
    return c.json({ error: 'canonical_correction_source_unavailable' }, 409);
  const policy = frozen.snapshot.settings.livePolicy;
  if (!isLiveBidActionAuthorized(policy, 'amend_selection', c.get('claims').member_id))
    return c.json({ error: 'live_action_forbidden', action: 'amend_selection' }, 403);
  const events = (
    await c.env.DB.prepare(`SELECT e.command_id,e.event_json,r.command_type
    FROM bid_command_events e JOIN bid_command_receipts r ON r.command_id=e.command_id AND r.bid_session_id=e.bid_session_id
    WHERE e.bid_session_id=? AND r.outcome='accepted' AND r.result_seq=e.seq ORDER BY e.seq`)
      .bind(sessionId)
      .all<{ command_id: string; event_json: string; command_type: string }>()
  ).results;
  const awardReceipts = new Map<string, string>();
  const aDayReceipts = new Map<number, string>();
  for (const row of events) {
    const event = JSON.parse(row.event_json) as Record<string, unknown>;
    const bidId = event.bidId ?? event.replacementBidId;
    if (typeof bidId === 'string') awardReceipts.set(bidId, row.command_id);
    if (row.command_type === 'live.record_a_day' && typeof event.memberId === 'number')
      aDayReceipts.set(event.memberId, row.command_id);
  }
  const reached = currentLiveBidStage(state, policy);
  const sources = [
    ...Object.entries(state.fills).map(([positionId, fill]) => ({
      positionId,
      fill,
      bidId: fill.bidId,
      status: 'ACTIVE' as const,
    })),
    ...unresolvedBidCorrections(state).map((entry) => ({
      positionId: entry.before.positionId,
      fill: entry.before.fill,
      bidId: entry.bidId,
      status: 'REVOKED' as const,
    })),
  ].flatMap(({ positionId, fill, bidId, status }) => {
    const commandId = awardReceipts.get(bidId);
    const member = frozenEligibilityMemberForSession(frozen.snapshot, fill.memberId);
    if (!commandId || !member) return [];
    const pick = state.aDay?.picks.find((entry) => entry.memberId === fill.memberId);
    const eligiblePositions = policy.stages
      .filter(
        (stage) =>
          stage.memberIds.includes(fill.memberId) &&
          reached !== undefined &&
          stage.order <= reached.order,
      )
      .flatMap((stage) => stage.opportunityPositionIds)
      .filter((id) => {
        if (state.fills[id] && !(status === 'ACTIVE' && id === positionId)) return false;
        const rule = frozen.coverage.rules.find((candidate) => candidate.positionId === id);
        return (
          rule !== undefined &&
          evaluateEligibility(eligibilityMemberFromFrozen(member), rule).eligible
        );
      });
    return [
      {
        bidId,
        originalCommandId: commandId,
        originalPositionId: positionId,
        originalADayCommandId:
          status === 'ACTIVE' && fill.aDay === undefined && pick
            ? (aDayReceipts.get(fill.memberId) ?? null)
            : null,
        memberId: fill.memberId,
        status,
        aDay: pick?.aDay ?? fill.aDay ?? null,
        membershipIds: fill.membershipIds ?? [],
        eligiblePositionIds: [...new Set(eligiblePositions)],
        termParticipation: member.termParticipation ?? null,
      },
    ];
  });
  return c.json({
    sequence: state.lastSeq,
    scoreReceiptSha256: frozen.snapshot.scoreReferenceSource?.receiptSha256 ?? null,
    sealed: state.annual?.completion != null,
    sources,
    positions: frozen.snapshot.ruleBookMaterial.positions.map((position) => ({
      id: position.id,
      label: `${position.shift} ${position.station} ${position.unit} ${position.positionName}`,
      shift: position.shift,
    })),
    combatGroups: policy.annualOperations?.aDay.combatGroups ?? [],
    opportunityPools: policy.annualOperations?.opportunityPools ?? [],
  });
});

/** Preview reads D1 directly and cannot append receipts/audits or hydrate a
 * Durable Object. Final confirmation goes through commands/live serialization. */
router.post('/:id/corrections/preview', requireStepUpAuth(), async (c) => {
  c.header('Cache-Control', 'no-store');
  const sessionId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return c.json({ error: 'invalid_live_bid_command' }, 400);
  const parsed = LiveBidCommandSchema.safeParse({
    ...body,
    bidSessionId: sessionId,
    actor: { id: c.get('claims').member_id, role: 'admin' },
  });
  if (!parsed.success || parsed.data.type !== 'live.correct_bid')
    return c.json({ error: 'invalid_live_bid_command' }, 400);
  const [state, frozen] = await Promise.all([
    loadCanonicalBidSessionState(c.env.DB, sessionId),
    loadFrozenSessionBidPolicy(getDb(c.env.DB), sessionId),
  ]);
  if (!state || !frozen.ok || frozen.snapshot.settings.v !== 3)
    return c.json({ error: 'canonical_correction_source_unavailable' }, 409);
  if (
    !isLiveBidActionAuthorized(
      frozen.snapshot.settings.livePolicy,
      hasAdminBidOverride(parsed.data) ? 'force' : 'amend_selection',
      c.get('claims').member_id,
    )
  )
    return c.json({ error: 'live_action_forbidden', action: 'amend_selection' }, 403);
  const preview = await commitLiveBidCommand({
    db: c.env.DB,
    command: parsed.data,
    state,
    policy: frozen.snapshot.settings.livePolicy,
    previewOnly: true,
  });
  if (preview.result.kind !== 'accepted' || !preview.canonicalState)
    return c.json(preview.result, 409);
  const event = preview.result.envelope.payload as { before: unknown; after: unknown };
  const beforeCounts = aDayCounts(state);
  const afterCounts = aDayCounts(preview.canonicalState);
  return c.json({
    valid: true,
    expectedSeq: state.lastSeq,
    scoreReceiptSha256: preview.scoreReceiptSha256 ?? null,
    before: event.before,
    after: event.after,
    reason: parsed.data.reason,
    memberId: parsed.data.memberId,
    constraintEffects: [...new Set([...beforeCounts.keys(), ...afterCounts.keys()])]
      .sort()
      .flatMap((group) => {
        const before = beforeCounts.get(group) ?? 0;
        const after = afterCounts.get(group) ?? 0;
        return before === after ? [] : [{ group, before, after }];
      }),
    validated: [
      'Frozen eligibility',
      'Specialty priority',
      'A-Day capacity and scoped limits',
      'Membership distribution',
      'Active receipt lineage',
    ],
  });
});

export default router;
