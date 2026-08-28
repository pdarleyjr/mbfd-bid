import type { ReasonCode } from '@mbfd/shared';
import type { AuditAction } from './audit.js';

/**
 * Action -> set of valid reason codes. Reject any code not in the set for
 * the requested action; the API layer returns 400 with body
 * { error: 'invalid_reason_for_action', action, reason_code }.
 */
const ACTION_TO_REASONS: ReadonlyMap<AuditAction, ReadonlySet<ReasonCode>> = new Map([
  ['forced_pick', new Set<ReasonCode>(['force.reverse_seniority', 'force.cert_mandate'])],
  ['skip', new Set<ReasonCode>(['skip.unreachable', 'skip.declined'])],
  ['admin_bid_for_member', new Set<ReasonCode>(['bid_for_member.unreachable_phone'])],
  [
    'override_rule',
    new Set<ReasonCode>(['rule_override.fix_misconfig', 'rule_override.policy_direction']),
  ],
  ['override_cert', new Set<ReasonCode>(['cert_override.late_correction'])],
  [
    'lock_position',
    new Set<ReasonCode>([
      'lock_position.probationary_placement',
      'lock_position.swat_medic_placement',
    ]),
  ],
  ['pause', new Set<ReasonCode>(['session.pause_emergency', 'session.day_end_scheduled'])],
]);

export function isReasonValidForAction(action: AuditAction, code: ReasonCode): boolean {
  return ACTION_TO_REASONS.get(action)?.has(code) ?? false;
}

/** Returns the allowed reason codes for `action`, or [] if the action takes none. */
export function reasonsForAction(action: AuditAction): ReasonCode[] {
  const allowed = ACTION_TO_REASONS.get(action);
  return allowed ? [...allowed] : [];
}
