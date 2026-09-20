import { requireAdmin } from '@/lib/require-admin';
import Link from 'next/link';
import { ServiceEvidenceWorkspace } from './ServiceEvidenceWorkspace';
export const dynamic = 'force-dynamic';
export default async function ServiceEvidencePage({
  searchParams,
}: { searchParams: Promise<{ memberId?: string | string[] }> }) {
  await requireAdmin();
  const { memberId } = await searchParams;
  if (
    memberId !== undefined &&
    (typeof memberId !== 'string' ||
      !/^[1-9]\d*$/.test(memberId) ||
      !Number.isSafeInteger(Number(memberId)))
  ) {
    return (
      <section className="mx-auto max-w-5xl space-y-4">
        <h1 className="font-heading text-3xl">Service Evidence</h1>
        <p role="alert">
          This member link is invalid. Choose an existing member to review service evidence.
        </p>
        <Link
          href="/admin/personnel/service-evidence"
          className="inline-flex min-h-11 items-center underline"
        >
          Choose a member
        </Link>
      </section>
    );
  }
  return (
    <ServiceEvidenceWorkspace
      key={memberId ?? 'choose'}
      {...(memberId === undefined ? {} : { initialMemberId: Number(memberId) })}
    />
  );
}
