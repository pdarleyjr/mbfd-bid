'use client';

import type { CurrentRosterResponse } from '../CurrentRostersWorkspace';

export function PrintRosterDocument({ roster }: { roster: CurrentRosterResponse }) {
  return (
    <main className="mx-auto max-w-6xl bg-white p-8 text-slate-950 print:max-w-none print:p-0">
      <div className="mb-6 flex items-start justify-between gap-4 print:hidden">
        <a
          href={`/admin/current-rosters?as_of=${encodeURIComponent(roster.asOf)}`}
          className="text-sm font-semibold text-red-700"
        >
          Back to roster workspace
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Print or save PDF
        </button>
      </div>
      <header className="border-b-2 border-slate-900 pb-4">
        <p className="text-xs font-bold uppercase tracking-wider">MBFD staffing report</p>
        <h1 className="mt-1 text-2xl font-bold">Current Roster</h1>
        <p className="mt-1 text-sm">
          Effective date: {roster.asOf} · Generated{' '}
          {new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC
        </p>
      </header>
      {(['A', 'B', 'C', 'D'] as const).map((shift) => {
        const positions = roster.positions.filter((position) => position.shift === shift);
        if (positions.length === 0) return null;
        return (
          <section key={shift} className="mt-7 break-inside-avoid">
            <h2 className="border-b border-slate-400 pb-1 text-lg font-bold">
              {shift === 'D' ? 'D / Days' : `${shift} Shift`}
            </h2>
            <table className="mt-3 w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-500">
                  <th className="p-2">Station</th>
                  <th className="p-2">Unit</th>
                  <th className="p-2">Seat / rank</th>
                  <th className="p-2">Member</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.id} className="border-b border-slate-200">
                    <td className="p-2">{position.station ?? 'Unspecified'}</td>
                    <td className="p-2">{position.unit ?? 'Unspecified'}</td>
                    <td className="p-2">
                      {position.positionName ?? 'Unspecified'} · {position.applicableRank ?? '—'}
                    </td>
                    <td className="p-2">
                      {position.member === null
                        ? 'VACANT'
                        : `${position.member.firstName ?? ''} ${position.member.lastName ?? ''}`}
                    </td>
                    <td className="p-2">
                      {position.administrativeAssignment
                        ? 'Administrative / non-biddable'
                        : position.occupancy}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <footer className="mt-8 border-t border-slate-400 pt-3 text-xs">
        Vacancies are staffing conditions only and are not Bid opportunities.
      </footer>
    </main>
  );
}
