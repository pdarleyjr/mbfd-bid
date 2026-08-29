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
      serverWorkerFetch('/api/admin/personnel/members?limit=250'),
      serverWorkerFetch('/api/admin/credentials?limit=200&offset=0'),
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
        <p className="text-xs font-semibold uppercase tracking-wider text-red-300">
          Personnel evidence control
        </p>
        <h1 id="qualification-page-heading" className="mt-1 font-heading text-3xl text-white">
          Credential and specialty qualifications
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Review the mounted effective-dated credential and specialty projection, then record
          evidence events with an immutable audit history. This page does not restore the retired
          direct credential-toggle path.
        </p>
      </header>

      {fetchError !== null ? (
        <section className="rounded-xl border border-amber-700 bg-amber-950/30 p-5 text-sm text-amber-100">
          <h2 className="font-semibold">Qualification workflow inputs are unavailable</h2>
          <p className="mt-1">{fetchError}</p>
          <p className="mt-2 text-amber-100/90">No local roster or credential fallback is shown.</p>
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
