'use client';

import { Button } from '@/components/ui/button';
import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';
import { BidMarineReviewSchema, type BidMarineReview as Review, bidRequest } from './bid-client';

export function BidMarineReview({
  year,
  versionId,
  versionSha256,
}: {
  year: number;
  versionId: string | null;
  versionSha256: string | null;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [positionId, setPositionId] = useState('all');
  async function load() {
    setBusy(true);
    setError(null);
    try {
      const result = await bidRequest(year, 'marine-evidence-review', BidMarineReviewSchema);
      if (result.versionId !== versionId || result.versionSha256 !== versionSha256)
        throw new Error(
          'The saved Bid changed. Reload the current version before reviewing Marine evidence.',
        );
      setReview(result);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Marine evidence review could not be loaded.',
      );
    } finally {
      setBusy(false);
    }
  }
  const positions = [...new Set(review?.rows.map((row) => row.positionId) ?? [])].sort();
  const visible = (review?.rows ?? []).filter(
    (row) =>
      (positionId === 'all' || row.positionId === positionId) &&
      `${row.member} ${row.employeeId} ${row.positionId}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl">Marine qualification review</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Person-specific OUPV authority, a passing IADRS result, and DRI/PADI issuer proof are
            checked per seat. Generic certificate labels do not establish these facts.
          </p>
        </div>
        <Button type="button" onClick={() => void load()} disabled={busy || !versionId}>
          {busy ? 'Checking…' : 'Review saved Marine evidence'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {review && (
        <>
          <p className="text-sm">
            Version {versionId} · As of {review.asOf} · {review.marinePositionCount} Marine seats ·{' '}
            {review.candidateMemberCount} members with Marine-related records · {review.rows.length}{' '}
            member-seat evidence actions
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1 text-sm">
              Find member or seat
              <input
                className="min-h-11 rounded border border-border bg-background px-3"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Marine seat
              <select
                className="min-h-11 rounded border border-border bg-background px-3"
                value={positionId}
                onChange={(event) => setPositionId(event.target.value)}
              >
                <option value="all">All seats</option>
                {positions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="p-2">
                    Member
                  </th>
                  <th scope="col" className="p-2">
                    Marine position
                  </th>
                  <th scope="col" className="p-2">
                    Missing evidence
                  </th>
                  <th scope="col" className="p-2">
                    Source reviewed
                  </th>
                  <th scope="col" className="p-2">
                    Required action
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={`${row.employeeId}:${row.positionId}`}
                    className="border-b border-border align-top"
                  >
                    <td className="p-2 font-medium">
                      {row.member}
                      <span className="block text-xs text-muted-foreground">{row.employeeId}</span>
                    </td>
                    <td className="p-2">
                      {row.positionId}
                      <span className="block text-xs text-muted-foreground">
                        {row.marinePosition}
                      </span>
                    </td>
                    <td className="p-2">
                      <ul className="list-disc pl-4">
                        {row.missingEvidence.map((missing) => (
                          <li key={missing}>{missing}</li>
                        ))}
                      </ul>
                    </td>
                    <td className="p-2">{row.sourceReviewed}</td>
                    <td className="p-2">
                      {row.requiredAction}
                      <br />
                      <Link className="underline" href={'/admin/personnel/qualifications' as Route}>
                        Open qualifications
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && <p className="text-sm">No matching evidence actions.</p>}
        </>
      )}
    </section>
  );
}
