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
    href: '/admin/members',
    title: 'People',
    description: 'Find a member, update qualifications and review service history.',
    state: 'Year-round maintenance',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/targetsolutions',
    title: 'Import credentials',
    description:
      'Compare a TargetSolutions export and apply reviewed additions, renewals and date updates.',
    state: 'Upload → Review → Apply',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/current-rosters',
    title: 'Staffing',
    description: 'Review assignments, maintain authorized positions and import TeleStaff changes.',
    state: 'Positions and assignments',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/audit',
    title: 'History & Reports',
    description:
      'Review recorded decisions, download results and apply reviewed final assignments.',
    state: 'Preserved evidence',
    stateClassName: 'text-info bg-info-surface',
  },
  {
    href: '/admin/docs',
    title: 'Docs & Manual',
    description:
      'Search step-by-step instructions, explain a control or download the complete manual.',
    state: 'Help for every work area',
    stateClassName: 'text-info bg-info-surface',
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
          Today
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
              Annual Bid <ArrowRight className="ml-2 inline h-5 w-5" aria-hidden="true" />
            </CardTitle>
            <CardDescription className="max-w-lg text-sidebar-foreground">
              Start or resume your annual plan. Review seats, participants, qualifications and
              policy, then practice and approve the setup.
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
            Everyday tasks
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
