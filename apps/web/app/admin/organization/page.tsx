import { requireAdmin } from '@/lib/require-admin';
import { OrganizationWorkspace } from './OrganizationWorkspace';
export const dynamic = 'force-dynamic';
export default async function OrganizationPage() {
  await requireAdmin();
  return <OrganizationWorkspace />;
}
