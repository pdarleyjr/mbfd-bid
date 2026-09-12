import { requireAdmin } from '@/lib/require-admin';
import { TodayWorkspace } from './today/TodayWorkspace';

export default async function AdminDashboardPage() {
  await requireAdmin();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return <TodayWorkspace initialDate={`${date.year}-${date.month}-${date.day}`} />;
}
