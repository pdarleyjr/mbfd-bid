import { requireAdmin } from '@/lib/require-admin';
import { BidEvidenceWorkspace } from './BidEvidenceWorkspace';
export const dynamic = 'force-dynamic';
export default async function BidEvidencePage({
  searchParams,
}: { searchParams: Promise<{ memberId?: string }> }) {
  await requireAdmin();
  const { memberId } = await searchParams;
  return (
    <BidEvidenceWorkspace
      key={memberId ?? 'choose'}
      initialMemberId={memberId && /^[1-9]\d*$/.test(memberId) ? memberId : ''}
    />
  );
}
