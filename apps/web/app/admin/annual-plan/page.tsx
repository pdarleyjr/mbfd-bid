import { requireAdmin } from '@/lib/require-admin';
import { AnnualPlanWorkspace } from './AnnualPlanWorkspace';
export const dynamic = 'force-dynamic';
export default async function AnnualPlanPage() {
  await requireAdmin();
  return <AnnualPlanWorkspace />;
}
