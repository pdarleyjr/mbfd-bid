import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdmin } from '@/lib/require-admin';
import {
  ArrowLeftRight,
  ArrowRight,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  ClipboardList,
  FileText,
  FlaskConical,
  Network,
  Radio,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  UsersRound,
} from 'lucide-react';
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
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/current-rosters',
    title: 'Current Rosters',
    description:
      'Read the Bid-side staffing projection without treating vacancies as bid openings.',
    state: 'Canonical projection',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/telestaff',
    title: 'TeleStaff',
    description: 'Review the controlled staffing-source intake and reconciliation boundary.',
    state: 'Controlled reconciliation',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/members',
    title: 'Members',
    description: 'Review member and credential records separately from operational staffing.',
    state: 'Administration',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/credentials',
    title: 'Credentials & Specialty Points',
    description:
      'Maintain credential references and default informational points with lifecycle links.',
    state: 'Catalog control',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/personnel',
    title: 'Personnel Changes',
    description:
      'Record effective-dated hires, rank changes, transfers, separations, vacancies, and position changes.',
    state: 'Effective-dated workflow',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/bid-setup',
    title: 'Bid Setup',
    description:
      'Inspect rule books, positions, rules, and eligibility before a lifecycle decision.',
    state: 'Configuration workspace',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/annual-policy',
    title: 'Annual Policy',
    description:
      'Draft, review, publish, and supersede human-readable annual bid policy revisions.',
    state: 'Versioned lifecycle',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/rehearsal',
    title: 'Mock Bids',
    description: 'Review rehearsal evidence without using mock activity as a staffing source.',
    state: 'Isolated rehearsal',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/bid',
    title: 'Live Bid & Advisory',
    description:
      'Open the guarded live-bid surface with deterministic explanations of authoritative state.',
    state: 'Immediate read-only advisory',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/audit',
    title: 'Results & Audit',
    description: 'Review recorded outcomes, audit evidence, and existing exports.',
    state: 'Review surface',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/system',
    title: 'System/Integrations',
    description:
      'See integration boundaries without changing infrastructure or publication settings.',
    state: 'Read-only status',
    stateClassName: 'text-warning bg-warning-surface',
  },
];

const AREA_ICONS = [
  Building2,
  UsersRound,
  Network,
  Users,
  ShieldCheck,
  ArrowLeftRight,
  SlidersHorizontal,
  FileText,
  FlaskConical,
  Radio,
  ChartNoAxesColumn,
  Settings,
];
export default async function AdminDashboardPage() {
  const claims = await requireAdmin();
  return (
    <section className="mx-auto max-w-[100rem] space-y-7" aria-labelledby="admin-dashboard-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          MBFD annual bid control center
        </p>
        <h1
          id="admin-dashboard-heading"
          className="mt-2 font-heading text-3xl font-bold tracking-tight"
        >
          Dashboard
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Manage your workforce, prepare the next annual bid, and review assignments. Welcome back,{' '}
          {claims.first_name} {claims.last_name}.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-sidebar bg-sidebar text-sidebar-foreground">
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-gold">
              Annual preparation
            </p>
            <CardTitle className="text-2xl">
              Prepare Next Bid <ArrowRight className="ml-2 inline h-5 w-5" aria-hidden="true" />
            </CardTitle>
            <CardDescription className="max-w-lg text-sidebar-foreground">
              Start or resume your annual plan. Review seats, participants, qualifications and
              policy, then rehearse and freeze the reviewed configuration.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/annual-plan" className={buttonVariants({ variant: 'primary' })}>
              Open guided preparation <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Assignments at a glance
            </p>
            <CardTitle className="text-2xl">
              <Link href="/admin/bid-board" className="hover:text-info">
                Bid Board <ArrowRight className="ml-2 inline h-5 w-5" aria-hidden="true" />
              </Link>
            </CardTitle>
            <CardDescription>
              Compare the previous official bid, current staffing and the upcoming plan. Each view
              keeps its own stations, seats and source dates.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[
              { view: 'previous', label: 'Previous Bid', Icon: ClipboardList },
              { view: 'current', label: 'Current Staffing', Icon: UsersRound },
              { view: 'upcoming', label: 'Upcoming Bid', Icon: CalendarDays },
            ].map(({ view, label, Icon }) => (
              <Link
                key={view}
                href={`/admin/bid-board?view=${view}` as Route}
                className={buttonVariants({ size: 'sm' })}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
      <div>
        <div className="flex items-center gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Control areas
          </h2>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CONTROL_AREAS.map(({ href, title, description, state, stateClassName }, index) => {
            const Icon = AREA_ICONS[index] ?? Settings;
            return (
              <Link
                key={href}
                href={href as Route}
                className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-input hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="mt-0.5 rounded-full bg-info-surface p-2.5 text-info">
                  <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-heading text-sm font-bold group-hover:text-info">{title}</h3>
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">{description}</p>
                  <Badge className={`mt-2 border-0 text-[10px] ${stateClassName}`}>{state}</Badge>
                </div>
                <ArrowRight
                  size={16}
                  className="mt-1 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
