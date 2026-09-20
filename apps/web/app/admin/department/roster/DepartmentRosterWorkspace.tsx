'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DepartmentRosterProjection } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { OrganizationWorkspace } from '../../organization/OrganizationWorkspace';
import { StaffingStructureWorkspace } from '../../staffing-structure/StaffingStructureWorkspace';

export function DepartmentRosterWorkspace({ initialDate }: { initialDate: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const asOf = search.get('as_of') ?? initialDate;
  const view = search.get('view') === 'organization' ? 'organization' : 'positions';
  const [mutationLocked, setMutationLocked] = useState(false);
  const panelId = useId();
  function navigate(changes: Record<string, string | null>) {
    if (mutationLocked) return;
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    router.push(`/admin/department/roster${next.size ? `?${next}` : ''}` as Route, {
      scroll: false,
    });
  }
  const roster = useQuery({
    queryKey: ['admin', 'department', 'current-roster', asOf],
    enabled: view === 'positions',
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/admin/department/current-roster?${new URLSearchParams({ as_of: asOf })}`,
        {
          credentials: 'include',
          cache: 'no-store',
          signal,
        },
      );
      const body = (await response.json()) as DepartmentRosterProjection & { error?: string };
      if (!response.ok)
        throw new Error(
          (body.error ?? `Staffing service returned ${response.status}`).replaceAll('_', ' '),
        );
      if (
        body.asOf !== asOf ||
        !Array.isArray(body.positions) ||
        !body.summary ||
        !Array.isArray(body.unassignedMembers)
      ) {
        throw new Error('The staffing service returned an incomplete roster for this date.');
      }
      return body;
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  return (
    <section className="min-w-0 space-y-4" aria-label="Department roster">
      <Tabs
        value={view}
        onValueChange={(value) =>
          navigate({ view: value === 'organization' ? 'organization' : null })
        }
      >
        <TabsList aria-label="Department roster views" className="w-fit flex-wrap">
          <TabsTrigger
            id={`${panelId}-positions-tab`}
            aria-controls={`${panelId}-positions`}
            value="positions"
            disabled={mutationLocked}
          >
            Assignments &amp; positions
          </TabsTrigger>
          <TabsTrigger
            id={`${panelId}-organization-tab`}
            aria-controls={`${panelId}-organization`}
            value="organization"
            disabled={mutationLocked}
          >
            Organization
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {view === 'organization' ? (
        <section
          role="tabpanel"
          id={`${panelId}-organization`}
          aria-labelledby={`${panelId}-organization-tab`}
        >
          <OrganizationWorkspace
            key={asOf}
            initialDate={asOf}
            onMutationLocked={setMutationLocked}
          />
        </section>
      ) : (
        <section
          role="tabpanel"
          id={`${panelId}-positions`}
          aria-labelledby={`${panelId}-positions-tab`}
          className="space-y-4"
        >
          <form
            key={asOf}
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ as_of: String(new FormData(event.currentTarget).get('as_of')) });
            }}
          >
            <Label className="grid gap-1 text-sm">
              Staffing as of
              <Input
                required
                type="date"
                name="as_of"
                defaultValue={asOf}
                disabled={mutationLocked}
              />
            </Label>
            <Button type="submit" disabled={mutationLocked}>
              View staffing
            </Button>
            <Button
              type="button"
              disabled={roster.isFetching}
              onClick={() => void roster.refetch()}
            >
              Refresh staffing
            </Button>
          </form>
          {roster.isError && (
            <p role="alert" className="rounded border border-warning/40 p-3 text-sm text-warning">
              {roster.data
                ? 'Refresh failed. The last successful staffing view remains visible. '
                : 'Staffing could not be loaded. '}
              {roster.error.message}
            </p>
          )}
          {roster.isPending ? (
            <output className="block p-4 text-sm">Loading Department staffing…</output>
          ) : (
            roster.data && (
              <>
                <StaffingStructureWorkspace
                  key={asOf}
                  roster={roster.data}
                  showProjectionDateControl={false}
                  onMutationLocked={setMutationLocked}
                />
                <section className="rounded-xl border border-border bg-card p-5">
                  <h2 className="font-heading text-xl">
                    Unassigned department members ({roster.data.unassignedMembers.length})
                  </h2>
                  {roster.data.unassignedMembers.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No unassigned members on this date.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {roster.data.unassignedMembers.map((member) => (
                        <li key={member.id} className="text-sm">
                          <Link
                            href={
                              `/admin/department?memberId=${member.id}&as_of=${roster.data.asOf}` as Route
                            }
                            className="font-medium text-info underline"
                          >
                            {member.firstName} {member.lastName}
                          </Link>{' '}
                          · {member.rank}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )
          )}
        </section>
      )}
    </section>
  );
}
