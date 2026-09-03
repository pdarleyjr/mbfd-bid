import type { Route } from 'next';
import Link from 'next/link';

export interface CurrentRosterPosition {
  id: string;
  stableSlotKey: string;
  division: string | null;
  shift: string | null;
  station: string | null;
  unit: string | null;
  positionName: string | null;
  applicableRank: string | null;
  occupancy: 'occupied' | 'vacant';
  administrativeAssignment: boolean;
  assignment: {
    id: string;
    memberId: number;
    originType: string | null;
    status: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  } | null;
  member: {
    id: number;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    rank: string | null;
  } | null;
}

export interface CurrentRosterResponse {
  asOf: string;
  administrativeAssignmentPolicy: {
    status: 'configured' | 'unconfigured';
    bidYear: number;
    ruleBookVersion: string | null;
  };
  positions: CurrentRosterPosition[];
  summary: {
    totalPositions: number;
    occupiedPositions: number;
    vacantPositions: number;
    administrativelyAssignedNonBiddablePositions: number;
  };
  unassignedMembers: Array<{
    id: number;
    employeeId: string;
    firstName: string;
    lastName: string;
    rank: string;
    bidCategory: string;
  }>;
}

const SHIFT_LABELS: Readonly<Record<string, string>> = {
  A: 'A Shift',
  B: 'B Shift',
  C: 'C Shift',
  D: 'D / Days',
};

function display(value: string | null): string {
  return value === null || value.trim().length === 0 ? 'Not specified' : value;
}

function memberName(position: CurrentRosterPosition): string {
  if (position.member === null) return 'Vacant';
  return `${display(position.member.firstName)} ${display(position.member.lastName)}`;
}

function rowsForShift(positions: readonly CurrentRosterPosition[], shift: string) {
  return positions.filter((position) => position.shift === shift);
}

function RosterTable({ positions }: { positions: readonly CurrentRosterPosition[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-400">
          <tr>
            <th className="border-b border-slate-700 px-3 py-3 font-semibold">Location</th>
            <th className="border-b border-slate-700 px-3 py-3 font-semibold">Seat</th>
            <th className="border-b border-slate-700 px-3 py-3 font-semibold">Member</th>
            <th className="border-b border-slate-700 px-3 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {positions.map((position) => (
            <tr key={position.id} className="align-top text-slate-200">
              <td className="px-3 py-3">
                <p className="font-medium text-slate-100">Station {display(position.station)}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {display(position.unit)} · {display(position.division)}
                </p>
              </td>
              <td className="px-3 py-3">
                <p className="font-medium text-slate-100">{display(position.positionName)}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Required rank: {display(position.applicableRank)}
                </p>
              </td>
              <td className="px-3 py-3">
                <p
                  className={
                    position.member === null ? 'font-medium text-amber-200' : 'font-medium'
                  }
                >
                  {memberName(position)}
                </p>
                {position.member !== null && (
                  <p className="mt-0.5 text-xs text-slate-400">{display(position.member.rank)}</p>
                )}
              </td>
              <td className="px-3 py-3">
                <span
                  className={
                    position.occupancy === 'occupied'
                      ? 'inline-flex rounded-full bg-emerald-950/70 px-2 py-1 text-xs font-semibold text-emerald-200'
                      : 'inline-flex rounded-full bg-amber-950/70 px-2 py-1 text-xs font-semibold text-amber-200'
                  }
                >
                  {position.occupancy === 'occupied' ? 'Occupied' : 'Vacant'}
                </span>
                {position.administrativeAssignment && (
                  <p className="mt-1 max-w-44 text-xs font-medium text-sky-200">
                    Administratively assigned · non-biddable
                  </p>
                )}
                {position.assignment !== null && (
                  <div className="mt-1 max-w-52 text-xs text-slate-400">
                    <p>
                      {position.assignment.status ?? 'assignment'} · effective{' '}
                      {position.assignment.effectiveFrom ?? 'unspecified'}
                      {position.assignment.effectiveTo === null
                        ? ' onward'
                        : ` through ${position.assignment.effectiveTo}`}
                    </p>
                    <Link
                      href={
                        `/admin/personnel?memberId=${position.assignment.memberId}&assignmentId=${position.assignment.id}` as Route
                      }
                      className="mt-1 inline-flex min-h-8 items-center font-medium text-red-300 hover:text-red-200"
                    >
                      Assignment history
                    </Link>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CurrentRostersWorkspace({
  roster,
  filters = {},
}: {
  roster: CurrentRosterResponse;
  filters?: Record<string, string>;
}) {
  const hasProjectedRoster = roster.positions.length > 0;
  const query = new URLSearchParams({ as_of: roster.asOf, ...filters }).toString();

  return (
    <section className="space-y-7" aria-labelledby="current-rosters-heading">
      <header className="flex flex-col gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Staffing projection · as of {roster.asOf}
          </p>
          <h1 id="current-rosters-heading" className="mt-1 font-heading text-2xl text-white">
            Current Rosters
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Operational staffing capacity and current occupancy are shown separately. A vacancy is a
            staffing condition, not a Bid opportunity.
          </p>
        </div>
        <Link
          href={'/admin/personnel' as Route}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-600 bg-red-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-300"
        >
          Record personnel change
        </Link>
      </header>

      <form
        method="get"
        action="/admin/current-rosters"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-700 bg-slate-800/40 p-4"
      >
        <label className="block">
          <span className="text-sm font-medium text-slate-200">View staffing date</span>
          <input
            type="date"
            name="as_of"
            defaultValue={roster.asOf}
            className="mt-1 block min-h-11 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Shift</span>
          <select
            name="shift"
            defaultValue={filters.shift ?? ''}
            className="mt-1 block min-h-11 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
          >
            <option value="">All shifts</option>
            <option value="A">A Shift</option>
            <option value="B">B Shift</option>
            <option value="C">C Shift</option>
            <option value="D">D / Days</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Station</span>
          <input
            name="station"
            defaultValue={filters.station ?? ''}
            className="mt-1 block min-h-11 w-28 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Division</span>
          <input
            name="division"
            defaultValue={filters.division ?? ''}
            className="mt-1 block min-h-11 w-36 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Unit</span>
          <input
            name="unit"
            defaultValue={filters.unit ?? ''}
            className="mt-1 block min-h-11 w-36 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-200">Rank</span>
          <input
            name="rank"
            defaultValue={filters.rank ?? ''}
            className="mt-1 block min-h-11 w-24 rounded border border-slate-600 bg-slate-900 px-3 py-2 text-white"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300"
        >
          View date
        </button>
        <p className="pb-2 text-xs text-slate-400">
          Future dates show planned assignments; prior dates preserve reviewed history.
        </p>
        <a
          href={`/api/admin/current-roster/export.csv?${query}`}
          className="inline-flex min-h-11 items-center rounded border border-sky-700 px-4 py-2 text-sm font-semibold text-sky-100 hover:border-sky-400 hover:text-white"
        >
          Download roster CSV
        </a>
        <Link
          href={`/admin/current-rosters/print?${query}` as Route}
          className="inline-flex min-h-11 items-center rounded border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-slate-300"
        >
          Printable roster
        </Link>
      </form>

      <section aria-labelledby="roster-summary-heading">
        <h2 id="roster-summary-heading" className="font-heading text-lg text-white">
          Roster at a glance
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-slate-800 py-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-slate-400">Authorized seats</dt>
            <dd className="mt-1 text-xl font-semibold text-white">
              {roster.summary.totalPositions}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Occupied</dt>
            <dd className="mt-1 text-xl font-semibold text-emerald-300">
              {roster.summary.occupiedPositions}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Vacant</dt>
            <dd className="mt-1 text-xl font-semibold text-amber-200">
              {roster.summary.vacantPositions}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Administratively assigned</dt>
            <dd className="mt-1 text-xl font-semibold text-sky-200">
              {roster.summary.administrativelyAssignedNonBiddablePositions}
            </dd>
          </div>
        </dl>
      </section>

      {!hasProjectedRoster ? (
        <section className="border border-amber-700/70 bg-amber-950/30 px-4 py-5 text-sm text-amber-100">
          <h2 className="font-semibold">No reviewed staffing projection is available yet</h2>
          <p className="mt-1 max-w-3xl text-amber-100/90">
            Complete the TeleStaff review and mapping workflow before treating this view as a
            staffing baseline. No position or Bid opportunity is created by this screen.
          </p>
        </section>
      ) : (
        <div className="space-y-8">
          {(['A', 'B', 'C', 'D'] as const).map((shift) => {
            const positions = rowsForShift(roster.positions, shift);
            if (positions.length === 0) return null;
            return (
              <section key={shift} aria-labelledby={`roster-${shift}-heading`}>
                <div className="flex items-baseline justify-between gap-4 border-b border-slate-800 pb-2">
                  <h2 id={`roster-${shift}-heading`} className="font-heading text-lg text-white">
                    {SHIFT_LABELS[shift]}
                  </h2>
                  <p className="text-sm text-slate-400">
                    {positions.length} authorized seat{positions.length === 1 ? '' : 's'}
                  </p>
                </div>
                <RosterTable positions={positions} />
              </section>
            );
          })}
        </div>
      )}

      <section aria-labelledby="unassigned-heading" className="border-t border-slate-800 pt-6">
        <h2 id="unassigned-heading" className="font-heading text-lg text-white">
          Unassigned members
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Members shown here are not currently placed in an authorized active or planned seat.
        </p>
        {roster.unassignedMembers.length === 0 ? (
          <p className="mt-3 text-sm text-slate-300">
            No active or unclassified members are unassigned.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {roster.unassignedMembers.map((member) => (
              <li key={member.id} className="border-l border-slate-600 pl-3 text-sm text-slate-200">
                <span className="font-medium text-white">
                  {member.firstName} {member.lastName}
                </span>
                <span className="ml-2 text-slate-400">{member.rank}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {roster.administrativeAssignmentPolicy.status === 'unconfigured' && (
        <p className="border-l-2 border-amber-500 pl-3 text-sm text-amber-100">
          The {roster.administrativeAssignmentPolicy.bidYear} policy book is not designated. This
          roster therefore makes no claim about annual Bid participation.
        </p>
      )}
    </section>
  );
}
