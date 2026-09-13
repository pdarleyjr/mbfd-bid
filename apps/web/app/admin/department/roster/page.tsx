import { requireAdmin } from '@/lib/require-admin';
import { DepartmentRosterWorkspace } from './DepartmentRosterWorkspace';

export const dynamic = 'force-dynamic';

export default async function DepartmentRosterPage() {
  await requireAdmin();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return <DepartmentRosterWorkspace initialDate={`${date.year}-${date.month}-${date.day}`} />;
}
