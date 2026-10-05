'use client';

import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type MemberLite, type PositionMeta, shortRank } from '../../../_components/bid/types';
import { BidMemberPanel } from './BidMemberPanel';
import { useBidOperator } from './BidOperatorContext';
import styles from './BidOperatorWorkspace.module.css';
import { useManualPick } from './ManualPickContext';
import {
  type OperatorSpecialtyCandidate,
  specialtyCoverageWarnings,
} from './operator-specialty-roster';

type Fill = { memberId: number; ordinal: number; bidId: string };

/** One operator workspace for Mock and Real. Lists describe recorded seats;
 * they never recalculate eligibility or advance the canonical bid order. */
export function BidOperatorWorkspace({
  members,
  bidOrder,
  fills = {},
  positions = [],
  onDeckMemberIds = [],
  aDayPendingMemberIds = [],
  aDayDueMemberIds = [],
  temporarilyAssignedMemberIds = [],
  children,
  sessionDetails,
  preview = false,
  sessionId,
  bidYear,
}: {
  members: Record<string, MemberLite>;
  bidOrder: readonly { memberId: number }[];
  fills?: Readonly<Record<string, Fill>>;
  positions?: readonly PositionMeta[] | undefined;
  onDeckMemberIds?: readonly number[];
  aDayPendingMemberIds?: readonly number[];
  aDayDueMemberIds?: readonly number[];
  temporarilyAssignedMemberIds?: readonly number[];
  children: ReactNode;
  sessionDetails?: ReactNode;
  /** Before Start, history is readable but nobody is up to select a position. */
  preview?: boolean;
  sessionId?: string | undefined;
  bidYear?: number | null | undefined;
}) {
  const operator = useBidOperator();
  const manualPick = useManualPick();
  const [query, setQuery] = useState('');
  const [rosterView, setRosterView] = useState<'seniority' | 'specialty'>('seniority');
  const [specialtyId, setSpecialtyId] = useState('');
  const [specialtyStatus, setSpecialtyStatus] = useState<'remaining' | 'taken' | 'all'>(
    'remaining',
  );
  const [mobileRail, setMobileRail] = useState<'remaining' | 'picked' | null>(null);
  const remainingToggle = useRef<HTMLButtonElement>(null);
  const pickedToggle = useRef<HTMLButtonElement>(null);
  const memberContext = useRef<HTMLDivElement>(null);
  const focusAfterRailClose = useRef<'remaining' | 'picked' | 'member' | null>(null);
  useEffect(() => {
    if (mobileRail !== null || focusAfterRailClose.current === null) return;
    const target = focusAfterRailClose.current;
    focusAfterRailClose.current = null;
    if (target === 'member') memberContext.current?.focus();
    else if (target === 'remaining') remainingToggle.current?.focus();
    else pickedToggle.current?.focus();
  }, [mobileRail]);
  const positionById = useMemo(
    () => new Map(positions.map((position) => [position.id, position])),
    [positions],
  );
  const seatsByMember = useMemo(() => {
    const result = new Map<number, string[]>();
    const published = operator?.aDayProjection;
    const entries =
      published && published.sessionId === sessionId
        ? Object.entries(published.fills).map(
            ([positionId, fill]) => [positionId, fill.member_id] as const,
          )
        : Object.entries(fills).map(([positionId, fill]) => [positionId, fill.memberId] as const);
    for (const [positionId, memberId] of entries) {
      result.set(memberId, [...(result.get(memberId) ?? []), positionId]);
    }
    return result;
  }, [fills, operator?.aDayProjection, sessionId]);
  const rows = useMemo(() => {
    const unique = [
      ...new Set([
        ...bidOrder.map((row) => row.memberId),
        ...seatsByMember.keys(),
        ...temporarilyAssignedMemberIds,
      ]),
    ];
    return unique.flatMap((id, index) => {
      const member = members[String(id)];
      return member ? [{ member, ordinal: index + 1 }] : [];
    });
  }, [bidOrder, members, seatsByMember, temporarilyAssignedMemberIds]);
  const recorded = (id: number) =>
    seatsByMember.has(id) || temporarilyAssignedMemberIds.includes(id);
  const remaining = rows.filter(({ member }) => !recorded(member.id));
  const picked = rows.filter(({ member }) => recorded(member.id));
  const publishedSpecialtyRoster = operator?.specialtyRoster;
  const specialtyRoster =
    publishedSpecialtyRoster?.sessionId === sessionId ? (publishedSpecialtyRoster ?? null) : null;
  const specialtyGroups =
    specialtyRoster?.availability === 'AVAILABLE' ? specialtyRoster.groups : [];
  const specialtyGroup =
    specialtyGroups.find((group) => group.id === specialtyId) ?? specialtyGroups[0];
  const coverageWarnings = specialtyCoverageWarnings(specialtyRoster);
  const rosterSession = useRef(sessionId);
  useEffect(() => {
    if (rosterSession.current === sessionId) return;
    rosterSession.current = sessionId;
    setRosterView('seniority');
    setSpecialtyId('');
    setSpecialtyStatus('remaining');
  }, [sessionId]);
  const search = query.toLowerCase().trim();
  const matches = (member: MemberLite) =>
    !search ||
    `${member.firstName} ${member.lastName} ${member.employeeId} ${member.rank}`
      .toLowerCase()
      .includes(search);
  const selected =
    operator?.selectedMemberId == null ? null : members[String(operator.selectedMemberId)];
  const selectedSeats = selected ? (seatsByMember.get(selected.id) ?? []) : [];
  const chooseMember = (id: number) => {
    operator?.selectMember(id);
    if (manualPick.pickMode) manualPick.setSelectedMemberId(id);
    if (mobileRail !== null) {
      focusAfterRailClose.current = 'member';
      setMobileRail(null);
    }
  };
  const specialtyRows = (specialtyGroup?.candidates ?? []).flatMap((candidate) => {
    const member = members[String(candidate.memberId)];
    const taken = recorded(candidate.memberId);
    if (
      !member ||
      !matches(member) ||
      (specialtyStatus === 'remaining' && (!candidate.available || taken)) ||
      (specialtyStatus === 'taken' && !taken)
    )
      return [];
    return [{ member, ordinal: candidate.priority ?? null, specialty: candidate }];
  });
  const row = (
    {
      member,
      ordinal,
      specialty,
    }: {
      member: MemberLite;
      ordinal: number | null;
      specialty?: OperatorSpecialtyCandidate;
    },
    recorded: boolean,
  ) => {
    const current = !preview && operator?.activeMemberId === member.id;
    const onDeck = !preview && !current && onDeckMemberIds[0] === member.id;
    return (
      <li key={member.id}>
        <button
          type="button"
          data-testid={`operator-member-${specialty ? 'specialty' : recorded ? 'picked' : 'remaining'}-${member.id}`}
          data-priority={specialty ? (specialty.priority ?? 'unavailable') : undefined}
          data-status={current ? 'current' : onDeck ? 'on-deck' : recorded ? 'picked' : 'waiting'}
          aria-pressed={operator?.selectedMemberId === member.id}
          onClick={() => chooseMember(member.id)}
          className={`${styles.member} ${current ? styles.current : onDeck ? styles.onDeck : ''}`}
        >
          <span className={styles.ordinal}>{ordinal ?? '—'}</span>
          <span className="min-w-0">
            <span className="block font-semibold">
              {shortRank(member.rank)} {member.firstName} {member.lastName}
            </span>
            {specialty ? (
              <span className="block text-xs text-muted-foreground">
                {specialty.points === null ? 'Qualified pool' : `${specialty.points} points`}
                {specialty.priority === null && specialty.points !== null
                  ? ' · Order unavailable'
                  : ''}
                {!specialty.available && !recorded ? ' · Unavailable' : ''}
                {specialtyGroup?.criticalMemberIds.includes(member.id) ? (
                  <span className="block font-semibold text-warning">Needed for coverage</span>
                ) : null}
              </span>
            ) : null}
            {recorded ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                {(seatsByMember.get(member.id) ?? [])
                  .map((id) => {
                    const position = positionById.get(id);
                    return position ? `${id} · ${position.unit}` : id;
                  })
                  .join(' / ')}
                {temporarilyAssignedMemberIds.includes(member.id) ? (
                  <span className="block">Temporary duty</span>
                ) : null}
                {aDayDueMemberIds.includes(member.id) ? (
                  <span className="block font-semibold text-info">A-Day due</span>
                ) : aDayPendingMemberIds.includes(member.id) ? (
                  <span className="block">A-Day later</span>
                ) : null}
              </span>
            ) : (
              <span className="mt-1 block text-xs text-muted-foreground">
                {current ? 'Up now' : onDeck ? 'On deck' : member.employeeId}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div
      data-testid="bid-operator-workspace"
      className={styles.workspace}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || mobileRail === null) return;
        event.preventDefault();
        event.stopPropagation();
        focusAfterRailClose.current = mobileRail;
        setMobileRail(null);
      }}
    >
      <nav className={styles.mobileNavigation} aria-label="Bid member lists">
        <button
          type="button"
          ref={remainingToggle}
          aria-expanded={mobileRail === 'remaining'}
          aria-controls="operator-remaining"
          onClick={() => {
            if (mobileRail === 'remaining') focusAfterRailClose.current = 'remaining';
            setMobileRail(mobileRail === 'remaining' ? null : 'remaining');
          }}
        >
          Remaining · {remaining.length}
        </button>
        <button
          type="button"
          ref={pickedToggle}
          aria-expanded={mobileRail === 'picked'}
          aria-controls="operator-picked"
          onClick={() => {
            if (mobileRail === 'picked') focusAfterRailClose.current = 'picked';
            setMobileRail(mobileRail === 'picked' ? null : 'picked');
          }}
        >
          Already bid · {picked.length}
        </button>
      </nav>
      <aside
        id="operator-remaining"
        aria-label="Remaining members"
        className={`${styles.rail} ${styles.remainingRail} ${mobileRail === 'remaining' ? styles.mobileOpen : ''}`}
      >
        <header className={styles.railHeader}>
          <h2 className="text-sm font-bold">
            {rosterView === 'specialty' ? 'Members' : preview ? 'Bid members' : 'Remaining'}{' '}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {rosterView === 'specialty' ? specialtyRows.length : remaining.length}
            </span>
          </h2>
          <Input
            aria-label="Find a bid member"
            placeholder="Find member"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <fieldset className={styles.rosterViews} aria-label="Roster order">
            <button
              type="button"
              aria-pressed={rosterView === 'seniority'}
              onClick={() => setRosterView('seniority')}
            >
              Seniority
            </button>
            <button
              type="button"
              aria-pressed={rosterView === 'specialty'}
              onClick={() => setRosterView('specialty')}
            >
              Specialty
            </button>
          </fieldset>
          {rosterView === 'specialty' ? (
            <>
              <NativeSelect
                aria-label="Specialty roster"
                value={specialtyGroup?.id ?? ''}
                disabled={specialtyGroups.length === 0}
                onChange={(event) => setSpecialtyId(event.target.value)}
              >
                {specialtyGroups.length === 0 ? <option value="">Lists unavailable</option> : null}
                {specialtyGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Specialty member status"
                value={specialtyStatus}
                onChange={(event) =>
                  setSpecialtyStatus(event.target.value as 'remaining' | 'taken' | 'all')
                }
              >
                <option value="remaining">Remaining</option>
                <option value="taken">Already bid</option>
                <option value="all">All qualified</option>
              </NativeSelect>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {specialtyGroup
                  ? specialtyGroup.rankingCode
                    ? 'Priority unavailable. Your adjustments remain available.'
                    : `${specialtyGroup.rankingAvailable ? 'Priority order' : 'Qualified pool'} · ${specialtyGroup.eligibleMemberCount} remaining${specialtyGroup.remainingSeatCount === null ? '' : ` / ${specialtyGroup.remainingSeatCount} open seats`}`
                  : specialtyRoster === null
                    ? 'Specialty lists are updating.'
                    : specialtyRoster.availability === 'UNAVAILABLE'
                      ? 'Specialty lists could not be checked.'
                      : 'No configured specialty lists.'}
              </p>
            </>
          ) : null}
        </header>
        <ol aria-label="Member selection" className={styles.memberList}>
          {rosterView === 'specialty'
            ? specialtyRows.map((entry) => row(entry, recorded(entry.member.id)))
            : remaining.filter(({ member }) => matches(member)).map((entry) => row(entry, false))}
          {(
            rosterView === 'specialty'
              ? specialtyRows.length === 0
              : !remaining.some(({ member }) => matches(member))
          ) ? (
            <li className="p-3 text-sm text-muted-foreground">
              {search
                ? 'No matching members.'
                : rosterView === 'specialty'
                  ? 'No members in this view.'
                  : 'All members have a recorded seat.'}
            </li>
          ) : null}
        </ol>
        {sessionDetails ? (
          <details className={styles.sessionDetails}>
            <summary>Session status</summary>
            {sessionDetails}
          </details>
        ) : null}
      </aside>
      <div className={styles.center}>
        {coverageWarnings.length > 0 || (specialtyRoster?.combinedShortage ?? 0) > 0 ? (
          <details className={styles.coverageAlerts} aria-label="Staffing alerts">
            <summary>
              {coverageWarnings.length > 0
                ? `${coverageWarnings.length} ${coverageWarnings.length === 1 ? 'specialty needs' : 'specialties need'} attention`
                : 'Staffing coverage needs attention'}
            </summary>
            <ul>
              {coverageWarnings.map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setRosterView('specialty');
                      setSpecialtyId(group.id);
                      setSpecialtyStatus('remaining');
                      setQuery('');
                      setMobileRail('remaining');
                    }}
                  >
                    <strong>{group.label}</strong> · {group.eligibleMemberCount} qualified /{' '}
                    {group.remainingSeatCount} open
                    {group.status === 'SHORTAGE' ? ' · Shortage' : ' · Low buffer'}
                  </button>
                </li>
              ))}
              {(specialtyRoster?.combinedShortage ?? 0) > 0 ? (
                <li className="px-2 py-1">
                  {specialtyRoster?.combinedShortage} open{' '}
                  {specialtyRoster?.combinedShortage === 1 ? 'seat lacks' : 'seats lack'} enough
                  remaining qualified members across overlapping specialties.
                </li>
              ) : null}
            </ul>
          </details>
        ) : null}
        <div
          ref={memberContext}
          tabIndex={-1}
          aria-label="Member context"
          className="shrink-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {selected ? (
            <BidMemberPanel
              key={selected.id}
              member={selected}
              upNow={!preview && selected.id === operator?.activeMemberId}
              compact
              recordedSeats={selectedSeats}
              sessionId={sessionId}
              bidYear={bidYear}
            />
          ) : (
            <p className="border-b border-border px-3 py-2 text-sm text-muted-foreground">
              Choose a member to see their previous bid and details.
            </p>
          )}
        </div>
        {!preview && selected && selected.id !== operator?.activeMemberId ? (
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/30 bg-warning/10 px-3 py-1 text-sm">
            <p>
              {selectedSeats.length
                ? 'This member has a recorded seat.'
                : 'This member is waiting.'}
            </p>
            {operator?.overrideAllowed ? (
              <button
                type="button"
                className="min-h-11 font-semibold underline"
                onClick={() => operator.requestOverride()}
              >
                {selectedSeats.length ? 'Adjust this member' : 'Bid for this member'}
              </button>
            ) : null}
            {operator?.activeMemberId != null ? (
              <button
                type="button"
                className="min-h-11 font-semibold underline"
                onClick={() => operator.selectMember(operator.activeMemberId as number)}
              >
                Return to current bidder
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={styles.content}>{children}</div>
      </div>
      <aside
        id="operator-picked"
        aria-label="Members who already bid"
        className={`${styles.rail} ${styles.pickedRail} ${mobileRail === 'picked' ? styles.mobileOpen : ''}`}
      >
        <header className={styles.railHeader}>
          <h2 className="text-sm font-bold">
            Already bid{' '}
            <span className="ml-1 text-xs font-normal text-muted-foreground">{picked.length}</span>
          </h2>
          <p className="text-xs text-muted-foreground">Select a name to review or adjust.</p>
        </header>
        <ol aria-label="Recorded member selections" className={styles.memberList}>
          {picked.map((entry) => row(entry, true))}
          {picked.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">Recorded seats appear here.</li>
          ) : null}
        </ol>
      </aside>
    </div>
  );
}
