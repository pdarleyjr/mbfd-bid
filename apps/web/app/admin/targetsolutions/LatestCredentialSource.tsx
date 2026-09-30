'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { annualGet } from '../annual-plan/annual-plan-client';

export function LatestCredentialSource() {
  const source = useQuery({
    queryKey: ['targetsolutions', 'latest-approved-source'],
    queryFn: () =>
      annualGet<{
        latestApprovedSource: {
          source_filename: string;
          selected_sheet: string;
          source_revision: number;
          row_count: number;
          unique_employee_count: number;
          approved_at: number;
          pending_count: number;
        } | null;
      }>('targetsolutions/imports'),
  });
  const receipt = source.data?.latestApprovedSource;
  return (
    <div className="space-y-2 rounded border border-border p-3 text-sm">
      <p className="font-semibold">LATEST APPROVED CREDENTIAL SOURCE</p>
      {receipt ? (
        <>
          <p>
            {receipt.source_filename} · Version {receipt.source_revision} · {receipt.selected_sheet}
          </p>
          <p>
            Approved{' '}
            {new Date(receipt.approved_at).toLocaleString('en-US', {
              timeZone: 'America/New_York',
            })}{' '}
            Eastern · {receipt.row_count.toLocaleString()} rows · {receipt.unique_employee_count}{' '}
            employees
            {receipt.pending_count > 0
              ? ` · ${receipt.pending_count} records still require review/application`
              : ''}
          </p>
        </>
      ) : (
        <p>
          {source.isError
            ? 'Source status could not be loaded. Open credentials to retry.'
            : source.isPending
              ? 'Loading approved source…'
              : 'No numbered workbook revision has been approved yet.'}
        </p>
      )}
      <Link
        className="inline-flex min-h-11 items-center font-semibold underline"
        href="/admin/personnel/qualifications"
      >
        ADD / CORRECT ONE MEMBER’S CREDENTIAL MANUALLY
      </Link>
    </div>
  );
}
