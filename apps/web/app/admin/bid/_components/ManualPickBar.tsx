'use client';
import { Button } from '@/components/ui/button';
import type { MemberLite } from '../../../_components/bid/types';
import { shortRank } from '../../../_components/bid/types';
import { useManualPick } from './ManualPickContext';

/**
 * Banner that appears whenever pick mode is on. Shows the currently selected
 * member and an instruction for the next step. Lives at the top of the board
 * so the chief never loses track of which member they're picking for.
 */
export function ManualPickBar({
  isMock,
  members,
}: {
  isMock: boolean;
  members: Record<string, MemberLite>;
}) {
  const {
    pickMode,
    selectedMemberId,
    setSelectedMemberId,
    reset,
    submitting,
    lastError,
    clearError,
  } = useManualPick();

  if (!pickMode) return null;
  const member = selectedMemberId === null ? null : (members[String(selectedMemberId)] ?? null);

  return (
    <div
      data-testid="manual-pick-bar"
      className="flex flex-wrap items-center gap-3 border-b border-blue-300 bg-blue-50 px-4 py-2 text-sm text-blue-950"
    >
      <span className="font-semibold uppercase tracking-wide text-blue-700">Pick mode</span>
      {member !== null && selectedMemberId !== null ? (
        <>
          <span>
            Selected:{' '}
            <strong>
              {shortRank(member.rank)} {member.firstName} {member.lastName}
            </strong>{' '}
            <span className="font-mono text-xs text-blue-700">#{member.employeeId}</span>
          </span>
          <span className="text-blue-700">Click an open position cell to assign.</span>
          <Button
            type="button"
            onClick={() => {
              setSelectedMemberId(null);
              clearError();
            }}
            disabled={submitting}
            className="rounded border border-blue-400 bg-white px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            Clear selection
          </Button>
        </>
      ) : (
        <span className="text-blue-800">
          Click a member in the Bid Roster to select who you&apos;re picking for.
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {!isMock && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
            title="Live sessions: use the Override button on the command bar (step-up + reason)."
          >
            live — use Override
          </span>
        )}
        <Button
          type="button"
          onClick={reset}
          disabled={submitting}
          className="rounded border border-blue-400 bg-white px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          Exit pick mode
        </Button>
      </span>
      {submitting && <span className="basis-full text-xs text-blue-700">Submitting pick…</span>}
      {lastError !== null && (
        <p className="basis-full text-xs text-red-700" role="alert">
          {lastError}
        </p>
      )}
    </div>
  );
}
