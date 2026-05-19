import positionsData from '../_data/positions.json';
import { PositionCell } from './PositionCell';

interface PositionData {
  id: string;
}

interface Props {
  fills: Record<string, { memberId: number; ordinal: number; bidId: string }>;
}

export function PositionGrid({ fills }: Props) {
  // Position list is loaded from the static seed JSON (see apps/worker/seed/fixtures/2026_positions.json).
  // The client island reconciles deltas from the WebSocket stream.
  const positions = positionsData as PositionData[];
  return (
    <div data-testid="position-grid" className="grid grid-cols-2 gap-4 p-6 md:grid-cols-4">
      {positions.map((p) => (
        <PositionCell key={p.id} positionId={p.id} fill={fills[p.id] ?? null} />
      ))}
    </div>
  );
}
