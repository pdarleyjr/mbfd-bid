import { rosterTone, unitTone } from '@/components/admin/RosterIdentity';
import { Button } from '@/components/ui/button';
import type { DepartmentRosterPosition } from '@mbfd/shared';
import type { RosterGroup } from './roster-pagination';

export function RosterRow({
  position,
  measuring = false,
  compactContext = false,
  onOpenPosition,
}: {
  position: DepartmentRosterPosition;
  measuring?: boolean;
  compactContext?: boolean;
  onOpenPosition?: ((position: DepartmentRosterPosition) => void) | undefined;
}) {
  const memberName = position.member
    ? [position.member.firstName, position.member.lastName].filter(Boolean).join(' ') ||
      'Member name unavailable'
    : position.occupancy === 'vacant'
      ? 'Vacant'
      : 'Assigned member needs review';
  return (
    <div
      data-position-id={measuring ? undefined : position.id}
      data-measure-row={measuring && !compactContext ? position.id : undefined}
      data-measure-compact-row={measuring && compactContext ? position.id : undefined}
      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-x-3 border-t border-border px-3 py-2 text-[13px] leading-[18px]"
    >
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p className="font-medium">{position.positionName || 'Position not specified'}</p>
        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
          {position.applicableRank || 'Rank not specified'}
        </p>
      </div>
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p
          className={
            position.occupancy === 'vacant' ? 'font-semibold text-warning' : 'font-semibold'
          }
        >
          {memberName}
        </p>
        {position.member?.rank && (
          <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{position.member.rank}</p>
        )}
        {compactContext && position.temporaryContext.length > 0 ? (
          <Button
            type="button"
            variant="link"
            className="mt-1 min-h-11 justify-start text-left text-xs leading-4 underline"
            onClick={() => onOpenPosition?.(position)}
          >
            View assignment details ({position.temporaryContext.length})
          </Button>
        ) : (
          position.temporaryContext.map((overlay) => (
            <p key={overlay.id} className="mt-1 text-xs leading-4 text-warning">
              {overlay.kind === 'LIGHT_DUTY' ? 'Light duty' : 'Special assignment'} from{' '}
              {overlay.effectiveOn}
              {overlay.plannedEndOn ? ` · planned through ${overlay.plannedEndOn}` : ''}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

export function RosterCard({
  group,
  positions,
  measuring = false,
  compactPositionIds = [],
  onOpenPosition,
}: {
  group: RosterGroup;
  positions: DepartmentRosterPosition[];
  measuring?: boolean;
  compactPositionIds?: readonly string[];
  onOpenPosition?: ((position: DepartmentRosterPosition) => void) | undefined;
}) {
  return (
    <section
      className="min-w-0 rounded-lg border border-border bg-card"
      aria-label={`${group.station} · ${group.unit || 'Unit not specified'}`}
    >
      <div data-measure-heading={measuring ? group.id : undefined}>
        <header className="rounded-t-lg bg-station-header px-3 py-2">
          <h2 className="font-heading text-sm font-semibold leading-5 [overflow-wrap:anywhere]">
            {group.station}
          </h2>
        </header>
        <div
          className={`border-t px-3 py-1.5 text-xs font-semibold leading-4 [overflow-wrap:anywhere] ${rosterTone({ tone: unitTone(group.unit) })}`}
        >
          {group.unit || 'Unit not specified'}
        </div>
      </div>
      {positions.map((position) => (
        <RosterRow
          key={position.id}
          position={position}
          measuring={measuring}
          compactContext={compactPositionIds.includes(position.id)}
          onOpenPosition={onOpenPosition}
        />
      ))}
    </section>
  );
}
