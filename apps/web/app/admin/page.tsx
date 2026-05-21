import { requireAdmin } from '@/lib/require-admin';
import type { Route } from 'next';
import Link from 'next/link';

export const runtime = 'edge';

type LinkEntry = { href: string; title: string; description: string; emphasis?: boolean };

// Primary actions surfaced as larger cards at the top.
const PRIMARY_ACTIONS: LinkEntry[] = [
  {
    href: '/admin/rehearsal',
    title: 'Mock Draft / Rehearsal',
    description:
      'Spin up a mock session, proxy-bid for members, run auto-bid, log findings. Use this before going live.',
    emphasis: true,
  },
  {
    href: '/admin/sessions/new',
    title: 'New Bid Session',
    description: 'Configure and start a new live bid session.',
    emphasis: true,
  },
  {
    href: '/admin/bid',
    title: 'Live Bid Console',
    description:
      'Watch picks land in real time, override, skip, freeze. AI advisory panel docked here.',
    emphasis: true,
  },
];

// Secondary tools below.
const SECONDARY_LINKS: LinkEntry[] = [
  {
    href: '/admin/eligibility',
    title: 'Eligibility Preview',
    description: 'Test whether a member is eligible for a position without committing a pick.',
  },
  {
    href: '/admin/audit',
    title: 'Audit Log',
    description: 'Search, filter, and export the event audit trail.',
  },
  {
    href: '/admin/exports',
    title: 'Exports',
    description: 'Roster PDFs (per shift) and audit-log CSV downloads.',
  },
  {
    href: '/admin/rule-books',
    title: 'Rule Books',
    description: 'View, draft, and publish rule book versions.',
  },
  {
    href: '/admin/rules',
    title: 'Position Rules',
    description: 'Inspect required criteria, points preferences, and tie-break chains.',
  },
  {
    href: '/admin/positions',
    title: 'Positions',
    description: 'View bid positions grouped by shift and station.',
  },
  {
    href: '/admin/members',
    title: 'Members',
    description: 'View and search all department members.',
  },
  {
    href: '/admin/credentials',
    title: 'Credentials',
    description: 'Browse certification types and point values.',
  },
  {
    href: '/admin/members/import',
    title: 'Import Members',
    description: 'Upload a Telestaff CSV to seed or refresh member records.',
  },
  {
    href: '/admin/credentials/import',
    title: 'Import Credentials',
    description: 'Upload a CSV to seed credential definitions.',
  },
];

export default async function AdminDashboardPage() {
  const claims = await requireAdmin();

  return (
    <div>
      <h1 className="font-heading text-2xl text-white">Admin Dashboard</h1>
      <p className="mt-1 text-sm text-slate-300">
        Welcome back, {claims.first_name} {claims.last_name}.
      </p>

      {/* Pinned CTA — jumping directly into the live bid is the single most
          common operator action, so it gets its own full-width card at the
          top of the dashboard. */}
      <Link
        href={'/admin/bid' as Route}
        className="mt-6 flex items-center justify-between rounded-xl border-2 border-red-700 bg-gradient-to-br from-red-900/70 to-red-950 p-5 transition-colors duration-fast ease-out-quart hover:border-red-500 hover:from-red-800/80"
      >
        <div>
          <p className="font-heading text-xl font-semibold text-white">
            <span aria-hidden className="mr-2">
              ●
            </span>
            Live Bid Console
          </p>
          <p className="mt-1 text-sm text-red-100">
            Watch the bid play out, see who's next, view AI advisories as each turn comes up. Works
            for both real bids and mock drafts.
          </p>
        </div>
        <span className="hidden text-sm font-medium text-red-200 sm:block">Open →</span>
      </Link>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Run a bid
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PRIMARY_ACTIONS.map(({ href, title, description }) => (
          <Link
            key={href}
            href={href as Route}
            className="group rounded-xl border-2 border-red-700/60 bg-gradient-to-br from-red-950/40 to-slate-800 p-5 transition-colors duration-fast ease-out-quart hover:border-red-500 hover:from-red-900/60"
          >
            <dt className="font-heading text-base font-semibold text-white group-hover:text-red-300">
              {title}
            </dt>
            <dd className="mt-2 text-sm text-slate-300">{description}</dd>
          </Link>
        ))}
      </dl>

      <h2 className="mt-10 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Manage data & inspect
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECONDARY_LINKS.map(({ href, title, description }) => (
          <Link
            key={href}
            href={href as Route}
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
