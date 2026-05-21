'use client';

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

interface Props {
  initialMembers: RosterMember[];
  credentials: CredentialRow[];
  initialSearch: string;
  /** Bundled synthesis JSON string for the pre-fill button. */
  synthesisJson: string;
}

export function RosterClient({ initialMembers, credentials, initialSearch, synthesisJson }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [members, setMembers] = useState<RosterMember[]>(initialMembers);
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [toast, setToast] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

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
      if (next.trim().length === 0) params.delete('search');
      else params.set('search', next.trim());
      startTransition(() => {
        router.replace(`/admin/members/roster${params.toString() ? `?${params.toString()}` : ''}`);
      });
    }, 300);
  }

  function onRankChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === '') params.delete('rank');
    else params.set('rank', next);
    startTransition(() => {
      router.replace(`/admin/members/roster${params.toString() ? `?${params.toString()}` : ''}`);
    });
  }

  async function toggleCred(memberId: number, credentialId: number) {
    // Optimistic update — flip the cert locally; revert on error.
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== memberId) return m;
        const has = m.credential_ids.includes(credentialId);
        return {
          ...m,
          credential_ids: has
            ? m.credential_ids.filter((c) => c !== credentialId)
            : [...m.credential_ids, credentialId],
        };
      }),
    );

    try {
      const res = await fetch(`/api/admin/members/${memberId}/credentials/${credentialId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      setToast('Saved.');
      startTransition(() => router.refresh());
    } catch (err) {
      // Revert optimistic change.
      setMembers((prev) =>
        prev.map((m) => {
          if (m.id !== memberId) return m;
          const has = m.credential_ids.includes(credentialId);
          return {
            ...m,
            credential_ids: has
              ? m.credential_ids.filter((c) => c !== credentialId)
              : [...m.credential_ids, credentialId],
          };
        }),
      );
      setToast(`Toggle failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async function moveMember(memberId: number, direction: 'up' | 'down') {
    // Lightweight reorder: swap with neighbor in local state, then PATCH
    // bid-order with the new ordinals. session_id is required by the worker —
    // for now we surface "no active session" if no session is in URL.
    const sessionId = searchParams.get('session_id');
    if (!sessionId) {
      setToast(
        'Manual reorder requires an active bid session. Open this page with ?session_id=...',
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

  async function preFillFromSynthesis() {
    const ok = window.confirm(
      'Bootstrap the bid roster from the canonical credentials extract? Missing members are inserted, existing members have their rank and seniority refreshed, and every credential each member holds is linked. Already-present credentials are not touched. Admin can still toggle individual certs from this page at any time.',
    );
    if (!ok) return;
    setSeeding(true);
    try {
      const res = await fetch('/api/admin/members/seed-from-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: synthesisJson,
      });
      if (!res.ok) {
        setToast(`Seed failed: ${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        membersInserted: number;
        membersUpdated: number;
        certsInserted: number;
        skippedMembers: Array<{ employee_id: string; reason: string }>;
        missingCredentials: string[];
      };
      const parts = [
        `${body.membersInserted} inserted`,
        `${body.membersUpdated} updated`,
        `${body.certsInserted} certs linked`,
      ];
      if (body.skippedMembers.length > 0) {
        parts.push(`${body.skippedMembers.length} skipped`);
      }
      if (body.missingCredentials.length > 0) {
        parts.push(`${body.missingCredentials.length} unknown cert names`);
      }
      setToast(parts.join('; '));
      startTransition(() => router.refresh());
    } catch (err) {
      setToast(`Seed failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSeeding(false);
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

        <div className="ml-auto">
          <button
            type="button"
            onClick={preFillFromSynthesis}
            disabled={seeding}
            className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
          >
            {seeding
              ? 'Bootstrapping...'
              : members.length === 0
                ? 'Bootstrap roster from credentials extract'
                : 'Re-sync credentials from extract'}
          </button>
        </div>
      </div>

      {toast !== null && (
        <output aria-live="polite" className="mt-3 block text-sm text-emerald-400">
          {toast}
        </output>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Members master roster with credential toggles</caption>
          <thead className="bg-slate-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-300">#</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Emp ID</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Name</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Rank</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">RSC</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Rank Sen.</th>
              <th className="px-3 py-2 text-left font-medium text-slate-300">Credentials</th>
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
                      disabled={idx === 0 || isPending}
                      className="rounded border border-slate-700 px-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${m.last_name} down`}
                      onClick={() => moveMember(m.id, 'down')}
                      disabled={idx === members.length - 1 || isPending}
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
                    {sortedCredentials.map((cred) => {
                      const held = m.credential_ids.includes(cred.id);
                      const note = CREDENTIAL_NOTES[cred.name];
                      return (
                        <button
                          key={cred.id}
                          type="button"
                          title={note ? `${cred.name} — ${note}` : cred.name}
                          aria-pressed={held}
                          onClick={() => toggleCred(m.id, cred.id)}
                          className={[
                            'inline-flex max-w-[160px] truncate rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                            held
                              ? 'bg-red-700 text-white'
                              : 'border border-slate-600 text-slate-300 hover:border-slate-400',
                          ].join(' ')}
                        >
                          {cred.name}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  <p className="font-medium text-slate-200">No members in the bid roster.</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Click "Bootstrap roster from credentials extract" above to load every member and
                    the credentials they hold in one click.
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
