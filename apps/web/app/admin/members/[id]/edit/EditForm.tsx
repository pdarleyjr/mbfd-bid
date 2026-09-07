'use client';

import type { Route } from 'next';
import Link from 'next/link';

interface Member {
  id: number;
}

/**
 * Personnel facts drive eligibility and roster history. They must go through
 * the effective-dated workflow, rather than a legacy direct PATCH to members.
 */
export function EditForm({ member }: { member: Member }) {
  return (
    <section className="mt-6 max-w-2xl rounded-xl border border-warning/40 bg-warning-surface p-5">
      <h2 className="font-heading text-lg text-warning">Use the personnel lifecycle workflow</h2>
      <p className="mt-2 text-sm leading-6 text-warning">
        Rank, bid category, seniority, probation, employment status, and assignments are
        effective-dated operational facts. Record the change with its effective date and reason so
        roster history and Bid eligibility remain auditable.
      </p>
      <Link
        href={`/admin/personnel?memberId=${member.id}` as Route}
        className="mt-4 inline-flex min-h-11 items-center rounded bg-destructive px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-destructive"
      >
        Open Personnel workspace
      </Link>
    </section>
  );
}
