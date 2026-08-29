import { requireAdmin } from '@/lib/require-admin';
import { LegacyMemberImportRetiredPanel } from './RetiredMemberImportPanel';

export default async function MembersImportPage() {
  await requireAdmin();
  return <LegacyMemberImportRetiredPanel />;
}
