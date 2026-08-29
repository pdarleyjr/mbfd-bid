'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  CREDENTIAL_NOTES,
  type CredentialRow,
  RANK_PILL_CLASS,
  type RosterMember,
} from '../_lib/station-info';

const RANK_FILTERS: ReadonlyArray<{ value: ''; label: 'All' } | { value: string; label: string }> =
  [
    { value: '', label: 'All' },
    { value: 'CPT', label: 'Captains' },
    { value: 'LT', label: 'Lieutenants' },
    { value: 'FF', label: 'Firefighters' },
  ];

const LEGACY_CREDENTIAL_NOTICE =
  'Legacy credential references in this members master roster are read-only credential evidence and do not establish current qualification; use the effective-dated qualification lifecycle for current status.';

export interface BidOrderSessionContext {
  sessionId: string;
  label: string;
}

interface Props {
  initialMembers: RosterMember[];
  credentials: CredentialRow[];
  initialSearch: string;
  bidOrderSession?: BidOrderSessionContext | null;
}

export function RosterClient({
  initialMembers,
  credentials,
  initialSearch,
  bidOrderSession = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [members, setMembers] = useState<RosterMember[]>(initialMembers);
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [toast, setToast] = useState<string | null>(null);

  // Keep local state in sync when the server re-renders after a router.refresh().
  useEffect(() => {
    setMembers(initialMembers);
  }, [initialMembers]);

  // Sort credentials alphabetically for the pill cluster.
  const sortedCredentials = useMemo(
    () => [...credentials].sort((a, b) => a.name.localeCompare(b.name)),
    [credentials],
  );

  // Debounced URL update on search input.
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(next: string) {
    setSearchValue(next);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('session_id');
      params.delete('bidSessionId');
      if (next.trim().length === 0) params.delete('search');
      else params.set('search', next.trim());
      startTransition(() => {
        router.replace(`/admin/members/roster${params.toString() ? `?${params.toString()}` : ''}`);
      });
    }, 300);
  }

  function onRankChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('session_id');
    params.delete('bidSessionId');
    if (next === '') params.delete('rank');
    else params.set('rank', next);
    startTransition(() => {
      router.replace(`/admin/members/roster${params.toString() ? `?${params.toString()}` : ''}`);
    });
  }

  async function moveMember(memberId: number, direction: 'up' | 'down') {
    // The server supplies the verified active session context. Its internal
    // key never needs to be copied into the browser URL or an operator form.
    const sessionId = bidOrderSession?.sessionId;
    if (!sessionId) {
      setToast(
        'Manual bid-order reordering is unavailable because no active Bid session is verified.',
      );
      return;
    }
    const idx = members.findIndex((m) => m.id === memberId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= members.length) return;

    const a = members[idx];
    const b = members[targetIdx];
    if (!a || !b) return;

    const reordered = [...members];
    [reordered[idx], reordered[targetIdx]] = [b, a];
    setMembers(reordered);

    const overrides = reordered.map((m, i) => ({
      member_id: m.id,
      override_ordinal: i + 1,
    }));

    try {
      const res = await fetch('/api/admin/members/bid-order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, overrides }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setToast('Order saved.');
      startTransition(() => router.refresh());
    } catch (err) {
      setMembers(members); // revert
      setToast(`Reorder failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-300">
          <span className="sr-only">Search members</span>
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name or employee ID"
            className="min-h-10 w-72 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm text-white focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700"
          />
        </label>

        <fieldset className="flex gap-1">
          <legend className="sr-only">Filter by rank</legend>
          {RANK_FILTERS.map((f) => {
            const active = (searchParams.get('rank') ?? '') === f.value;
            const id = `rank-filter-${f.value || 'all'}`;
            return (
              <label
                key={f.value || 'all'}
                htmlFor={id}
                className={[
                  'flex min-h-10 cursor-pointer items-center rounded-md border px-3 text-sm font-medium transition-colors duration-fast ease-out-quart',
                  active
                    ? 'border-red-700 bg-red-700 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500',
                ].join(' ')}
              >
                <input
                  id={id}
                  type="radio"
                  name="rank-filter"
                  className="sr-only"
                  checked={active}
                  onChange={() => onRankChange(f.value)}
                />
                {f.label}
              </label>
            );
          })}
        </fieldset>

        <div className="ml-auto flex flex-wrap gap-2">
          <Link
            href={'/admin/telestaff' as Route}
            className="inline-flex min-h-10 items-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-600"
          >
            TeleStaff reconciliation
          </Link>
          <Link
            href={'/admin/personnel' as Route}
            className="inline-flex min-h-10 items-center rounded-md border border-slate-600 px-4 text-sm font-semibold text-slate-100 hover:border-slate-400"
          >
            Personnel lifecycle
          </Link>
        </div>
      </div>

      <p data-testid="bid-order-session-context" className="mt-3 text-sm text-slate-300">
        {bidOrderSession === null
          ? 'Manual bid-order reordering is unavailable because no active Bid session is verified.'
          : `Manual bid order applies to ${bidOrderSession.label}. The selected session remains attached automatically.`}
      </p>

      {toast !== null && (
        <output aria-live="polite" className="mt-3 block text-sm text-emerald-400">
          {toast}
        </output>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{LEGACY_CREDENTIAL_NOTICE}</caption>
          <thead className="bg-slate-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-300">#</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Emp ID</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Name</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Rank</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">RSC</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Rank Sen.</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">
                Credential references
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((m, idx) => (
              <tr
                key={m.id}
                className="border-slate-800 border-t transition-colors hover:bg-slate-900/40"
              >
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-1">
                    <span className="w-6 font-mono [font-variant-numeric:tabular-nums] text-slate-300">
                      {m.ordinal}
                    </span>
                    <button
                      type="button"
                      aria-label={`Move ${m.last_name} up`}
                      onClick={() => moveMember(m.id, 'up')}
                      disabled={idx === 0 || isPending || bidOrderSession === null}
                      className="rounded border border-slate-700 px-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${m.last_name} down`}
                      onClick={() => moveMember(m.id, 'down')}
                      disabled={idx === members.length - 1 || isPending || bidOrderSession === null}
                      className="rounded border border-slate-700 px-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                  {m.manual_override_ordinal !== null && (
                    <span className="ml-1 inline-block rounded bg-amber-700/50 px-1 text-[10px] text-amber-100">
                      override
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-300 [font-variant-numeric:tabular-nums]">
                  {m.employee_id}
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="font-medium text-white">{m.last_name}</span>
                  <span className="text-slate-400">, {m.first_name}</span>
                </td>
                <td className="px-3 py-2 align-top">
                  <span
                    className={[
                      'inline-flex rounded px-2 py-0.5 text-xs font-semibold',
                      RANK_PILL_CLASS[m.rank],
                    ].join(' ')}
                  >
                    {m.rank}
                  </span>
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-300 [font-variant-numeric:tabular-nums]">
                  {m.rsc_seniority}
                </td>
                <td className="px-3 py-2 align-top font-mono text-xs text-slate-300 [font-variant-numeric:tabular-nums]">
                  {m.rank_seniority ?? '—'}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-wrap gap-1">
                    {sortedCredentials
                      .filter((cred) => m.credential_ids.includes(cred.id))
                      .map((cred) => {
                        const note = CREDENTIAL_NOTES[cred.name];
                        return (
                          <span
                            key={cred.id}
                            title={note ? `${cred.name} — ${note}` : cred.name}
                            className="inline-flex max-w-[160px] truncate rounded bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-100"
                          >
                            {cred.name}
                          </span>
                        );
                      })}
                    {m.credential_ids.length === 0 && (
                      <span className="text-xs text-slate-500">
                        No legacy credential references on file
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/admin/personnel/qualifications?memberId=${m.id}` as Route}
                    className="mt-2 inline-flex text-xs font-medium text-red-300 hover:text-red-200"
                  >
                    Review qualification lifecycle
                  </Link>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  <p className="font-medium text-slate-200">No members in the bid roster.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Bring an approved official staffing source through TeleStaff reconciliation; do
                    not bootstrap a current roster from a local credentials extract.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
