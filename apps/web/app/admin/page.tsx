import { requireAdmin } from '@/lib/require-admin';
import Link from 'next/link';

export const runtime = 'edge';

const QUICK_LINKS = [
  {
    href: '/admin/members' as const,
    title: 'Members',
    description: 'View and search all department members.',
  },
  {
    href: '/admin/credentials' as const,
    title: 'Credentials',
    description: 'Browse certification types and point values.',
  },
  {
    href: '/admin/positions' as const,
    title: 'Positions',
    description: 'View bid positions grouped by shift and station.',
  },
  {
    href: '/admin/rules' as const,
    title: 'Rules',
    description: 'Inspect rule book criteria, points, and tie-break chains.',
  },
  {
    href: '/admin/members/import' as const,
    title: 'Import Members',
    description: 'Upload a Telestaff CSV to seed or refresh member records.',
  },
  {
    href: '/admin/credentials/import' as const,
    title: 'Import Credentials',
    description: 'Upload a CSV to seed credential definitions.',
  },
] as const;

export default async function AdminDashboardPage() {
  const claims = await requireAdmin();

  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Admin Dashboard</h1>
      <p className="mt-1 text-sm text-slate-300">
        Welcome back, {claims.first_name} {claims.last_name}.
      </p>

      <dl className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map(({ href, title, description }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border border-slate-700 bg-slate-800 p-5 transition-colors duration-fast ease-out-quart hover:border-red-700"
          >
            <dt className="font-heading text-base font-semibold text-white group-hover:text-red-400">
              {title}
            </dt>
            <dd className="mt-1 text-sm text-slate-400">{description}</dd>
          </Link>
        ))}
      </dl>
    </div>
  );
}
