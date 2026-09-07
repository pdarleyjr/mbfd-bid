'use client';

import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
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
      <div className="rounded-xl border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
        <strong>
          Official annual determination:{' '}
          {annualDetermination === 'PENDING_CONFIGURATION' ? 'pending configuration' : 'configured'}
          .
        </strong>{' '}
        This view does not infer an annual qualification date or alter Bid snapshots.
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          aria-label="Search readiness"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search member, rank, credential, specialty, provenance"
          className="min-h-11 flex-1 rounded border border-border bg-card px-3 text-foreground"
        />
        <NativeSelect
          aria-label="Readiness state"
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          className="min-h-11 rounded border border-border bg-card px-3 text-foreground"
        >
          <option value="ALL">All states</option>
          {['EXPIRED', 'EXPIRING_SOON', 'VALID_NO_EXPIRATION', 'VALID', 'CONFLICT', 'MISSING'].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </NativeSelect>
        {(
          [
            ['Rank', rank, setRank, 'rank'],
            ['Credential', credential, setCredential, 'credential'],
            ['Specialty', specialty, setSpecialty, 'specialty'],
            ['Provenance', provenance, setProvenance, 'sourceProvenance'],
          ] as const
        ).map(([label, value, setValue, field]) => (
          <NativeSelect
            key={label}
            aria-label={`${label} filter`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-11 rounded border border-border bg-card px-3 text-foreground"
          >
            <option value="ALL">All {label.toLowerCase()}s</option>
            {filterValues(field).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </NativeSelect>
        ))}
      </div>
      <p className="text-sm text-foreground">
        {visible.length} evidence item(s). Current/future projections only; affected Bid
        opportunities remain explicitly undetermined until a centrally owned opportunity-impact
        interface is available.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table className="min-w-full text-left text-sm">
          <TableHeader className="bg-card text-foreground">
            <TableRow>
              {[
                'Member / rank',
                'Credential / specialty',
                'State',
                'Effective / expiration',
                'Source / provenance',
                'Bid impact',
              ].map((label) => (
                <TableHead key={label} className="p-3">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item, i) => (
              <TableRow key={`${item.memberId}-${i}`} className="border-t border-border">
                <TableCell className="p-3">
                  {item.memberName}
                  <div className="text-xs text-muted-foreground">{item.rank}</div>
                </TableCell>
                <TableCell className="p-3">
                  {item.credential ?? '—'}
                  <div className="text-xs text-muted-foreground">{item.specialty ?? '—'}</div>
                </TableCell>
                <TableCell className="p-3">
                  {item.classification}
                  {item.recentlyChanged ? (
                    <div className="text-xs text-info">Recently changed</div>
                  ) : null}
                </TableCell>
                <TableCell className="p-3">
                  {item.effectiveOn ?? '—'}
                  <div className="text-xs text-muted-foreground">
                    {item.expiresOn ?? 'No expiration'}
                  </div>
                </TableCell>
                <TableCell className="p-3">{item.sourceProvenance}</TableCell>
                <TableCell className="p-3 text-xs text-muted-foreground">
                  {item.affectedBidOpportunities}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
