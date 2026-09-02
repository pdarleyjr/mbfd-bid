export interface AnnualOperationsStatusPayload {
  unresolvedMemberIds?: readonly number[];
  returnedAtCurrentSequence?: readonly { memberId: number; sequence: number }[];
  checkpoint?: { name: string; sequence: number; createdAtMs: number } | null;
  completion?: { readyForFinalizationAtMs: number } | null;
}

interface AnnualOperationsStatusProps {
  annual?: AnnualOperationsStatusPayload | null | undefined;
}

/** Server-provided operations state; this component intentionally has no mutation controls. */
export function AnnualOperationsStatus({ annual }: AnnualOperationsStatusProps) {
  if (!annual) {
    return (
      <aside className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        Annual operations policy has not been frozen into this session. Live annual execution
        remains blocked.
      </aside>
    );
  }
  return (
    <aside
      aria-label="Annual bid operations status"
      className="grid gap-3 border-b border-stone-200 bg-white px-4 py-3 text-sm sm:grid-cols-4"
    >
      <div>
        <p className="font-semibold text-stone-900">Unresolved</p>
        <p>{annual.unresolvedMemberIds?.length ?? 0} member(s)</p>
      </div>
      <div>
        <p className="font-semibold text-stone-900">Returned at current sequence</p>
        <p>{annual.returnedAtCurrentSequence?.length ?? 0} member(s)</p>
      </div>
      <div>
        <p className="font-semibold text-stone-900">Checkpoint</p>
        <p>
          {annual.checkpoint
            ? `${annual.checkpoint.name} · seq ${annual.checkpoint.sequence}`
            : 'None'}
        </p>
      </div>
      <div>
        <p className="font-semibold text-stone-900">Finalization</p>
        <p>{annual.completion ? 'Ready for Worker 4' : 'Not ready'}</p>
      </div>
    </aside>
  );
}
