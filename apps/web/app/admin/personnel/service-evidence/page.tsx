import { requireAdmin } from '@/lib/require-admin';
import { ServiceEvidenceWorkspace } from './ServiceEvidenceWorkspace';
export const dynamic = 'force-dynamic';
export default async function ServiceEvidencePage() {
  await requireAdmin();
  return <ServiceEvidenceWorkspace />;
}
