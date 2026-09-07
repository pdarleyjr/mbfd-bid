import { requireAdmin } from '@/lib/require-admin';
import { Suspense } from 'react';
import { BidBoardWorkspace } from './BidBoardWorkspace';

export default async function BidBoardPage() {
  await requireAdmin();
  return (
    <Suspense fallback={<p>Loading Bid Board…</p>}>
      <BidBoardWorkspace />
    </Suspense>
  );
}
