'use client';
import { useEffect, useMemo, useState } from 'react';
import type { MemberLite } from '../../../_components/bid/types';
import { shortRank } from '../../../_components/bid/types';
import { useManualPick } from './ManualPickContext';

interface BidOrderEntry {
  ordinal: number;
  memberId: number;
  pool: 'OFC' | 'FF';
}

interface Props {
  bidOrder: ReadonlyArray<BidOrderEntry>;
  members: Record<string, MemberLite>;
  currentBidderId: number | null;
  fills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
  /** True when the worker computed bidOrder on-the-fly (session not yet
   *  started); badges the panel as a preview. */
  preview: boolean;
}

/**
 * Bid Roster — the ordered list of every bidder for the session, with status:
 *   - "Picked" for members already filled into a position
 *   - "Up now" for the current bidder
 *   - "Waiting" for everyone else
 *
 * Renders all 226 (or however many) rows so the chief can see the full
 * sequence at a glance. Collapsible so it doesn't dominate the screen when
 * the admin is focused on the station grid.
 */
export function BidRoster({ bidOrder, members, currentBidderId, fills, preview }: Props) {
  // Expanded by default so the chief sees the full bid order at a glance.
  // The table itself is bounded by max-h so it can't dominate the viewport.
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<'all' | 'remaining' | 'picked'>('all');
  const { pickMode, selectedMemberId, setSelectedMemberId } = useManualPick();

  // Auto-open the roster when pick mode activates so the chief can see who
  // they can select. We don't auto-close — the user may still want to refer
  // back to the table after picking.
  useEffect(() => {
    if (pickMode) setOpen(true);
  }, [pickMode]);

  const pickedIds = useMemo(
    () => new Set<number>(Object.values(fills).map((f) => f.memberId)),
    [fills],
  );

  const rows = useMemo(() => {
    return bidOrder.filter((entry) => {
      if (filter === 'remaining') return !pickedIds.has(entry.memberId);
      if (filter === 'picked') return pickedIds.has(entry.memberId);
      return true;
    });
  }, [bidOrder, filter, pickedIds]);

  const remainingCount = bidOrder.length - pickedIds.size;

  return (
    <section
      data-testid="bid-roster"
      aria-label="Bid roster"
      className="border-y border-stone-200 bg-white"
    >
      <header className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <button
          type="button"
          data-testid="bid-roster-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded border border-stone-300 bg-white px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
        >
          {open ? '▾' : '▸'} Bid Roster
        </button>
        <span className="text-xs uppercase tracking-wide text-stone-500">
          {bidOrder.length} total · {remainingCount} remaining · {pickedIds.size} picked
        </span>
        {preview && (
          <span
            data-testid="bid-roster-preview-badge"
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
          >
            preview — session not started
          </span>
        )}
        {open && (
          <div className="ml-auto flex items-center gap-1 text-xs">
            {(['all', 'remaining', 'picked'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setFilter(opt)}
                aria-pressed={filter === opt}
                className={[
                  'rounded px-2 py-1 capitalize',
                  filter === opt
                    ? 'bg-red-700 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
                ].join(' ')}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
      </header>

      {open && (
        <div
          data-testid="bid-roster-list"
          className="max-h-48 overflow-auto border-t border-stone-100"
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-1.5 text-left">#</th>
                <th className="px-3 py-1.5 text-left">Pool</th>
                <th className="px-3 py-1.5 text-left">Member</th>
                <th className="px-3 py-1.5 text-left">Emp #</th>
                <th className="px-3 py-1.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((entry) => {
                const member = members[String(entry.memberId)];
                const isCurrent = currentBidderId === entry.memberId;
                const isPicked = pickedIds.has(entry.memberId);
                const isSelected = selectedMemberId === entry.memberId;
                const status: 'picked' | 'current' | 'waiting' = isCurrent
                  ? 'current'
                  : isPicked
                    ? 'picked'
                    : 'waiting';
                const baseRowClass = isCurrent
                  ? 'bg-red-50'
                  : isPicked
                    ? 'bg-emerald-50/50 text-stone-500'
                    : 'bg-white';
                const rowClass =
                  isSelected && pickMode
                    ? 'bg-blue-100 outline outline-2 -outline-offset-1 outline-blue-500'
                    : baseRowClass;
                const statusBadge =
                  status === 'current'
                    ? 'bg-red-700 text-white'
                    : status === 'picked'
                      ? 'bg-emerald-200 text-emerald-900'
                      : 'bg-stone-200 text-stone-700';
                const onRowClick =
                  pickMode && !isPicked
                    ? () =>
                        setSelectedMemberId(
                          selectedMemberId === entry.memberId ? null : entry.memberId,
                        )
                    : undefined;
                const interactiveProps = onRowClick
                  ? {
                      onClick: onRowClick,
                      role: 'button' as const,
                      tabIndex: 0,
                      onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick();
                        }
                      },
                      'aria-pressed': isSelected,
                      'data-pick-mode': true,
                      title: 'Click to select this member as the pick actor',
                    }
                  : {};
                return (
                  <tr
                    key={entry.memberId}
                    data-testid={`bid-roster-row-${entry.ordinal}`}
                    data-status={status}
                    className={`${rowClass}${
                      pickMode && !isPicked ? ' cursor-pointer hover:bg-blue-50' : ''
                    }`}
                    {...interactiveProps}
                  >
                    <td className="px-3 py-1 font-mono tabular-nums">{entry.ordinal}</td>
                    <td className="px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                      {entry.pool}
                    </td>
                    <td className="px-3 py-1">
                      {member ? (
                        <span>
                          <span className="text-stone-500">{shortRank(member.rank)} </span>
                          {member.firstName} {member.lastName}
                        </span>
                      ) : (
                        <span className="font-mono tabular-nums text-stone-400">
                          #{entry.memberId}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1 font-mono text-xs text-stone-500">
                      {member?.employeeId ?? '—'}
                    </td>
                    <td className="px-3 py-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge}`}
                      >
                        {status === 'current' ? 'Up now' : status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-sm text-stone-500">
                    No bidders match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
