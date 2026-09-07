import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';

import {
  type PersonnelMember,
  type PersonnelSummary,
  PersonnelWorkspace,
} from './PersonnelWorkspace';

interface MembersResponse {
  members: PersonnelMember[];
}

function memberIdHint(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function assignmentIdHint(value: string | undefined): string | undefined {
  if (value === undefined || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return undefined;
  return value;
}

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string; assignmentId?: string }>;
}) {
  await requireAdmin();

  const query = await searchParams;
  const linkedMemberId = memberIdHint(query.memberId);
  const linkedAssignmentId = assignmentIdHint(query.assignmentId);

  let summary: PersonnelSummary | null = null;
  let members: PersonnelMember[] = [];
  let fetchError: string | null = null;
  try {
    const [summaryResponse, membersResponse] = await Promise.all([
      serverWorkerFetch('/api/admin/personnel/summary'),
      serverWorkerFetch('/api/admin/personnel/members?limit=500'),
    ]);
    if (!summaryResponse.ok || !membersResponse.ok) {
      fetchError = `Personnel service returned ${!summaryResponse.ok ? summaryResponse.status : membersResponse.status}.`;
    } else {
      summary = (await summaryResponse.json()) as PersonnelSummary;
      members = ((await membersResponse.json()) as MembersResponse).members;
    }
  } catch (caught) {
    fetchError =
      caught instanceof Error ? caught.message : 'Personnel service could not be reached.';
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6" aria-labelledby="personnel-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
          Year-round staffing control
        </p>
        <h1 id="personnel-heading" className="mt-1 font-heading text-3xl text-foreground">
          Personnel
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Review the Bid-side member projection, record effective-dated changes, and retain the
          receipt and assignment history needed for later roster and Bid decisions.
        </p>
      </header>

      {fetchError !== null || summary === null ? (
        <div className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning">
          <h2 className="font-semibold">Personnel data is not available</h2>
          <p className="mt-1">{fetchError ?? 'The personnel service returned no summary.'}</p>
          <p className="mt-2 text-warning">No local fallback or inferred roster is shown.</p>
        </div>
      ) : (
        <PersonnelWorkspace
          summary={summary}
          members={members}
          {...(linkedMemberId === undefined ? {} : { memberIdHint: linkedMemberId })}
          {...(linkedAssignmentId === undefined ? {} : { assignmentIdHint: linkedAssignmentId })}
        />
      )}
    </section>
  );
}
