export type SeatRole =
  | 'captain'
  | 'lieutenant'
  | 'driver-engineer'
  | 'engine-firefighter'
  | 'rescue-firefighter'
  | 'marine-firefighter'
  | 'inspector'
  | 'other';

export interface SeatRoleInput {
  rankRequired: string;
  positionName: string;
  unit: string;
  division?: string | undefined;
}

const backgrounds: Record<SeatRole, string> = {
  captain: '#fef08a',
  lieutenant: '#fca5a5',
  'driver-engineer': '#bbf7d0',
  'engine-firefighter': '#e5e7eb',
  'rescue-firefighter': '#bae6fd',
  'marine-firefighter': '#e6bb48',
  inspector: '#fdba74',
  other: '#f3f4f6',
};

/** Position colors describe the seat, independent of its occupant or Bid mode. */
export function getSeatAppearance(position: SeatRoleInput) {
  const rank = position.rankRequired.trim().toUpperCase();
  const role = position.positionName.trim();
  const apparatus = `${position.unit} ${position.division ?? ''}`;
  const firefighter = /^(FF|FIREFIGHTER|DE)$/.test(rank) || /\bfirefighter\b/i.test(role);
  let kind: SeatRole = 'other';
  if (/^(CPT|CAPT|CAPTAIN)$/.test(rank)) kind = 'captain';
  else if (/^(LT|LIEUTENANT)$/.test(rank)) kind = 'lieutenant';
  else if (/\bcaptain\b/i.test(role)) kind = 'captain';
  else if (/\blieutenant\b/i.test(role)) kind = 'lieutenant';
  else if (/\binspector\b|\binspection\b|\binvestigator\b|\bINV\b/i.test(`${role} ${apparatus}`))
    kind = 'inspector';
  else if (
    firefighter &&
    /\bmarine\b|\bfire\s*boat\b|\bdeckhand\b|\bFBO\b/i.test(`${role} ${apparatus}`)
  )
    kind = 'marine-firefighter';
  else if (/\bDE\b|\bdriver\s*engineer\b/i.test(role) || rank === 'DE') kind = 'driver-engineer';
  else if (firefighter)
    kind = /\brescue\b/i.test(apparatus) ? 'rescue-firefighter' : 'engine-firefighter';
  return {
    role: kind,
    backgroundColor: backgrounds[kind],
    color: '#111827',
    mutedColor: '#374151',
  };
}

/** Only the saved canonical forced provenance establishes a forced operator marker. */
export function getForcedAssignmentLabel(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const metadata = value as Record<string, unknown>;
  if (
    typeof metadata.commandId !== 'string' ||
    !metadata.commandId.trim() ||
    typeof metadata.actorMemberId !== 'number' ||
    !Number.isInteger(metadata.actorMemberId) ||
    metadata.actorMemberId < 0 ||
    typeof metadata.atMs !== 'number' ||
    !Number.isFinite(metadata.atMs) ||
    metadata.atMs < 0 ||
    typeof metadata.reason !== 'string'
  )
    return null;
  const note = metadata.reason.trim();
  return note ? `Forced assignment: ${note}` : 'Forced assignment';
}
