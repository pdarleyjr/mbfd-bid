import { requireAdmin } from '@/lib/require-admin';
import { serverWorkerFetch } from '@/lib/server-worker-fetch';

interface OperationsDashboard {
  asOf: string;
  activePersonnel: number;
  permanentVacancies: number;
  dailyStaffingVacancies: number;
  annualBidVacanciesFromOverlays: number;
  specialAssignment: number;
  lightDuty: number;
  qualificationRowsNeedingReview: number;
  credentialExceptions: number;
  teleStaffReconciliationExceptions: number;
  promotions: number;
  retirements: number;
  separations: number;
  permanentAssignmentChanges: number;
  destinationStaffing: 'POLICY_PENDING';
}

const cards: Array<[keyof OperationsDashboard, string]> = [
  ['activePersonnel', 'Active personnel'],
  ['permanentVacancies', 'Permanent vacancies'],
  ['dailyStaffingVacancies', 'Daily temporary vacancies'],
  ['specialAssignment', 'Active Special Assignment'],
  ['lightDuty', 'Active Light Duty'],
  ['qualificationRowsNeedingReview', 'Qualification rows needing review'],
  ['credentialExceptions', 'Credential exceptions'],
  ['teleStaffReconciliationExceptions', 'TeleStaff exceptions'],
  ['promotions', 'Promotions'],
  ['retirements', 'Retirements'],
  ['separations', 'Separations'],
  ['permanentAssignmentChanges', 'Permanent assignment changes'],
];

export default async function OperationsDashboardPage() {
  await requireAdmin();
  let data: OperationsDashboard | null = null;
  let error: string | null = null;
  try {
    const response = await serverWorkerFetch('/api/admin/personnel/operations-dashboard');
    if (!response.ok) error = `Operations read model returned ${response.status}.`;
    else data = (await response.json()) as OperationsDashboard;
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : 'Operations read model could not be reached.';
  }
  return (
    <section className="mx-auto max-w-7xl space-y-6" aria-labelledby="operations-dashboard-heading">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive">
          Command Staff read model
        </p>
        <h1
          id="operations-dashboard-heading"
          className="mt-1 font-heading text-3xl text-foreground"
        >
          Year-round operations
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-foreground">
          Live, query-only operational indicators. This view does not infer annual Bid eligibility
          or write to TeleStaff.
        </p>
      </header>
      {error !== null || data === null ? (
        <div className="rounded-xl border border-warning/40 bg-warning-surface p-5 text-sm text-warning">
          {error ?? 'No operations read model was returned.'} No substitute totals are displayed.
        </div>
      ) : (
        <>
          <p className="rounded border border-warning/40 bg-warning-surface px-4 py-3 text-sm text-warning">
            Temporary destination staffing is <strong>{data.destinationStaffing}</strong>. Overlay
            vacancies are daily-staffing only; annual Bid vacancies from overlays remain{' '}
            {data.annualBidVacanciesFromOverlays}.
          </p>
          <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-muted sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(([key, label]) => (
              <div key={key} className="bg-card p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </p>
                <p className="mt-2 font-heading text-3xl text-foreground">{data[key] as number}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            As of {data.asOf}. Counts are current read-model values, not targets or fabricated
            departmental assumptions.
          </p>
        </>
      )}
    </section>
  );
}
