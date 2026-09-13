import { requireAdmin } from '@/lib/require-admin';
import type { ReactNode } from 'react';
import { DepartmentNavigation } from './DepartmentNavigation';

export default async function DepartmentLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <section className="mx-auto min-w-0 max-w-[120rem] space-y-5">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Department</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage people, staffing, organization and qualifications throughout the year.
        </p>
      </header>
      <DepartmentNavigation />
      {children}
    </section>
  );
}
