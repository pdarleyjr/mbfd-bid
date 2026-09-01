'use client';

import { useMemo, useState } from 'react';

export interface ReadinessItem {
  memberId: number;
  memberName: string;
  rank: string;
  credential: string | null;
  specialty: string | null;
  classification: string;
  effectiveOn: string | null;
  expiresOn: string | null;
  sourceProvenance: string;
  recentlyChanged: boolean;
  affectedBidOpportunities: string;
}

export function ReadinessWorkspace({
  items,
  annualDetermination,
}: { items: ReadinessItem[]; annualDetermination: string }) {
  const [query, setQuery] = useState('');
  const [classification, setClassification] = useState('ALL');
  const [rank, setRank] = useState('ALL');
  const [credential, setCredential] = useState('ALL');
  const [specialty, setSpecialty] = useState('ALL');
  const [provenance, setProvenance] = useState('ALL');
  const filterValues = (
    field: keyof Pick<ReadinessItem, 'rank' | 'credential' | 'specialty' | 'sourceProvenance'>,
  ) => [...new Set(items.map((item) => item[field] ?? '—'))].sort();
  const visible = useMemo(
    () =>
      items.filter((item) => {
        const haystack =
          `${item.memberName} ${item.rank} ${item.credential ?? ''} ${item.specialty ?? ''} ${item.sourceProvenance}`.toLowerCase();
        return (
          haystack.includes(query.toLowerCase()) &&
          (classification === 'ALL' || item.classification === classification) &&
          (rank === 'ALL' || item.rank === rank) &&
          (credential === 'ALL' || (item.credential ?? '—') === credential) &&
          (specialty === 'ALL' || (item.specialty ?? '—') === specialty) &&
          (provenance === 'ALL' || item.sourceProvenance === provenance)
        );
      }),
    [items, query, classification, rank, credential, specialty, provenance],
  );
  return (
    <section className="space-y-4" aria-label="Certification readiness">
      <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-100">
        <strong>
          Official annual determination:{' '}
          {annualDetermination === 'PENDING_CONFIGURATION' ? 'pending configuration' : 'configured'}
          .
        </strong>{' '}
        This view does not infer an annual qualification date or alter Bid snapshots.
      </div>
      <div className="flex flex-wrap gap-3">
        <input
          aria-label="Search readiness"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search member, rank, credential, specialty, provenance"
          className="min-h-11 flex-1 rounded border border-slate-600 bg-slate-950 px-3 text-white"
        />
        <select
          aria-label="Readiness state"
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          className="min-h-11 rounded border border-slate-600 bg-slate-950 px-3 text-white"
        >
          <option value="ALL">All states</option>
          {['EXPIRED', 'EXPIRING_SOON', 'VALID_NO_EXPIRATION', 'VALID', 'CONFLICT', 'MISSING'].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
        {(
          [
            ['Rank', rank, setRank, 'rank'],
            ['Credential', credential, setCredential, 'credential'],
            ['Specialty', specialty, setSpecialty, 'specialty'],
            ['Provenance', provenance, setProvenance, 'sourceProvenance'],
          ] as const
        ).map(([label, value, setValue, field]) => (
          <select
            key={label}
            aria-label={`${label} filter`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-11 rounded border border-slate-600 bg-slate-950 px-3 text-white"
          >
            <option value="ALL">All {label.toLowerCase()}s</option>
            {filterValues(field).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        ))}
      </div>
      <p className="text-sm text-slate-300">
        {visible.length} evidence item(s). Current/future projections only; affected Bid
        opportunities remain explicitly undetermined until a centrally owned opportunity-impact
        interface is available.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-200">
            <tr>
              {[
                'Member / rank',
                'Credential / specialty',
                'State',
                'Effective / expiration',
                'Source / provenance',
                'Bid impact',
              ].map((label) => (
                <th key={label} className="p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((item, i) => (
              <tr key={`${item.memberId}-${i}`} className="border-t border-slate-700">
                <td className="p-3">
                  {item.memberName}
                  <div className="text-xs text-slate-400">{item.rank}</div>
                </td>
                <td className="p-3">
                  {item.credential ?? '—'}
                  <div className="text-xs text-slate-400">{item.specialty ?? '—'}</div>
                </td>
                <td className="p-3">
                  {item.classification}
                  {item.recentlyChanged ? (
                    <div className="text-xs text-sky-300">Recently changed</div>
                  ) : null}
                </td>
                <td className="p-3">
                  {item.effectiveOn ?? '—'}
                  <div className="text-xs text-slate-400">{item.expiresOn ?? 'No expiration'}</div>
                </td>
                <td className="p-3">{item.sourceProvenance}</td>
                <td className="p-3 text-xs text-slate-400">{item.affectedBidOpportunities}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
