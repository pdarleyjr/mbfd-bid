import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';

import {
  type QualificationCredential,
  QualificationLifecycleWorkspace,
  type QualificationMember,
} from './QualificationLifecycleWorkspace';

interface PersonnelMembersResponse {
  members: QualificationMember[];
}

interface CredentialsResponse {
  credentials: QualificationCredential[];
}

function memberIdHint(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function QualificationLifecyclePage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string }>;
}) {
  await requireAdmin();

  const query = await searchParams;
  const selectedMemberId = memberIdHint(query.memberId);
  let members: QualificationMember[] = [];
  let credentials: QualificationCredential[] = [];
  let fetchError: string | null = null;

  try {
    const [membersResponse, credentialsResponse] = await Promise.all([
      serverWorkerFetch('/api/admin/personnel/members?limit=500'),
      serverWorkerFetch('/api/admin/credentials?limit=500&offset=0'),
    ]);
    if (!membersResponse.ok || !credentialsResponse.ok) {
      fetchError = `Qualification form inputs returned ${!membersResponse.ok ? membersResponse.status : credentialsResponse.status}.`;
    } else {
      members = ((await membersResponse.json()) as PersonnelMembersResponse).members;
      credentials = ((await credentialsResponse.json()) as CredentialsResponse).credentials;
    }
  } catch (caught) {
    fetchError =
      caught instanceof Error ? caught.message : 'Qualification form inputs could not be loaded.';
  }

  return (
    <section className="mx-auto max-w-7xl space-y-6" aria-labelledby="qualification-page-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
          Personnel evidence control
        </p>
        <h1 id="qualification-page-heading" className="mt-1 font-heading text-3xl text-foreground">
          Credential and specialty qualifications
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Choose a member, review their qualifications, then add, renew or correct a dated record.
          Earlier records and approved bid results remain preserved.
        </p>
      </header>

      {fetchError !== null ? (
        <section className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning">
          <h2 className="font-semibold">Qualification workflow inputs are unavailable</h2>
          <p className="mt-1">{fetchError}</p>
          <p className="mt-2 text-warning">No local roster or credential fallback is shown.</p>
        </section>
      ) : (
        <QualificationLifecycleWorkspace
          asOf={new Date().toISOString().slice(0, 10)}
          members={members}
          credentials={credentials}
          {...(selectedMemberId === undefined ? {} : { memberIdHint: selectedMemberId })}
        />
      )}
    </section>
  );
}
