'use client';

import { presentationApiPath } from '@/lib/presentation-link';
import { ChevronLeft, ChevronRight, List, X } from 'lucide-react';
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react';
import { MockBanner } from '../_components/MockBanner';
import { getSeatAppearance } from '../_components/bid/seat-appearance';
import styles from './PresentationView.module.css';
import {
  PRESENTATION_SHIFTS,
  type PresentationADay,
  type PresentationChiefAssignment,
  type PresentationMember,
  type PresentationPosition,
  type PresentationShift,
  presentationADayStations,
  presentationBoardPages,
  presentationQueue,
  presentationStations,
  shiftLabel,
} from './presentation-layout';

export type Presentation = {
  mode: 'OFF' | 'LIVE' | 'HOLD';
  held_at_sequence?: number | null;
  sequence?: number;
  session: { id: string; bid_year: number; is_mock?: boolean } | null;
  current_stage?: { id: string | null; label: string | null };
  current_bidder?: PresentationMember | null;
  on_deck?: Array<PresentationMember | null>;
  remaining_queue?: Array<PresentationMember | null>;
  exceptional_assignments?: PresentationChiefAssignment[];
  phase?: string;
  paused?: boolean;
  complete?: boolean;
  progress?: { filled: number; total: number };
  positions?: PresentationPosition[];
  a_day?: PresentationADay;
  specialty?: { active: true; label: string; position_id: string; status: string } | null;
};

function useFrameSize(ref: RefObject<HTMLElement | null>, enabled = true) {
  const [size, setSize] = useState({ width: 1024, height: 640 });
  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setSize((previous) =>
        previous.width === Math.floor(width) && previous.height === Math.floor(height)
          ? previous
          : { width: Math.floor(width), height: Math.floor(height) },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return size;
}

function assignmentLabel(
  assignment: PresentationMember['current_assignment'],
  includeHistoricalPosition = false,
) {
  if (!assignment) return null;
  return [
    assignment.shift ? (assignment.shift === 'D' ? 'Days' : `${assignment.shift} Shift`) : null,
    ...(includeHistoricalPosition ? [assignment.position_id] : []),
    assignment.station,
    assignment.unit,
    assignment.position_name,
    assignment.a_day_group
      ? `A-Day ${String(assignment.a_day_group).replace(/^(?:GR|G)(\d+)$/, 'Group $1')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function PresentationBoard({ view }: { view: Presentation }) {
  const [shift, setShift] = useState<PresentationShift>('A');
  const [boardView, setBoardView] = useState<'positions' | 'a-days'>('positions');
  const [boardPage, setBoardPage] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueAnchor, setQueueAnchor] = useState(0);
  const [seatHeights, setSeatHeights] = useState<{ width: number; values: Record<string, number> }>(
    { width: 0, values: {} },
  );
  const boardRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLOListElement>(null);
  const queueButtonRef = useRef<HTMLButtonElement>(null);
  const boardSize = useFrameSize(boardRef);
  const queueSize = useFrameSize(queueRef, queueOpen);
  const queue = presentationQueue(view.remaining_queue, view.current_bidder, view.on_deck);
  const expectedADaySequence =
    view.mode === 'HOLD' ? (view.held_at_sequence ?? view.sequence) : view.sequence;
  const aDays =
    view.a_day &&
    Number.isSafeInteger(expectedADaySequence) &&
    view.a_day.sequence === expectedADaySequence
      ? view.a_day
      : null;
  const aDayGroups =
    aDays?.availability === 'AVAILABLE'
      ? aDays.groups.filter((group) => group.shift === shift)
      : [];
  const pendingADays =
    aDays?.availability === 'AVAILABLE'
      ? aDays.pending.filter((member) => member.shift === shift)
      : [];
  const stations =
    boardView === 'a-days'
      ? aDays
        ? presentationADayStations(aDays, shift, view.positions ?? [])
        : []
      : presentationStations(view.positions ?? [], shift, view.exceptional_assignments);
  const { pages, columns } = presentationBoardPages(
    stations,
    boardSize.width,
    boardSize.height,
    seatHeights.width === boardSize.width ? seatHeights.values : {},
    boardView === 'a-days' ? 60 : 46,
  );
  const shownPage = Math.min(boardPage, pages.length - 1);
  const stationParts = pages[shownPage] ?? [];
  const seatPageKey = stationParts
    .flatMap((station) => station.seats)
    .map((seat) => `${seat.id}:${seat.filled_by?.name ?? ''}:${seat.position_name}`)
    .join('|');
  const queuePageSize = Math.max(1, Math.floor(queueSize.height / 60));
  const queuePages = Math.max(1, Math.ceil(queue.length / queuePageSize));
  const shownQueuePage = Math.min(Math.floor(queueAnchor / queuePageSize), queuePages - 1);
  const next = view.on_deck?.find((member) => member !== null) ?? null;
  const currentAssignment = assignmentLabel(view.current_bidder?.current_assignment);
  const previousAssignment = assignmentLabel(view.current_bidder?.previous_assignment, true);
  const currentQueueIndex = queue.findIndex(
    (member) => member.member_id === view.current_bidder?.member_id,
  );
  const filled = (view.positions ?? []).filter(
    (position) =>
      position.shift.toUpperCase() === shift && position.filled_by && !position.assigned,
  ).length;
  const total = stations.reduce(
    (count, station) =>
      count + station.seats.filter((seat) => !seat.chief_directed && !seat.assigned).length,
    0,
  );

  useEffect(() => {
    setQueueOpen(window.innerWidth >= 1500);
  }, []);
  useEffect(() => {
    // Full member names and custom role labels may wrap. Fit their actual row
    // height instead of hiding text or assuming every seat has a short name.
    if (!seatPageKey) return;
    const seats = [...(boardRef.current?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])];
    const measure = () => {
      const measured = seats
        .map(
          (seat) => [seat.dataset.rowKey, Math.ceil(seat.getBoundingClientRect().height)] as const,
        )
        .filter(([key, height]) => key && height > 0);
      setSeatHeights((previous) => {
        const values = previous.width === boardSize.width ? { ...previous.values } : {};
        let changed = previous.width !== boardSize.width;
        for (const [key, height] of measured) {
          if (key && values[key] !== height) {
            values[key] = height;
            changed = true;
          }
        }
        return changed ? { width: boardSize.width, values } : previous;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const seat of seats) observer.observe(seat);
    return () => observer.disconnect();
  }, [seatPageKey, boardSize.width]);
  useEffect(() => {
    // Follow a new bidder, while preserving the member the audience paged to
    // when the queue is first measured or the viewport changes size.
    if (view.current_bidder?.member_id !== undefined && currentQueueIndex >= 0)
      setQueueAnchor(currentQueueIndex);
  }, [currentQueueIndex, view.current_bidder?.member_id]);

  function closeQueue() {
    setQueueOpen(false);
    queueButtonRef.current?.focus();
  }
  function changeShift(direction: -1 | 1) {
    const index = PRESENTATION_SHIFTS.indexOf(shift);
    setShift(PRESENTATION_SHIFTS[(index + direction + PRESENTATION_SHIFTS.length) % 4] ?? 'A');
    setBoardPage(0);
  }

  return (
    <>
      <div className={styles.bidderBar}>
        <div className={styles.currentBidder} data-testid="presentation-current-bidder">
          <span className={styles.eyebrow}>Now bidding</span>
          <div className={styles.bidderNameLine}>
            <strong className={styles.bidderName}>
              {view.current_bidder?.name ?? (view.complete ? 'Bid complete' : 'Awaiting bidder')}
            </strong>
            {view.current_bidder?.rank ? (
              <span className={styles.rank}>{view.current_bidder.rank}</span>
            ) : null}
            {view.current_bidder?.pending_a_day ? (
              <span className={styles.pendingADay}>A-Day due</span>
            ) : null}
          </div>
          {currentAssignment ? (
            <p className={styles.assignment}>Current seat: {currentAssignment}</p>
          ) : previousAssignment ? (
            <p className={styles.assignment}>Previous bid: {previousAssignment}</p>
          ) : null}
        </div>
        <div className={styles.onDeck} data-testid="presentation-on-deck">
          <span className={styles.eyebrow}>On deck</span>
          <strong>
            {next?.name ?? (view.complete ? 'All turns complete' : 'Awaiting next turn')}
          </strong>
          {next?.rank ? <span className={styles.onDeckRank}>{next.rank}</span> : null}
        </div>
      </div>
      <nav className={styles.shiftNavigation} aria-label="Shift board">
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Previous shift"
          onClick={() => changeShift(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <div className={styles.shiftTitle}>
          <h1>{shiftLabel(shift)}</h1>
          <span>
            {boardView === 'a-days'
              ? aDays?.availability === 'AVAILABLE'
                ? `${aDayGroups.length} groups · ${pendingADays.length} pending`
                : aDays === null
                  ? 'Updating groups'
                  : 'Groups unavailable'
              : `${total - filled} available · ${filled} taken`}
          </span>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Next shift"
          onClick={() => changeShift(1)}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <div className={styles.shiftTabs}>
          {PRESENTATION_SHIFTS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={shift === option}
              aria-label={`Show ${shiftLabel(option)}`}
              onClick={() => {
                setShift(option);
                setBoardPage(0);
              }}
            >
              {option === 'D' ? 'Days' : option}
            </button>
          ))}
        </div>
        <fieldset className={styles.viewToggle} aria-label="Presentation view">
          {(['positions', 'a-days'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={boardView === option}
              onClick={() => {
                setBoardView(option);
                setBoardPage(0);
              }}
            >
              {option === 'positions' ? 'Positions' : 'A-Days'}
            </button>
          ))}
        </fieldset>
        <button
          ref={queueButtonRef}
          type="button"
          className={styles.queueToggle}
          aria-label={`${queueOpen ? 'Close' : 'Open'} remaining bidders`}
          aria-expanded={queueOpen}
          aria-controls="presentation-remaining-bidders"
          onClick={() => setQueueOpen(!queueOpen)}
        >
          <List aria-hidden="true" size={20} />
          <span>Queue</span>
          <strong>{queue.length}</strong>
        </button>
      </nav>
      <div className={`${styles.workspace} ${queueOpen ? styles.queueIsOpen : ''}`}>
        <section
          className={styles.board}
          aria-label={boardView === 'a-days' ? 'A-Day groups' : 'Station and apparatus board'}
        >
          <h2 className="sr-only">
            {boardView === 'a-days' ? 'A-Day groups' : 'Station and apparatus board'}
          </h2>
          <div
            ref={boardRef}
            className={styles.stationGrid}
            data-testid={
              boardView === 'a-days' ? 'presentation-a-day-board' : 'presentation-station-board'
            }
            style={{ '--station-columns': columns } as CSSProperties}
          >
            {stationParts.map((station) => (
              <section
                key={`${shift}-${station.id}-${station.start}`}
                className={styles.station}
                aria-label={`${station.label}, ${shiftLabel(shift)}`}
              >
                <header
                  className={`${styles.stationHeading} ${boardView === 'a-days' ? styles.aDayHeading : ''}`}
                >
                  <h2>
                    {station.label}
                    {station.a_day_group?.saved_override ? (
                      <small className={styles.overrideGroup}> · Saved override</small>
                    ) : null}
                  </h2>
                  {station.a_day_group ? (
                    <span>
                      {station.a_day_group.used} taken ·{' '}
                      {station.a_day_group.remaining === null
                        ? 'Limit not set'
                        : `${station.a_day_group.remaining} available`}
                    </span>
                  ) : station.a_day_pending ? (
                    <span>{station.total} awaiting selection</span>
                  ) : station.seats.length < station.total ? (
                    <span>
                      {station.start + 1}–{station.start + station.seats.length} / {station.total}
                    </span>
                  ) : (
                    <span>{station.total} seats</span>
                  )}
                </header>
                <ol className={styles.seats}>
                  {station.seats.map((position) => {
                    if (position.a_day_capacity) {
                      const capacity = position.a_day_capacity;
                      return (
                        <li
                          key={position.id}
                          className={styles.capacityRow}
                          data-row-key={position.id}
                          data-testid="presentation-a-day-capacity"
                          data-capacity-id={capacity.id}
                        >
                          <strong>{capacity.label}</strong>
                          <span>
                            {capacity.used} taken
                            <small>
                              {capacity.remaining === null
                                ? 'Limit not set'
                                : `${capacity.remaining} available`}
                            </small>
                          </span>
                        </li>
                      );
                    }
                    const appearance = getSeatAppearance({
                      rankRequired: position.rank_required,
                      positionName: position.position_name,
                      unit: position.unit,
                    });
                    return (
                      <li
                        key={position.id}
                        className={`${styles.seat} ${position.filled_by ? styles.taken : ''}`}
                        data-testid={
                          boardView === 'a-days' ? 'presentation-a-day-member' : 'presentation-seat'
                        }
                        data-row-key={position.id}
                        data-position-id={
                          boardView === 'positions' && !position.chief_directed
                            ? position.id
                            : undefined
                        }
                        data-member-id={
                          boardView === 'a-days' ? position.filled_by?.member_id : undefined
                        }
                        data-seat-role={appearance.role}
                        style={
                          {
                            '--seat-background': appearance.backgroundColor,
                            '--seat-text': appearance.color,
                            '--seat-muted': appearance.mutedColor,
                          } as CSSProperties
                        }
                      >
                        <div className={styles.seatRole}>
                          <span className={styles.seatUnit} title={position.unit}>
                            {position.chief_directed
                              ? 'Chief directed'
                              : boardView === 'a-days'
                                ? position.unit
                                : `${position.id} · ${position.unit}`}
                          </span>
                          <strong title={position.position_name}>{position.position_name}</strong>
                        </div>
                        <div className={styles.seatOccupant}>
                          <span>{position.filled_by?.name ?? 'Available'}</span>
                          {position.assigned ? (
                            <small className={styles.forced}>Assigned</small>
                          ) : position.forced === true ? (
                            <span
                              role="img"
                              aria-label="Forced assignment"
                              title="Forced assignment"
                              data-testid={`forced-marker-${position.id}`}
                              className={styles.forcedMarker}
                            >
                              !
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {stations.length === 0 ? (
              <output className={styles.emptyBoard}>
                {boardView === 'positions'
                  ? 'No seats in this shift.'
                  : aDays === null
                    ? 'A-Day groups are updating.'
                    : aDays.availability === 'UNAVAILABLE'
                      ? 'A-Day groups could not be checked.'
                      : 'No A-Day groups configured for this shift.'}
              </output>
            ) : null}
          </div>
          <div className={styles.boardPagination}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={boardView === 'a-days' ? 'Previous A-Days' : 'Previous seats'}
              disabled={shownPage === 0}
              onClick={() => setBoardPage(shownPage - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <output aria-live="polite">
              {pages.length > 1
                ? `${boardView === 'a-days' ? 'A-Days' : 'Seats'} ${shownPage + 1} / ${pages.length}`
                : boardView === 'a-days'
                  ? aDays?.availability === 'AVAILABLE'
                    ? 'All A-Day groups shown'
                    : 'Waiting for A-Day groups'
                  : 'All seats shown'}
            </output>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={boardView === 'a-days' ? 'Next A-Days' : 'Next seats'}
              disabled={shownPage === pages.length - 1}
              onClick={() => setBoardPage(shownPage + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </section>
        {queueOpen ? (
          <aside
            id="presentation-remaining-bidders"
            className={styles.queue}
            aria-label="Remaining bidders"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeQueue();
            }}
          >
            <header className={styles.queueHeading}>
              <h2>Remaining · {queue.length}</h2>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Close remaining bidders"
                onClick={closeQueue}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>
            <ol ref={queueRef} className={styles.queueMembers}>
              {queue
                .slice(shownQueuePage * queuePageSize, (shownQueuePage + 1) * queuePageSize)
                .map((member) => {
                  const current = member.member_id === view.current_bidder?.member_id;
                  const onDeck = member.member_id === next?.member_id;
                  return (
                    <li
                      key={member.member_id}
                      className={`${styles.queueMember} ${current ? styles.queueCurrent : onDeck ? styles.queueOnDeck : ''}`}
                      aria-current={current ? 'true' : undefined}
                      data-testid="presentation-queue-member"
                    >
                      <strong>{member.name}</strong>
                      <span>
                        {member.rank}
                        {current ? ' · Now bidding' : onDeck ? ' · On deck' : ''}
                        {member.pending_a_day ? ' · A-Day due' : ''}
                      </span>
                    </li>
                  );
                })}
              {queue.length === 0 ? (
                <li className={styles.emptyBoard}>No remaining bidders.</li>
              ) : null}
            </ol>
            <div className={styles.queuePagination}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Previous bidders"
                disabled={shownQueuePage === 0}
                onClick={() => setQueueAnchor((shownQueuePage - 1) * queuePageSize)}
              >
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              <output>
                {shownQueuePage + 1} / {queuePages}
              </output>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Next bidders"
                disabled={shownQueuePage === queuePages - 1}
                onClick={() => setQueueAnchor((shownQueuePage + 1) * queuePageSize)}
              >
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </>
  );
}

export function PresentationView({
  initial,
  sessionId,
}: { initial: Presentation; sessionId?: string }) {
  const [view, setView] = useState(initial);
  const received = useRef(initial);
  const [updates, setUpdates] = useState<'current' | 'disconnected' | 'stale'>('current');
  useEffect(() => {
    let disposed = false;
    let pending: AbortController | null = null;
    let pendingAt = 0;
    async function refresh() {
      if (disposed) return;
      if (pending) {
        // A normal 2–4 second request must not flash a false stale warning.
        if (Date.now() - pendingAt >= 8000)
          setUpdates((status) => (status === 'disconnected' ? status : 'stale'));
        return;
      }
      const controller = new AbortController();
      pending = controller;
      pendingAt = Date.now();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(presentationApiPath(sessionId), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Presentation refresh rejected');
        const next = (await response.json()) as Presentation;
        if (disposed) return;
        const previous = received.current;
        if (sessionId !== undefined && next.session?.id !== sessionId) {
          setUpdates('stale');
          return;
        }
        if (
          previous.session?.id === next.session?.id &&
          typeof previous.sequence === 'number' &&
          (!Number.isSafeInteger(next.sequence) || Number(next.sequence) < previous.sequence)
        ) {
          setUpdates('stale');
          return;
        }
        received.current = next;
        setView(next);
        setUpdates('current');
      } catch {
        if (!disposed) setUpdates('disconnected');
      } finally {
        clearTimeout(timeout);
        if (pending === controller) pending = null;
      }
    }
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
      pending?.abort();
    };
  }, [sessionId]);
  const refreshStatus =
    updates !== 'current' ? (
      <output className={styles.refreshWarning}>
        <strong>
          {updates === 'disconnected' ? 'Updates disconnected' : 'Waiting for current updates'}
        </strong>
        <span> · Last received board; reconnecting automatically.</span>
      </output>
    ) : null;
  const modeLabel =
    view.mode === 'HOLD'
      ? `DISPLAY HELD · SEQ ${view.held_at_sequence}`
      : updates === 'current'
        ? 'LIVE DISPLAY'
        : 'UPDATES STALE';

  return (
    <div className={styles.frame} data-testid="presentation-frame">
      <MockBanner isMock={view.session?.is_mock === true} sessionId={view.session?.id ?? ''} />
      {view.mode === 'OFF' ? (
        <main className={styles.off}>
          {refreshStatus}
          <div>
            <p className={styles.eyebrow}>MBFD Annual Bid</p>
            <h1>Presentation is off</h1>
            <p>
              {view.session?.is_mock
                ? 'Start this Mock if needed, then choose LIVE in its Presentation controls.'
                : 'The Bid operator has not published the audience display.'}
            </p>
            {view.session?.is_mock ? (
              <a href={`/admin/bid?session_id=${encodeURIComponent(view.session.id)}`}>
                Open this Mock Bid
              </a>
            ) : null}
          </div>
        </main>
      ) : (
        <main className={styles.main} data-testid="department-presentation">
          <header className={styles.header} data-testid="presentation-header">
            <p className={styles.brand}>
              MBFD <span>Annual Bid {view.session?.bid_year}</span>
            </p>
            <span className={styles.stage}>
              {view.paused ? 'Bidding paused' : (view.current_stage?.label ?? 'Between stages')}
            </span>
            <span
              className={`${styles.displayMode} ${view.mode === 'HOLD' || updates !== 'current' ? styles.held : ''}`}
            >
              {modeLabel}
            </span>
            <span className={styles.progress}>
              {view.progress?.filled ?? 0} / {view.progress?.total ?? 0} taken
            </span>
          </header>
          {refreshStatus}
          {view.specialty ? (
            <output className={styles.specialty}>
              {view.specialty.label} · {view.specialty.position_id} · {view.specialty.status}
            </output>
          ) : null}
          <PresentationBoard view={view} />
        </main>
      )}
    </div>
  );
}
