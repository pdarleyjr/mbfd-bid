'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { AdminBidBoardSchema } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { BoardSeats } from './BoardSeats';
import { HistoricalBidImport, HistoricalBidPanel } from './HistoricalBidPanel';

const LABELS = { previous: 'Previous Bid', current: 'Current Staffing', upcoming: 'Upcoming Bid' };
const POLL_MS = 60_000;

export { BoardSeats } from './BoardSeats';

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
  const historical = params.get('history') ?? '';
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
  const archives = useQuery({
    queryKey: ['admin', 'historical-bids'],
    enabled: view === 'previous',
    staleTime: 30_000,
    queryFn: async () => {
      const response = await fetch('/api/admin/historical-bids', { credentials: 'include' });
      if (!response.ok) throw new Error('Could not check historical archives');
      return (await response.json()) as { years: number[] };
    },
  });
  const defaultHistoricalYear =
    (archives.data?.years[0] ?? 0) > (official.data?.sources[0]?.year ?? 0)
      ? archives.data?.years[0]
      : undefined;
  const historicalYear =
    historical && /^\d{4}$/.test(historical)
      ? Number(historical)
      : !session
        ? defaultHistoricalYear
        : undefined;
  const showingHistory = view === 'previous' && historicalYear !== undefined;
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
      (view !== 'previous' || (!showingHistory && Boolean(resolvedSession))),
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
  const data = showingHistory ? undefined : board.data;
  const inputClass =
    'min-h-11 min-w-0 w-full rounded border border-border bg-card px-3 text-foreground';
  return (
    <section className="mx-auto max-w-[100rem] space-y-6 text-foreground">
      <header>
        <h1 className="font-heading text-3xl">Bid Board</h1>
        <p className="mt-2 max-w-3xl text-foreground">
          Review completed awards, dated staffing, and the designated annual plan independently.
        </p>
      </header>
      <nav
        aria-label="Board views"
        className="inline-flex max-w-full flex-wrap gap-1 rounded-lg border border-border bg-card p-1"
      >
        {Object.entries(LABELS).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            aria-current={view === value ? 'page' : undefined}
            onClick={() => select('view', value)}
            className={`min-h-11 rounded px-4 font-semibold ${view === value ? 'bg-info text-primary-foreground border-info' : 'border-transparent bg-card text-foreground'}`}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="flex flex-wrap items-end gap-4">
        <Label className="grid gap-1 text-sm">
          Shift
          <NativeSelect
            value={shift}
            onChange={(e) => select('shift', e.target.value)}
            className={inputClass}
          >
            {['A', 'B', 'C', 'D'].map((s) => (
              <option key={s} value={s}>
                {s === 'D' ? 'D / Days' : `${s} Shift`}
              </option>
            ))}
          </NativeSelect>
        </Label>
        {view === 'upcoming' && (
          <Label className="grid gap-1 text-sm">
            Annual plan
            <NativeSelect
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
            </NativeSelect>
          </Label>
        )}
        {view === 'previous' && (
          <Label className="grid gap-1 text-sm">
            Previous bid source
            <NativeSelect
              value={historicalYear ? `history:${historicalYear}` : session}
              onChange={(e) => {
                const next = new URLSearchParams(params.toString());
                next.delete('session');
                next.delete('history');
                if (e.target.value.startsWith('history:'))
                  next.set('history', e.target.value.slice(8));
                else if (e.target.value) next.set('session', e.target.value);
                router.push(`${pathname}?${next}` as Route);
              }}
              className={inputClass}
            >
              <option value="">Latest available previous bid</option>
              {archives.data?.years.map((archiveYear) => (
                <option key={archiveYear} value={`history:${archiveYear}`}>
                  {archiveYear} · Historical source documents
                </option>
              ))}
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
            </NativeSelect>
          </Label>
        )}
        {view === 'current' && (
          <Label className="grid gap-1 text-sm">
            Staffing as of
            <Input
              type="date"
              value={asOf || data?.source.asOf || ''}
              onChange={(e) => select('as_of', e.target.value)}
              className={inputClass}
            />
          </Label>
        )}
        <Label className="grid min-w-0 flex-1 basis-full gap-1 text-sm sm:basis-48">
          Search this view
          <Input
            type="search"
            placeholder="Members, positions or stations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
        </Label>
      </div>
      {view === 'upcoming' && !year && <p>Select an annual plan to view its designated seats.</p>}
      {view === 'previous' && official.isFetching && (
        <output className="block text-sm text-foreground">Checking completed official bids…</output>
      )}
      {view === 'previous' && official.isError && (
        <Alert>
          {official.error.message}.{' '}
          {data
            ? 'Showing the last verified selection; a newer completion may be available.'
            : 'Try again when the connection returns.'}
        </Alert>
      )}
      {view === 'previous' && archives.isError && <Alert>{archives.error.message}</Alert>}
      {view === 'previous' &&
        official.isSuccess &&
        archives.isSuccess &&
        !resolvedSession &&
        !showingHistory && (
          <p>
            No verified completed official Bid is available. Mock, incomplete and unverified
            sessions are excluded.
          </p>
        )}
      {showingHistory && <HistoricalBidPanel year={historicalYear} shift={shift} search={search} />}
      {view === 'previous' && <HistoricalBidImport />}
      {board.isFetching && (
        <output className="block text-sm text-foreground">Refreshing board…</output>
      )}
      {board.isError && (
        <Alert>
          {board.error.message}.
          {data
            ? ' Showing the last successful data for this selection.'
            : ' Review the selection or return to annual preparation.'}
        </Alert>
      )}
      {data && (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-y border-border py-3 text-sm">
            <strong className="flex items-center gap-2">
              <Badge
                className={
                  shift === 'A'
                    ? 'text-shift-a'
                    : shift === 'B'
                      ? 'text-shift-b'
                      : shift === 'C'
                        ? 'text-shift-c'
                        : ''
                }
              >
                {shift} Shift
              </Badge>
              {LABELS[data.view]} · {data.lifecycle}
            </strong>
            <span className="tabular-nums">{data.seats.length} seats in this shift</span>
            <span>Updated {new Date(board.dataUpdatedAt).toLocaleTimeString()}</span>
          </div>
          {data.notice && <p className="text-sm text-warning">{data.notice}</p>}
          <BoardSeats board={data} search={search} />
          <details className="border-t border-border pt-4 text-sm text-foreground">
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
