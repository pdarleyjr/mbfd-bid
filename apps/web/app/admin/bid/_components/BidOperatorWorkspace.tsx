'use client';

import { Input } from '@/components/ui/input';
import { type ReactNode, useMemo, useState } from 'react';
import type { MemberLite } from '../../../_components/bid/types';
import { shortRank } from '../../../_components/bid/types';
import { BidMemberPanel } from './BidMemberPanel';
import { useBidOperator } from './BidOperatorContext';

export function BidOperatorWorkspace({
  members,
  bidOrder,
  children,
  preview = false,
}: {
  members: Record<string, MemberLite>;
  bidOrder: readonly { memberId: number }[];
  children: ReactNode;
  /** Before Start, member history is readable but nobody is up to select a position. */
  preview?: boolean;
}) {
  const operator = useBidOperator();
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const rows = useMemo(() => {
    const unique = [...new Set(bidOrder.map((row) => row.memberId))];
    const search = query.toLowerCase().trim();
    return unique.flatMap((id, index) => {
      const member = members[String(id)];
      if (
        !member ||
        (search &&
          !`${member.firstName} ${member.lastName} ${member.employeeId} ${member.rank}`
            .toLowerCase()
            .includes(search))
      )
        return [];
      return [{ member, ordinal: index + 1 }];
    });
  }, [bidOrder, members, query]);
  const selected =
    operator?.selectedMemberId == null ? null : members[String(operator.selectedMemberId)];
  return (
    <div
      data-testid="bid-operator-workspace"
      className="grid min-w-0 gap-4 py-3 md:grid-cols-[220px_minmax(0,1fr)]"
    >
      <aside className="min-w-0 space-y-3" aria-label="Bid members">
        {selected ? (
          <BidMemberPanel
            key={selected.id}
            member={selected}
            upNow={selected.id === operator?.activeMemberId}
          />
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            Select a member to see their bid history and details.
          </p>
        )}
        <details
          className="border border-border bg-card"
          open={pickerOpen}
          onToggle={(event) => setPickerOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
            Choose member · {new Set(bidOrder.map((row) => row.memberId)).size}
          </summary>
          <div className="border-t border-border p-2">
            <Input
              aria-label="Find a bid member"
              placeholder="Name or employee number"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <fieldset
              className="mt-2 max-h-60 overflow-y-auto overscroll-contain"
              aria-label="Member selection"
            >
              {rows.map(({ member, ordinal }) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    operator?.selectMember(member.id);
                    setPickerOpen(false);
                    setQuery('');
                  }}
                  aria-pressed={operator?.selectedMemberId === member.id}
                  className="flex min-h-11 w-full items-start gap-2 border-b border-border px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-info/10"
                >
                  <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {ordinal}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {shortRank(member.rank)} {member.firstName} {member.lastName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {member.employeeId}
                      {operator?.activeMemberId === member.id ? ' · Up now' : ''}
                    </span>
                  </span>
                </button>
              ))}
              {rows.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">No matching members.</p>
              ) : null}
            </fieldset>
          </div>
        </details>
      </aside>
      <div className="min-w-0 space-y-3">
        {!preview && selected && selected.id !== operator?.activeMemberId ? (
          <div className="border border-warning/30 bg-warning/10 p-3 text-sm">
            <p>This member is waiting. Position selections belong to the member who is up now.</p>
            {operator?.activeMemberId != null ? (
              <button
                type="button"
                className="mt-2 min-h-11 font-semibold underline"
                onClick={() => operator.selectMember(operator.activeMemberId as number)}
              >
                Return to current bidder
              </button>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
