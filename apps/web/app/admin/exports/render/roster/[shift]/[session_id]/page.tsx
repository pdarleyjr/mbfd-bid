// Plan 08 Task 13 — Print-stylesheet RSC for Browserless to render to PDF.
//
// Public URL (called by Browserless via the worker's POST /export trigger):
//   GET /admin/exports/render/roster/A/01HF3?token=...
//
// The token is a 5-min HMAC minted by the worker (Plan 08 Task 14 /print-token
// endpoint) and verified here. The page is RSC-only (no client islands) so
// Browserless gets a single static document.

import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { verifyPrintToken } from '@/lib/print-token';
import { getWorkerBase } from '@/lib/worker-base';

import './print.css';

export const runtime = 'edge';
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
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as RosterPayload;
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
  const ok = await verifyPrintToken(token, { kind: 'roster', shift, session_id: sessionId });
  if (!ok) {
    return <div className="auth-error">Unauthorized — invalid or expired print token.</div>;
  }
  if (!['A', 'B', 'C', 'D'].includes(shift)) return notFound();

  const roster = await fetchRoster(sessionId, shift, token ?? '');
  if (!roster) return notFound();

  return (
    <main className="roster-page">
      <header className="roster-header">
        <h1>
          {roster.year} {shift} Shift Roster
        </h1>
        <p className="roster-meta">
          {roster.station_count} stations · {roster.position_count} positions · Generated{' '}
          {new Date().toISOString()}
        </p>
      </header>
      {roster.stations.map((s) => (
        <section key={s.station} className="station-block" data-station={s.station}>
          <h2>Station {s.station}</h2>
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
              {s.rows.map((r) => (
                <tr key={r.position_id} data-empty={r.member_name === null}>
                  <td>{r.unit}</td>
                  <td>{r.position_id}</td>
                  <td>{r.rank}</td>
                  <td>{r.member_name ?? <span className="vacant">VACANT</span>}</td>
                  <td className="num">{r.rsc_seniority ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
