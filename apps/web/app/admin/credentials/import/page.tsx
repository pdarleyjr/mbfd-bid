import { requireAdmin } from '@/lib/require-admin';
import { CredentialImportWorkspace } from './CredentialImportWorkspace';
export default async function Page() {
  await requireAdmin();
  return <CredentialImportWorkspace />;
}
