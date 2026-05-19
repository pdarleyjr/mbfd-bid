// apps/web/app/bid/_components/ADayInvariantBadge.tsx
// Plan 07 Task 15: shows "X / 5 OFC" badge with color signaling whether the
// group has met its officer count requirement.

interface Props {
  officers: number;
  required: number | undefined;
  /** Optional tooltip text — e.g., the OfficerInvariantSnapshot.explanation. */
  title?: string;
}

export function ADayInvariantBadge({ officers, required, title }: Props) {
  if (required === undefined) return null;
  const met = officers === required;
  const over = officers > required;
  const colorClass = over
    ? 'bg-red-100 text-red-900 border-red-400'
    : met
      ? 'bg-emerald-100 text-emerald-900 border-emerald-400'
      : 'bg-amber-100 text-amber-900 border-amber-400';
  return (
    <span
      title={title}
      className={`inline-flex items-center px-1.5 py-0.5 text-xs rounded border ${colorClass}`}
    >
      {officers}/{required} OFC{met ? ' ✓' : over ? ' ⚠' : ''}
    </span>
  );
}
