'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { TargetSolutionsWorkspace } from '../../targetsolutions/TargetSolutionsWorkspace';
import { TeleStaffOperatorWorkspace } from '../../telestaff/TeleStaffOperatorWorkspace';

export function DepartmentImportWorkspace() {
  const params = useSearchParams();
  const source = params.get('source') === 'targetsolutions' ? 'targetsolutions' : 'telestaff';
  return (
    <div className="min-w-0 space-y-5">
      <nav aria-label="Import source" className="flex flex-wrap gap-2">
        {(['telestaff', 'targetsolutions'] as const).map((value) => (
          <Link
            key={value}
            href={
              `/admin/department/import?${new URLSearchParams({ ...Object.fromEntries(params), source: value })}` as Route
            }
            aria-current={source === value ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold ${source === value ? 'border-info/40 bg-info-surface text-info' : 'border-border hover:bg-muted'}`}
          >
            {value === 'telestaff' ? 'Import TeleStaff' : 'Import TargetSolutions'}
          </Link>
        ))}
      </nav>
      {source === 'targetsolutions' ? (
        <TargetSolutionsWorkspace basePath="/admin/department/import?source=targetsolutions" />
      ) : (
        <section className="min-w-0 space-y-4">
          <header>
            <h2 className="font-heading text-xl font-semibold">Update staffing from TeleStaff</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a staffing export, review matched changes and exceptions, then apply the
              reviewed assignments.
            </p>
          </header>
          <TeleStaffOperatorWorkspace />
        </section>
      )}
    </div>
  );
}
