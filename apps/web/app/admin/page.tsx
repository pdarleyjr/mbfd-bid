import { requireAdmin } from '@/lib/require-admin';
import type { Route } from 'next';
import Link from 'next/link';

type ControlArea = {
  href: string;
  title: string;
  description: string;
  state: string;
  stateClassName: string;
};

const CONTROL_AREAS: readonly ControlArea[] = [
  {
    href: '/admin/staffing-structure',
    title: 'Staffing Structure',
    description:
      'Manage authorized seats, manning capacity, occupancy, and effective-dated retirement.',
    state: 'Year-round control',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/current-rosters',
    title: 'Current Rosters',
    description:
      'Read the Bid-side staffing projection without treating vacancies as bid openings.',
    state: 'Canonical projection',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/telestaff',
    title: 'TeleStaff',
    description: 'Review the controlled staffing-source intake and reconciliation boundary.',
    state: 'Controlled reconciliation',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/members',
    title: 'Members',
    description: 'Review member and credential records separately from operational staffing.',
    state: 'Administration',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/credentials',
    title: 'Credentials & Specialty Points',
    description:
      'Maintain credential references and default informational points with lifecycle links.',
    state: 'Catalog control',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/personnel',
    title: 'Personnel Changes',
    description:
      'Record effective-dated hires, rank changes, transfers, separations, vacancies, and position changes.',
    state: 'Effective-dated workflow',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/bid-setup',
    title: 'Bid Setup',
    description:
      'Inspect rule books, positions, rules, and eligibility before a lifecycle decision.',
    state: 'Configuration workspace',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/annual-policy',
    title: 'Annual Policy',
    description:
      'Draft, review, publish, and supersede human-readable annual bid policy revisions.',
    state: 'Versioned lifecycle',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/rehearsal',
    title: 'Mock Bids',
    description: 'Review rehearsal evidence without using mock activity as a staffing source.',
    state: 'Isolated rehearsal',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/bid',
    title: 'Live Bid & Advisory',
    description:
      'Open the guarded live-bid surface with deterministic explanations of authoritative state.',
    state: 'Immediate read-only advisory',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/audit',
    title: 'Results & Audit',
    description: 'Review recorded outcomes, audit evidence, and existing exports.',
    state: 'Review surface',
    stateClassName: 'text-slate-300',
  },
  {
    href: '/admin/system',
    title: 'System/Integrations',
    description:
      'See integration boundaries without changing infrastructure or publication settings.',
    state: 'Read-only status',
    stateClassName: 'text-amber-200',
  },
];

export default async function AdminDashboardPage() {
  const claims = await requireAdmin();

  return (
    <section className="max-w-6xl space-y-8" aria-labelledby="admin-dashboard-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          MBFD annual bid control center
        </p>
        <h1 id="admin-dashboard-heading" className="mt-1 font-heading text-2xl text-white">
          Dashboard
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Manage your workforce, prepare the next annual bid, and review assignments. Welcome back,{' '}
          {claims.first_name} {claims.last_name}.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Link
          href="/admin/annual-plan"
          className="group rounded-xl border border-red-500/60 bg-gradient-to-br from-red-950 to-slate-900 p-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-red-200">
            Annual preparation
          </p>
          <h2 className="mt-2 font-heading text-2xl text-white">
            Prepare Next Bid <span aria-hidden="true">→</span>
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-200">
            Start or resume your annual plan. Review seats, participants, qualifications and policy,
            then rehearse and freeze the reviewed configuration.
          </p>
          <p className="mt-5 text-sm font-semibold text-red-200 group-hover:text-white">
            Open guided preparation
          </p>
        </Link>
        <Link
          href="/admin/bid-board"
          className="group rounded-xl border border-slate-600 bg-slate-800 p-6 hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Assignments at a glance
          </p>
          <h2 className="mt-2 font-heading text-2xl text-white">
            Bid Board <span aria-hidden="true">→</span>
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-200">
            Compare the previous official bid, current staffing and the upcoming plan. Each view
            keeps its own stations, seats and source dates.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-slate-200">
            {['Previous Bid', 'Current Staffing', 'Upcoming Bid'].map((label) => (
              <span key={label} className="rounded border border-slate-600 px-2 py-1">
                {label}
              </span>
            ))}
          </div>
        </Link>
      </div>

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Control areas
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CONTROL_AREAS.map(({ href, title, description, state, stateClassName }) => (
            <Link
              key={href}
              href={href as Route}
              className="group rounded-xl border border-slate-700 bg-slate-800 p-5 transition-colors duration-fast ease-out-quart hover:border-red-700"
            >
              <dt className="font-heading text-base font-semibold text-white group-hover:text-red-400">
                {title}
              </dt>
              <dd className="mt-1 text-sm text-slate-400">{description}</dd>
              <dd
                className={`mt-3 text-xs font-semibold uppercase tracking-wide ${stateClassName}`}
              >
                {state}
              </dd>
            </Link>
          ))}
        </dl>
      </div>
    </section>
  );
}
