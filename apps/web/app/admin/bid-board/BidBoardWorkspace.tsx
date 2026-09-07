'use client';

import { type AdminBidBoard, AdminBidBoardSchema } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const LABELS = { previous: 'Previous Bid', current: 'Current Staffing', upcoming: 'Upcoming Bid' };
const title = (s: string | null) => (s === null || s === '' ? 'Unmapped / Review Required' : s);
const POLL_MS = 60_000;

/** Presentation only: no Live Bid store, socket, or command dependency. */
export function BoardSeats({ board, search = '' }: { board: AdminBidBoard; search?: string }) {
  const visible = board.seats.filter((seat) =>
    [seat.station, seat.unit, seat.position].join(' ').toLowerCase().includes(search.toLowerCase()),
  );
  const stations = [...new Set(visible.map((seat) => seat.station))];
  return (
    <div className="space-y-6">
      {stations.length === 0 && (
        <p className="rounded border border-slate-600 p-5 text-slate-300">
          No seats in this view and selection.
        </p>
      )}
      {stations.map((station) => (
        <section
          key={station ?? 'unmapped'}
          className="overflow-hidden rounded-lg border border-slate-600"
        >
          <h2 className="border-b border-slate-600 bg-slate-800 px-4 py-3 font-heading text-xl">
            {station === null ? title(station) : `Station / group ${station}`}
          </h2>
          <div className="grid gap-px bg-slate-700 sm:grid-cols-2 xl:grid-cols-3">
            {visible
              .filter((seat) => seat.station === station)
              .map((seat) => (
                <article key={seat.id} className="min-w-0 bg-slate-900 p-4">
                  <p className="text-sm text-slate-300">{title(seat.unit)}</p>
                  <h3 className="mt-1 break-words font-semibold">{title(seat.position)}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    {seat.rank ?? 'Rank requires review'}
                  </p>
                  {'participation' in seat && (
                    <>
                      <p className="mt-3 text-sm">
                        {seat.participation === 'BIDDABLE'
                          ? 'Biddable'
                          : seat.participation === 'RESERVED_NON_BIDDABLE'
                            ? 'Reserved · Not biddable'
                            : 'Administratively assigned · Not biddable'}
                      </p>
                      {seat.mapping === 'review_required' && (
                        <p className="mt-1 text-sm text-amber-200">Unmapped / Review Required</p>
                      )}
                    </>
                  )}
                  {'occupant' in seat && (
                    <>
                      <p className="mt-3 text-sm">
                        {seat.occupancy === 'unmapped'
                          ? 'Unmapped / Review Required'
                          : (seat.occupant?.name ??
                            (seat.occupancy === 'vacant' ? 'Vacant' : 'Member name unavailable'))}
                      </p>
                      {seat.assignmentOrigin && (
                        <p className="mt-1 text-xs text-slate-400">
                          Assignment source: {seat.assignmentOrigin.replaceAll('_', ' ')}
                        </p>
                      )}
                      {seat.temporaryContext.map((overlay) => (
                        <p key={overlay.id} className="mt-2 text-sm text-amber-200">
                          {overlay.kind === 'LIGHT_DUTY'
                            ? 'Light duty'
                            : 'Temporary special assignment'}{' '}
                          from {overlay.effectiveOn}. Underlying assignment retained.
                          {overlay.plannedEndOn ? ` Planned end ${overlay.plannedEndOn}.` : ''}
                        </p>
                      ))}
                    </>
                  )}
                  {'award' in seat && (
                    <>
                      <p className="mt-3 text-sm">
                        {seat.award
                          ? (seat.award.name ??
                            `Member reference ${seat.award.memberId} · Historical name unavailable`)
                          : 'No final award'}
                      </p>
                      {seat.aDay && (
                        <p className="mt-1 text-sm text-slate-300">A-Day {seat.aDay}</p>
                      )}
                    </>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function BidBoardWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rawView = params.get('view') ?? 'current';
  const view: keyof typeof LABELS = Object.hasOwn(LABELS, rawView)
    ? (rawView as keyof typeof LABELS)
    : 'current';
  const rawShift = params.get('shift') ?? 'A';
  const shift = ['A', 'B', 'C', 'D'].includes(rawShift) ? rawShift : 'A';
  const year = params.get('year') ?? '';
  const asOf = params.get('as_of') ?? '';
  const session = params.get('session') ?? '';
  const [search, setSearch] = useState('');
  const select = (field: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(field, value);
    else next.delete(field);
    router.push(`${pathname}?${next}` as Route);
  };
  const plans = useQuery({
    queryKey: ['admin', 'annual-plan', 'list'],
    staleTime: 30_000,
    queryFn: async () => {
      const response = await fetch('/api/admin/annual-plan', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not load annual plans');
      return (await response.json()) as {
        plans: { year: number; ruleBookVersion: string | null }[];
      };
    },
  });
  // Resolve the moving "latest" selection separately from immutable award data.
  const official = useQuery({
    queryKey: ['admin', 'annual-plan', 'official-sources'],
    enabled: view === 'previous',
    staleTime: 30_000,
    queryFn: async () => {
      const response = await fetch('/api/admin/annual-plan/official-sources', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Could not check completed official bids');
      return (await response.json()) as {
        sources: { sessionId: string; year: number; completedAtMs: number }[];
      };
    },
  });
  const resolvedSession = session || official.data?.sources[0]?.sessionId || '';
  const board = useQuery({
    queryKey: [
      'admin',
      'bid-board',
      view,
      shift,
      year,
      asOf,
      view === 'previous' ? resolvedSession : session,
    ],
    enabled:
      (view !== 'upcoming' || /^\d{4}$/.test(year)) &&
      (view !== 'previous' || Boolean(resolvedSession)),
    staleTime: view === 'previous' ? Number.POSITIVE_INFINITY : 30_000,
    refetchOnWindowFocus: view !== 'previous',
    refetchOnReconnect: view !== 'previous',
    refetchIntervalInBackground: false,
    refetchInterval: (query) =>
      view === 'previous' || query.state.data?.lifecycle === 'FROZEN' ? false : POLL_MS,
    queryFn: async () => {
      const query = new URLSearchParams({ view, shift });
      if (year) query.set('year', year);
      if (asOf) query.set('as_of', asOf);
      if (view === 'previous') query.set('session', resolvedSession);
      const response = await fetch(`/api/admin/bid-board?${query}`, { credentials: 'include' });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error((error.error ?? 'Board unavailable').replaceAll('_', ' '));
      }
      return AdminBidBoardSchema.parse(await response.json());
    },
  });
  const data = board.data;
  const inputClass =
    'min-h-11 min-w-0 w-full rounded border border-slate-600 bg-slate-900 px-3 text-slate-100';
  return (
    <section className="mx-auto max-w-[100rem] space-y-6 text-slate-100">
      <header>
        <h1 className="font-heading text-3xl">Bid Board</h1>
        <p className="mt-2 max-w-3xl text-slate-300">
          Review completed awards, dated staffing, and the designated annual plan independently.
        </p>
      </header>
      <nav aria-label="Board views" className="flex flex-wrap gap-2">
        {Object.entries(LABELS).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={view === value ? 'page' : undefined}
            onClick={() => select('view', value)}
            className={`min-h-11 rounded px-4 font-semibold ${view === value ? 'bg-red-700 text-white' : 'border border-slate-600'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-sm">
          Shift
          <select
            value={shift}
            onChange={(e) => select('shift', e.target.value)}
            className={inputClass}
          >
            {['A', 'B', 'C', 'D'].map((s) => (
              <option key={s} value={s}>
                {s === 'D' ? 'D / Days' : `${s} Shift`}
              </option>
            ))}
          </select>
        </label>
        {view === 'upcoming' && (
          <label className="grid gap-1 text-sm">
            Annual plan
            <select
              value={year}
              onChange={(e) => select('year', e.target.value)}
              className={inputClass}
            >
              <option value="">Select designated year</option>
              {plans.data?.plans
                .filter((p) => p.ruleBookVersion)
                .map((p) => (
                  <option key={p.year} value={p.year}>
                    {p.year}
                  </option>
                ))}
            </select>
          </label>
        )}
        {view === 'previous' && (
          <label className="grid gap-1 text-sm">
            Completed official bid
            <select
              value={session}
              onChange={(e) => select('session', e.target.value)}
              className={inputClass}
            >
              <option value="">Latest verified completion</option>
              {session &&
                !official.data?.sources.some((source) => source.sessionId === session) && (
                  <option value={session}>Selected completion · verification required</option>
                )}
              {official.data?.sources.map((source) => (
                <option key={source.sessionId} value={source.sessionId}>
                  {source.year} · {new Date(source.completedAtMs).toLocaleDateString()} ·{' '}
                  {source.sessionId}
                </option>
              ))}
            </select>
          </label>
        )}
        {view === 'current' && (
          <label className="grid gap-1 text-sm">
            Staffing as of
            <input
              type="date"
              value={asOf || data?.source.asOf || ''}
              onChange={(e) => select('as_of', e.target.value)}
              className={inputClass}
            />
          </label>
        )}
        <label className="grid min-w-0 flex-1 basis-full gap-1 text-sm sm:basis-48">
          Search this view
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      {view === 'upcoming' && !year && <p>Select an annual plan to view its designated seats.</p>}
      {view === 'previous' && official.isFetching && (
        <output className="block text-sm text-slate-300">Checking completed official bids…</output>
      )}
      {view === 'previous' && official.isError && (
        <p role="alert" className="text-amber-200">
          {official.error.message}.{' '}
          {data
            ? 'Showing the last verified selection; a newer completion may be available.'
            : 'Try again when the connection returns.'}
        </p>
      )}
      {view === 'previous' && official.isSuccess && !resolvedSession && (
        <p>
          No verified completed official Bid is available. Mock, incomplete and unverified sessions
          are excluded.
        </p>
      )}
      {board.isFetching && (
        <output className="block text-sm text-slate-300">Refreshing board…</output>
      )}
      {board.isError && (
        <p role="alert" className="text-amber-200">
          {board.error.message}.
          {data
            ? ' Showing the last successful data for this selection.'
            : ' Review the selection or return to annual preparation.'}
        </p>
      )}
      {data && (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-slate-700 py-3 text-sm">
            <strong>
              {LABELS[data.view]} · {data.lifecycle}
            </strong>
            <span className="tabular-nums">{data.seats.length} seats in this shift</span>
            <span>Updated {new Date(board.dataUpdatedAt).toLocaleTimeString()}</span>
          </div>
          {data.notice && <p className="text-sm text-amber-200">{data.notice}</p>}
          <BoardSeats board={data} search={search} />
          <details className="border-t border-slate-700 pt-4 text-sm text-slate-300">
            <summary className="min-h-11 cursor-pointer">Source and revision details</summary>
            <dl className="grid gap-2 sm:grid-cols-2">
              {Object.entries(data.source)
                .filter(([, value]) => value !== null)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-semibold">{key}</dt>
                    <dd className="break-all">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </details>
        </>
      )}
    </section>
  );
}
