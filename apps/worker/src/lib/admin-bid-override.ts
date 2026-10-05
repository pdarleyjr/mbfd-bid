import type { LiveBidAction, LiveBidCommand } from '@mbfd/shared';

/** Keep the established force-authorized preview boundary; only a reviewed
 * stage adjustment uses its already-frozen transition approval grant. */
export function liveBidPreviewActionForCommand(command: LiveBidCommand): LiveBidAction {
  return command.type === 'live.transition_stage' ? 'approve_transition' : 'force';
}

export interface AdminBidOverrideWarning {
  code: string;
  message: string;
}

export function hasAdminBidOverride(command: LiveBidCommand): boolean {
  return 'adminOverride' in command && command.adminOverride !== undefined;
}

export function addAdminBidOverrideWarning(
  warnings: AdminBidOverrideWarning[],
  code: string,
  message: string,
): void {
  if (!warnings.some((warning) => warning.code === code)) warnings.push({ code, message });
}

/** A preview is advisory only. Final confirmation must acknowledge the exact
 * current warning set; unexpected, missing and duplicated codes cannot grant
 * permission or turn a stale preview into a different award. */
export function adminBidOverrideAcknowledges(
  command: LiveBidCommand,
  warnings: readonly AdminBidOverrideWarning[],
): boolean {
  if (!('adminOverride' in command) || command.adminOverride === undefined) return false;
  const supplied = [...command.adminOverride.warningCodes].sort();
  const expected = warnings.map((warning) => warning.code).sort();
  return (
    command.adminOverride.acknowledged === true &&
    supplied.length === expected.length &&
    new Set(supplied).size === supplied.length &&
    supplied.every((code, index) => code === expected[index])
  );
}
