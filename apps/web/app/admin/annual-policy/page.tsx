import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';
import { type AnnualPolicyDocument, AnnualPolicyWorkspace } from './AnnualPolicyWorkspace';

export const dynamic = 'force-dynamic';

function yearFrom(value: string | undefined): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2024 && year <= 2100 ? year : new Date().getFullYear();
}

export default async function AnnualPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAdmin();
  const year = yearFrom((await searchParams).year);
  let documents: AnnualPolicyDocument[] = [];
  let loadError: string | null = null;
  try {
    const response = await serverWorkerFetch(`/api/admin/annual-policy-documents/${year}`);
    if (!response.ok) loadError = `Policy service returned ${response.status}.`;
    else
      documents =
        ((await response.json()) as { documents?: AnnualPolicyDocument[] }).documents ?? [];
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Policy service could not be reached.';
  }
  return <AnnualPolicyWorkspace year={year} documents={documents} loadError={loadError} />;
}
