// Public, short-lived print-token roster renderer used by Cloudflare Browser
// Rendering. This route intentionally lives outside /admin so the headless
// browser does not need an administrator session cookie. The Worker remains
// the sole authorization boundary and validates the token before returning
// immutable, session-scoped roster data.

import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { getWorkerBase } from '@/lib/worker-base';

import './print.css';

export const dynamic = 'force-dynamic';

type Shift = 'A' | 'B' | 'C' | 'D';

interface PageProps {
  params: Promise<{ shift: Shift; session_id: string }>;
  searchParams: Promise<{ token?: string }>;
}

interface RosterRow {
  position_id: string;
  unit: string;
  rank: string;
  member_name: string | null;
  rsc_seniority: number | null;
}

interface RosterStation {
  station: string;
  rows: RosterRow[];
}

interface RosterPayload {
  year: number;
  shift: Shift;
  station_count: number;
  position_count: number;
  stations: RosterStation[];
}

async function fetchRoster(
  sessionId: string,
  shift: Shift,
  token: string,
): Promise<RosterPayload | null> {
  const base = getWorkerBase();
  const url = `${base}/api/admin/exports/roster-data?session_id=${encodeURIComponent(
    sessionId,
  )}&shift=${shift}&token=${encodeURIComponent(token)}`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as RosterPayload;
  } catch {
    return null;
  }
}

export default async function RosterRenderPage({
  params,
  searchParams,
}: PageProps): Promise<ReactElement> {
  const { shift, session_id: sessionId } = await params;
  const { token } = await searchParams;
  if (!token || !['A', 'B', 'C', 'D'].includes(shift)) return notFound();

  const roster = await fetchRoster(sessionId, shift, token);
  if (!roster) return notFound();

  return (
    <main
      className="roster-page"
      data-roster-export="ready"
      data-session-id={sessionId}
      data-shift={shift}
    >
      <header className="roster-header">
        <h1>
          {roster.year} {shift} Shift Roster
        </h1>
        <p className="roster-meta">
          {roster.station_count} stations · {roster.position_count} positions · Generated{' '}
          {new Date().toISOString()}
        </p>
      </header>
      {roster.stations.map((station) => (
        <section key={station.station} className="station-block" data-station={station.station}>
          <h2>Station {station.station}</h2>
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Position</th>
                <th>Rank</th>
                <th>Member</th>
                <th>RSC</th>
              </tr>
            </thead>
            <tbody>
              {station.rows.map((row) => (
                <tr key={row.position_id} data-empty={row.member_name === null}>
                  <td>{row.unit}</td>
                  <td>{row.position_id}</td>
                  <td>{row.rank}</td>
                  <td>{row.member_name ?? <span className="vacant">VACANT</span>}</td>
                  <td className="num">{row.rsc_seniority ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
