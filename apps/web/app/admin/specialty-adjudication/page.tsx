import { requireAdmin } from '@/lib/require-admin';
import { getWorkerBase } from '@/lib/worker-base';

import { SpecialtyAdjudicationWorkspace } from './SpecialtyAdjudicationWorkspace';

export const dynamic = 'force-dynamic';

/**
 * This route is deliberately separate from the live Bid board. It is an
 * operator workspace for the Worker-owned synthetic specialty rehearsal only.
 */
export default async function SpecialtyAdjudicationPage() {
  await requireAdmin();
  return <SpecialtyAdjudicationWorkspace wsBase={getWorkerBase()} />;
}
