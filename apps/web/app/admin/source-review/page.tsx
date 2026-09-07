import { requireAdmin } from '@/lib/require-admin';
import { Suspense } from 'react';
import { SourceReviewWorkspace } from './SourceReviewWorkspace';
export default async function Page() {
  await requireAdmin();
  return (
    <Suspense fallback={<p>Loading source review…</p>}>
      <SourceReviewWorkspace />
    </Suspense>
  );
}
