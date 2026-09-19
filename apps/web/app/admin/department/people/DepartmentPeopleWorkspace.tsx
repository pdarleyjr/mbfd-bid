'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type {
  DepartmentPeopleListResponse,
  DepartmentPerson,
  DepartmentPersonDetailResponse,
} from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AddMemberPanel } from './AddMemberPanel';
import { MemberDetails } from './MemberDetails';
import { UpdateMemberPanel } from './UpdateMemberPanel';
import { readDepartment } from './people-api';

const PAGE_SIZE = 25;
const statuses = ['all', 'active', 'unknown', 'inactive', 'retired', 'separated'] as const;
function label(value: string) {
  return value === 'unknown'
    ? 'Needs classification'
    : value.charAt(0).toUpperCase() + value.slice(1);
}
function positive(value: string | null) {
  return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : null;
}

export function DepartmentPeopleWorkspace({ initialDate }: { initialDate: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const committedSearch = search.toString();
  const intendedSearch = useRef(committedSearch);
  const pendingSearches = useRef<string[]>([]);
  useEffect(() => {
    const committedIndex = pendingSearches.current.indexOf(committedSearch);
    if (committedIndex >= 0) {
      pendingSearches.current.splice(0, committedIndex + 1);
      if (pendingSearches.current.length) return;
    } else {
      // Back/forward and other external navigation become the new source.
      pendingSearches.current = [];
    }
    intendedSearch.current = committedSearch;
  }, [committedSearch]);
  const asOf = search.get('as_of') ?? initialDate;
  const query = search.get('q') ?? '';
  const requestedStatus = search.get('employment_status') ?? 'all';
  const status = statuses.includes(requestedStatus as (typeof statuses)[number])
    ? requestedStatus
    : 'all';
  const page = positive(search.get('page')) ?? 1;
  const selectedId = positive(search.get('memberId'));
  const [editing, setEditing] = useState<{ person: DepartmentPerson; asOf: string } | null>(null);
  const [addingAsOf, setAddingAsOf] = useState<string | null>(null);
  function navigate(changes: Record<string, string | null>) {
    // A row click may precede the router committing a submitted filter change.
    // Compose against the latest requested URL so that click preserves filters.
    const next = new URLSearchParams(intendedSearch.current);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    intendedSearch.current = next.toString();
    pendingSearches.current.push(intendedSearch.current);
    router.push(`/admin/department${next.size ? `?${next}` : ''}` as Route, { scroll: false });
  }
  const people = useQuery({
    queryKey: ['admin', 'department', 'people', asOf, query, status, page],
    queryFn: ({ signal }) =>
      readDepartment<DepartmentPeopleListResponse>(
        `/api/admin/department/people?${new URLSearchParams({ as_of: asOf, q: query, page: String(page), page_size: String(PAGE_SIZE), ...(status === 'all' ? {} : { employment_status: status }) })}`,
        signal,
      ),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const detail = useQuery({
    queryKey: ['admin', 'department', 'person', selectedId, asOf],
    queryFn: ({ signal }) =>
      readDepartment<DepartmentPersonDetailResponse>(
        `/api/admin/department/people/${selectedId}?${new URLSearchParams({ as_of: asOf })}`,
        signal,
      ),
    enabled: selectedId !== null,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  return (
    <div data-testid="department-people" className="min-w-0 space-y-4">
      <form
        key={`${query}:${asOf}:${status}`}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          navigate({
            q: String(form.get('q') ?? '').trim(),
            as_of: String(form.get('as_of')),
            employment_status:
              String(form.get('employment_status')) === 'all'
                ? null
                : String(form.get('employment_status')),
            page: null,
          });
        }}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        <Label className="grid min-w-0 flex-1 basis-52 gap-1 text-xs">
          Search people
          <Input
            name="q"
            type="search"
            defaultValue={query}
            maxLength={128}
            placeholder="Name or employee ID"
            className="min-h-11"
          />
        </Label>
        <Label className="grid gap-1 text-xs">
          As of date
          <Input name="as_of" type="date" defaultValue={asOf} required className="min-h-11 w-40" />
        </Label>
        <Label className="grid gap-1 text-xs">
          Employment status
          <NativeSelect name="employment_status" defaultValue={status} className="min-h-11 w-44">
            {statuses.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'All statuses' : label(value)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Button type="submit">Search</Button>
        <Button type="button" variant="secondary" onClick={() => setAddingAsOf(asOf)}>
          Add member
        </Button>
      </form>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <section
          aria-label="Department people"
          className="min-w-0 rounded-xl border border-border bg-card"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="font-heading text-lg font-semibold">People</h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {people.data
                ? `${people.data.pagination.total} matching members`
                : people.isError
                  ? 'Member list unavailable'
                  : 'Loading members…'}
            </p>
          </header>
          {people.isError && (
            <div role="alert" className="m-4 space-y-2 text-sm text-warning">
              <p>
                {people.data ? 'Refresh failed. The last loaded list is shown. ' : ''}
                {people.error.message}
              </p>
              <Button
                variant="secondary"
                disabled={people.isFetching}
                onClick={() => void people.refetch()}
              >
                Retry member list
              </Button>
            </div>
          )}
          {people.isPending ? (
            <output className="block p-4 text-sm">Loading Department people…</output>
          ) : (
            people.data && (
              <>
                <ul className="divide-y divide-border">
                  {people.data.people.map((person) => (
                    <li
                      key={person.id}
                      data-member-id={person.id}
                      className={selectedId === person.id ? 'bg-info-surface' : undefined}
                    >
                      <button
                        type="button"
                        aria-current={selectedId === person.id ? 'true' : undefined}
                        aria-label={`View member ${person.firstName} ${person.lastName}, employee ${person.employeeId}`}
                        onClick={() => navigate({ memberId: String(person.id) })}
                        className="block min-h-11 w-full px-4 py-3 text-left hover:bg-muted"
                      >
                        <div className="flex flex-wrap justify-between gap-1">
                          <span className="break-words font-semibold">
                            {person.firstName} {person.lastName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {person.rank ?? 'Civilian'}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {person.employeeId} · {label(person.employmentStatus)}
                        </p>
                        <p className="mt-1 break-words text-xs">
                          {person.assignments.length
                            ? person.assignments
                                .map((position) =>
                                  [
                                    position.shift ? `${position.shift} shift` : null,
                                    position.station ?? position.division,
                                    position.unit,
                                  ]
                                    .filter(Boolean)
                                    .join(' · '),
                                )
                                .join('; ')
                            : 'No reviewed assignment'}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
                {people.data.people.length === 0 && (
                  <p className="p-5 text-sm">
                    {people.data.pagination.total
                      ? 'This page is outside the current results. Return to the first page.'
                      : 'No people match these filters.'}
                  </p>
                )}
                <nav
                  aria-label="People pages"
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3 text-sm"
                >
                  <span className="tabular-nums">
                    Page {page} of {Math.max(1, people.data.pagination.totalPages)}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      aria-label="Previous people page"
                      disabled={page <= 1}
                      onClick={() => navigate({ page: String(Math.max(1, page - 1)) })}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      aria-label="Next people page"
                      disabled={!people.data.pagination.hasNextPage}
                      onClick={() => navigate({ page: String(page + 1) })}
                    >
                      Next
                    </Button>
                  </div>
                  {page > people.data.pagination.totalPages && page > 1 && (
                    <Button variant="secondary" onClick={() => navigate({ page: null })}>
                      First page
                    </Button>
                  )}
                </nav>
              </>
            )
          )}
        </section>
        <div className="min-w-0">
          {selectedId === null ? (
            <div className="rounded-xl border border-dashed border-border p-8">
              <h2 className="font-heading text-lg font-semibold">Select a member</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Review assignments, service dates, qualifications and history, then use Update
                member to record a change.
              </p>
            </div>
          ) : detail.isPending ? (
            <output className="block p-5 text-sm">Loading member details…</output>
          ) : detail.isError ? (
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm"
            >
              <p>{detail.error.message}</p>
              <Button
                variant="secondary"
                disabled={detail.isFetching}
                onClick={() => void detail.refetch()}
              >
                Retry member details
              </Button>
            </div>
          ) : detail.data ? (
            <MemberDetails
              key={detail.data.person.id}
              data={detail.data}
              onUpdate={() => setEditing({ person: detail.data.person, asOf: detail.data.asOf })}
            />
          ) : null}
        </div>
      </div>
      {editing && (
        <UpdateMemberPanel
          key={`${editing.person.id}:${editing.asOf}`}
          person={editing.person}
          asOf={editing.asOf}
          onClose={() => setEditing(null)}
        />
      )}
      {addingAsOf && <AddMemberPanel asOf={addingAsOf} onClose={() => setAddingAsOf(null)} />}
    </div>
  );
}
