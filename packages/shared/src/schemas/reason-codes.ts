import { z } from 'zod';

/**
 * Machine-stable reason codes for admin actions.
 *
 * Convention: <action_family>.<sub_reason>. New codes require:
 *   1. Adding to this enum.
 *   2. Adding a description to REASON_CODE_DESCRIPTIONS.
 *   3. Adding to the corresponding action allow-list in
 *      apps/worker/src/lib/reason-codes.ts.
 *
 * Source: 2026_Bid_Process.md sect 6 + spec sect 8.4 + 12.2.
 */
export const ReasonCodeSchema = z.enum([
  'force.reverse_seniority',
  'force.cert_mandate',
  'skip.unreachable',
  'skip.declined',
  'bid_for_member.unreachable_phone',
  'rule_override.fix_misconfig',
  'rule_override.policy_direction',
  'cert_override.late_correction',
  'lock_position.probationary_placement',
  'lock_position.swat_medic_placement',
  'session.day_end_scheduled',
  'session.pause_emergency',
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const REASON_CODE_DESCRIPTIONS: Record<ReasonCode, string> = {
  'force.reverse_seniority':
    'Reverse-seniority forced pick — last qualified bidders pulled into a specialty slot.',
  'force.cert_mandate':
    'Mandatory credentialed slot — minimum staffing on a critical credential not yet met.',
  'skip.unreachable':
    'Member did not respond within the timer window; bid will return on a later pass.',
  'skip.declined': 'Member voluntarily declined to bid this turn.',
  'bid_for_member.unreachable_phone':
    'Admin enters the chosen pick on the members behalf (member phone down, pick is eligible).',
  'rule_override.fix_misconfig':
    'Mid-bid rule correction — a misconfigured rule is being patched with the chiefs present.',
  'rule_override.policy_direction':
    'Approved policy direction — a draft rule book is being corrected through the normal lifecycle.',
  'cert_override.late_correction':
    'Credential added or removed for a member after roster freeze — late paperwork correction.',
  'lock_position.probationary_placement':
    'Probationary firefighter auto-placed before the open bid begins.',
  'lock_position.swat_medic_placement':
    'SWAT medic or Paramedic student auto-placed before the open bid begins.',
  'session.day_end_scheduled':
    'End of bid day — session paused with scheduled resume timestamp; members notified.',
  'session.pause_emergency': 'Emergency pause — IT issue, room evacuation, labor dispute, etc.',
};
