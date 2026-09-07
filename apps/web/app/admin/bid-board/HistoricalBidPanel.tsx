'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type HistoricalBid, HistoricalBidReceiptSchema, HistoricalBidSchema } from '@mbfd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function HistoricalSeats({
  archive,
  shift,
  search,
}: { archive: HistoricalBid; shift: string; search: string }) {
  const seats = archive.seats.filter((seat) => seat.shift === shift);
  const visible = seats.filter((seat) =>
    [seat.id, seat.station, seat.unit, seat.position, seat.name]
      .join(' ')
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 border-y border-border py-3 text-sm">
        <strong>
          {archive.year} Previous Bid · {shift === 'D' ? 'D / Days' : `${shift} Shift`}
        </strong>
        <span>{seats.filter((seat) => seat.status === 'AWARDED').length} documented awards</span>
        <span>
          {seats.filter((seat) => seat.status === 'WITHDRAWN').length} withdrawn positions
        </span>
      </div>
      {archive.notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}
      <div className="grid items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {[...new Set(visible.map((seat) => seat.station))].map((station) => (
          <Card key={station} className="min-w-0 overflow-hidden">
            <h2 className="border-b border-border bg-station-header px-3 py-3 font-heading font-bold">
              {station}
            </h2>
            <Table className="table-fixed text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Historical position</TableHead>
                  <TableHead>Recorded award</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible
                  .filter((seat) => seat.station === station)
                  .map((seat) => (
                    <TableRow key={seat.id}>
                      <TableCell className="w-1/2 break-words align-top">
                        <strong>
                          {seat.id} · {seat.position ?? 'Role not printed in source'}
                        </strong>
                        <p className="mt-1 text-muted-foreground">{seat.unit}</p>
                      </TableCell>
                      <TableCell className="break-words align-top">
                        <p>
                          {seat.status === 'WITHDRAWN'
                            ? 'Withdrawn in source · no award'
                            : (seat.name ?? 'Historical occupant not established')}
                        </p>
                        {seat.group && <Badge className="mt-1">{seat.group}</Badge>}
                        {seat.status === 'OFFICIAL_POSITION_SUPPLEMENT' && (
                          <p className="mt-1 text-warning">
                            Official position supplement · not a 2025 award
                          </p>
                        )}
                        {seat.note && <p className="mt-1 text-muted-foreground">{seat.note}</p>}
                        <details className="mt-2">
                          <summary className="cursor-pointer">Source</summary>
                          <p>
                            {archive.sources.find((source) => source.id === seat.sourceId)?.name}
                          </p>
                          <p>{seat.sourceLocation}</p>
                        </details>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Card>
        ))}
        {visible.length === 0 && <p>No historical positions match this selection.</p>}
      </div>
    </div>
  );
}

export function HistoricalBidPanel({
  year,
  shift,
  search,
}: { year: number; shift: string; search: string }) {
  const archive = useQuery({
    queryKey: ['admin', 'historical-bids', year],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const response = await fetch(`/api/admin/historical-bids/${year}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Could not load the historical bid archive');
      return HistoricalBidReceiptSchema.parse(await response.json());
    },
  });
  const days = useQuery({
    queryKey: ['admin', 'historical-bids', year, 'current-days-supplement'],
    enabled: shift === 'D',
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/admin/historical-bids/${year}/days-supplement`, {
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error('Current Days supplement unavailable; historical awards remain unchanged.');
      return (await response.json()) as {
        asOf: string;
        excludedPositions: number;
        positions: {
          id: string;
          station: string | null;
          unit: string | null;
          position: string | null;
          name: string | null;
          occupancy: string;
        }[];
      };
    },
  });
  return (
    <>
      {archive.isPending && <output>Loading historical bid…</output>}
      {archive.isError && <Alert>{archive.error.message}</Alert>}
      {archive.data && (
        <>
          <HistoricalSeats archive={archive.data.archive} shift={shift} search={search} />
          <details className="border-t border-border pt-4 text-sm">
            <summary className="min-h-11 cursor-pointer">Historical archive provenance</summary>
            <p>{archive.data.archive.label}</p>
            <p>Published {new Date(archive.data.publishedAt).toLocaleString()}</p>
            <p className="break-all">Archive SHA-256: {archive.data.sha256}</p>
            {archive.data.archive.sources.map((source) => (
              <p key={source.id} className="mt-2 break-all">
                {source.name} · SHA-256 {source.sha256}
              </p>
            ))}
          </details>
        </>
      )}
      {shift === 'D' && (
        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="font-heading text-xl">Current official Days positions · supplement</h2>
          <p className="text-sm text-muted-foreground">
            These are today's official positions and occupants, not 2025 awards. Temporary
            assignments and personnel documented on the historical A/B/C results are excluded by
            employee identifier.
          </p>
          {days.isPending && <output>Loading current Days positions…</output>}
          {days.isError && <Alert>{days.error.message}</Alert>}
          {days.data && (
            <>
              <p className="text-sm">
                Staffing as of {days.data.asOf} · {days.data.positions.length} official positions ·{' '}
                {days.data.excludedPositions} temporary, historical A/B/C, or unverified entries
                excluded
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Official position today</TableHead>
                    <TableHead>Current occupant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.data.positions
                    .filter((position) =>
                      [position.station, position.unit, position.position, position.name]
                        .join(' ')
                        .toLowerCase()
                        .includes(search.trim().toLowerCase()),
                    )
                    .map((position) => (
                      <TableRow key={position.id}>
                        <TableCell>
                          {position.station} · {position.unit}
                          <p className="font-semibold">
                            {position.position ?? 'Position label unavailable'}
                          </p>
                        </TableCell>
                        <TableCell>
                          {position.name ??
                            (position.occupancy === 'vacant'
                              ? 'Vacant today'
                              : 'Current occupant unavailable')}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </>
          )}
        </section>
      )}
    </>
  );
}

export function HistoricalBidImport() {
  const client = useQueryClient();
  const [draft, setDraft] = useState<HistoricalBid | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewShift, setPreviewShift] = useState('A');
  return (
    <details className="rounded-lg border border-border bg-card p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">
        Import historical bid results
      </summary>
      <p className="mb-4 text-sm text-muted-foreground">
        Review a documentary archive before publishing. Published historical years cannot be
        replaced here. Current rosters, annual preparation and live sessions are maintained
        separately.
      </p>
      <Label>
        Historical archive JSON
        <Input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (event) => {
            setDraft(null);
            setError('');
            setResult('');
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 1_048_576) {
              setError('Archive must be at most 1 MB.');
              return;
            }
            try {
              setDraft(HistoricalBidSchema.parse(JSON.parse(await file.text())));
            } catch {
              setError(
                'The file is not a valid historical bid archive. Review the source format and required fields.',
              );
            }
          }}
        />
      </Label>
      {error && <Alert className="mt-3">{error}</Alert>}
      {result && <output className="mt-3 block">{result}</output>}
      {draft && (
        <div className="mt-4 space-y-4">
          <h2 className="font-heading text-lg">Review {draft.label}</h2>
          <p>
            {draft.seats.length} source positions · {draft.sources.length} source documents
          </p>
          <div className="flex flex-wrap gap-2">
            {['A', 'B', 'C', 'D'].map((shift) => (
              <Button
                type="button"
                key={shift}
                variant="secondary"
                aria-pressed={previewShift === shift}
                onClick={() => setPreviewShift(shift)}
              >
                Review {shift}
              </Button>
            ))}
          </div>
          <HistoricalSeats archive={draft} shift={previewShift} search="" />
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const response = await fetch('/api/admin/historical-bids', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(draft),
                });
                const body = (await response.json()) as { error?: string; sha256?: string };
                if (!response.ok)
                  throw new Error(
                    (body.error ?? 'Historical archive publication failed').replaceAll('_', ' '),
                  );
                setResult(`${draft.year} historical bid published. SHA-256 ${body.sha256}`);
                setDraft(null);
                await client.invalidateQueries({ queryKey: ['admin', 'historical-bids'] });
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Publication failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Publishing…' : `Publish reviewed ${draft.year} historical bid`}
          </Button>
        </div>
      )}
    </details>
  );
}
