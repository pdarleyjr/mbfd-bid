'use client';

import { type ColumnDef, createColumnHelper } from '@tanstack/react-table';
import Link from 'next/link';
import { DataTable } from './DataTable';

interface MemberRow {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: string;
  bidCategory: string;
  rscSeniority: number;
  hiredAt: string | null;
  isProbationary: boolean;
}

const RANK_LABELS: Record<string, string> = {
  FF: 'Firefighter',
  LT: 'Lieutenant',
  CPT: 'Captain',
  DC: 'Division Chief',
  DEP_CHIEF: 'Deputy Chief',
  CHIEF: 'Fire Chief',
};

const helper = createColumnHelper<MemberRow>();

const columns: ColumnDef<MemberRow, string>[] = [
  helper.accessor('employeeId', {
    header: 'Emp ID',
    cell: (info) => (
      <Link
        href={`/admin/members/${info.row.original.id}`}
        className="font-mono text-xs text-red-400 [font-variant-numeric:tabular-nums] hover:text-red-300"
      >
        {info.getValue()}
      </Link>
    ),
  }) as ColumnDef<MemberRow, string>,
  helper.accessor('lastName', {
    header: 'Last Name',
    cell: (info) => (
      <Link
        href={`/admin/members/${info.row.original.id}`}
        className="font-medium text-white hover:text-red-300"
      >
        {info.getValue()}
      </Link>
    ),
  }) as ColumnDef<MemberRow, string>,
  helper.accessor('firstName', {
    header: 'First Name',
  }) as ColumnDef<MemberRow, string>,
  helper.accessor('rank', {
    header: 'Rank',
    cell: (info) => RANK_LABELS[info.getValue()] ?? info.getValue(),
  }) as ColumnDef<MemberRow, string>,
  helper.accessor('bidCategory', {
    header: 'Category',
    cell: (info) => {
      const val = info.getValue();
      return (
        <span
          className={[
            'inline-flex rounded px-2 py-0.5 text-xs font-medium',
            val === 'OFC'
              ? 'bg-slate-700 text-slate-200'
              : val === 'FF'
                ? 'bg-stone-700 text-stone-200'
                : 'bg-red-900/40 text-red-300',
          ].join(' ')}
        >
          {val}
        </span>
      );
    },
  }) as ColumnDef<MemberRow, string>,
  helper.accessor((row) => String(row.rscSeniority), {
    id: 'rsc_seniority',
    header: 'RSC Sen.',
    cell: (info) => (
      <span className="font-mono text-xs [font-variant-numeric:tabular-nums]">
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor((row) => row.hiredAt ?? '', {
    id: 'hired_at',
    header: 'Hired',
    cell: (info) => (
      <span className="font-mono text-xs text-slate-400 [font-variant-numeric:tabular-nums]">
        {info.getValue() || '—'}
      </span>
    ),
  }),
];

export function MembersTable({ members }: { members: MemberRow[] }) {
  return <DataTable columns={columns} data={members} caption="Department members list" />;
}
