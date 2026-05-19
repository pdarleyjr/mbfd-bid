import { getDb } from '../db/index.js';
import { writeAuditLog } from '../lib/audit.js';
import type { WorkerEnv } from '../types/env.js';
import type { Advisory } from './output-schema.js';

export interface DissentInput {
  bidSessionId: string;
  actorMemberId: number;
  actionKind: 'forced_pick' | 'skip';
  targetMemberEmployeeId: string;
  targetPositionId: string | null;
  reason: string;
}

/** If the most recent advisory disagrees with the admin's action, writes an
 * `audit_log.action='dissent'` row. No-op otherwise. */
export async function recordDissentIfNeeded(env: WorkerEnv, i: DissentInput): Promise<void> {
  const raw = await env.AI_KV.get(`ai_last_good:${i.bidSessionId}`);
  if (!raw) return;
  let advisory: Advisory | null = null;
  let aiAdvisoryId: string | null = null;
  try {
    const obj = JSON.parse(raw) as { advisory?: Advisory; ai_advisory_id?: string | null };
    advisory = obj.advisory ?? null;
    aiAdvisoryId = obj.ai_advisory_id ?? null;
  } catch {
    return;
  }
  if (!advisory) return;

  // The admin force-picked; if the AI also recommended force, there's no dissent.
  if (i.actionKind === 'forced_pick' && advisory.force_recommended === true) return;

  const db = getDb(env.DB);
  await writeAuditLog(db, {
    bidSessionId: i.bidSessionId,
    actorType: 'system',
    actorId: null,
    action: 'dissent',
    targetKind: 'member',
    targetId: i.targetMemberEmployeeId,
    beforeState: {
      ai_advisory_id: aiAdvisoryId,
      ai_force_recommended: advisory.force_recommended,
    },
    afterState: {
      admin_action: i.actionKind,
      admin_actor_member_id: i.actorMemberId,
      position_id: i.targetPositionId,
      reason: i.reason,
    },
    aiAdvisoryId,
    reason: 'admin action diverges from AI recommendation',
  });
}
