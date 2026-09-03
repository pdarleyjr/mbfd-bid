'use client';

import { useEffect, useState } from 'react';

export type Presentation = {
  mode: 'OFF' | 'LIVE' | 'HOLD';
  held_at_sequence?: number | null;
  sequence?: number;
  session: { id: string; bid_year: number; is_mock?: boolean } | null;
  current_stage?: { id: string | null; label: string | null };
  current_bidder?: { member_id: number; name: string; rank: string | null } | null;
  on_deck?: Array<{ member_id: number; name: string; rank: string | null } | null>;
  phase?: string;
  paused?: boolean;
  complete?: boolean;
  progress?: { filled: number; total: number };
  positions?: Array<{
    id: string;
    shift: string;
    station: string;
    unit: string;
    position_name: string;
    rank_required: string;
    filled_by: { member_id: number; name: string; rank: string | null } | null;
  }>;
  specialty?: { active: true; label: string; position_id: string; status: string } | null;
};

export function PresentationView({ initial }: { initial: Presentation }) {
  const [view, setView] = useState(initial);
  useEffect(() => {
    const timer = setInterval(() => {
      void fetch('/api/presentation', { cache: 'no-store' })
        .then(async (response) => {
          if (response.ok) setView((await response.json()) as Presentation);
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  if (view.mode === 'OFF') {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-8 text-center text-white">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-red-400">
            MBFD Annual Bid
          </p>
          <h1 className="mt-4 font-heading text-5xl">Presentation is off</h1>
          <p className="mt-3 text-xl text-slate-300">
            The Bid operator has not published the audience display.
          </p>
        </div>
      </main>
    );
  }
  const percent = view.progress?.total
    ? Math.round((view.progress.filled / view.progress.total) * 100)
    : 0;
  return (
    <main className="min-h-screen bg-stone-50 text-stone-950" data-testid="department-presentation">
      <header className="bg-slate-950 px-6 py-5 text-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-red-400">
              MBFD Annual Bid {view.session?.bid_year}
            </p>
            <h1 className="font-heading text-3xl">Department progress</h1>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full border border-slate-600 px-4 py-2 text-sm">
              {view.phase?.replaceAll('_', ' ')}
            </span>
            {view.mode === 'HOLD' ? (
              <span className="rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-amber-950">
                DISPLAY HELD · SEQ {view.held_at_sequence}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950">
                LIVE DISPLAY
              </span>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1500px] space-y-6 p-6">
        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <article className="rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
            <p className="text-sm font-bold uppercase tracking-wide text-red-700">Current stage</p>
            <h2 className="mt-1 font-heading text-4xl">
              {view.current_stage?.label ?? 'Between stages'}
            </h2>
            <p className="mt-7 text-sm uppercase tracking-wide text-stone-500">Now bidding</p>
            <p className="mt-1 font-heading text-5xl">
              {view.current_bidder?.name ?? (view.complete ? 'Bid complete' : 'Awaiting bidder')}
            </p>
            <p className="mt-2 text-2xl text-stone-600">{view.current_bidder?.rank}</p>
            {view.specialty ? (
              <div className="mt-6 rounded-xl border border-amber-400 bg-amber-50 p-4">
                <p className="font-bold text-amber-950">
                  {view.specialty.label} · {view.specialty.position_id}
                </p>
                <p className="text-amber-900">{view.specialty.status}</p>
              </div>
            ) : null}
          </article>
          <article className="rounded-2xl bg-slate-900 p-7 text-white">
            <p className="text-sm font-bold uppercase tracking-wide text-slate-400">On deck</p>
            <ol className="mt-4 space-y-4">
              {view.on_deck?.filter(Boolean).map((member, index) => (
                <li key={member?.member_id} className="border-b border-slate-700 pb-4">
                  <span className="text-slate-400">{index + 1}</span>
                  <strong className="ml-4 text-2xl">{member?.name}</strong>
                  <span className="ml-2 text-slate-400">{member?.rank}</span>
                </li>
              ))}
            </ol>
          </article>
        </section>
        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <div className="flex justify-between text-sm font-bold">
            <span>Overall progress</span>
            <span>
              {view.progress?.filled ?? 0} of {view.progress?.total ?? 0} positions · {percent}%
            </span>
          </div>
          <div className="mt-3 h-4 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full bg-red-700" style={{ width: `${percent}%` }} />
          </div>
        </section>
        <section>
          <h2 className="font-heading text-2xl">Station and apparatus board</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {view.positions?.map((position) => (
              <article
                key={position.id}
                className={`rounded-xl border p-4 ${position.filled_by ? 'border-emerald-300 bg-emerald-50' : 'border-stone-300 bg-white'}`}
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                      {position.shift} Shift · Station {position.station}
                    </p>
                    <h3 className="text-xl font-bold">{position.unit}</h3>
                    <p className="text-stone-600">
                      {position.position_name} · {position.rank_required}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-stone-500">{position.id}</span>
                </div>
                <p className="mt-4 text-lg font-semibold">
                  {position.filled_by?.name ?? 'Available'}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
