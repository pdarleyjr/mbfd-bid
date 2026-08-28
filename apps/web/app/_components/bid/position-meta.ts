/**
 * Lightweight position-id → human label helper.
 *
 * The bid roster + bidder context strips show "A211 · Station #2 · DC" so
 * the chief can read a position pick in plain English without consulting
 * the station grid. A session-bound board passes its immutable position
 * material explicitly. The bundled catalog exists only for views which do not
 * have a session snapshot at all; it must never be selected implicitly for a
 * session-bound board.
 */
import positionsRaw from '../../bid/_data/positions.json';
import type { PositionMeta } from './types';

export const FALLBACK_POSITION_METADATA: readonly PositionMeta[] = positionsRaw as PositionMeta[];

export function getPositionMeta(
  positions: readonly PositionMeta[],
  positionId: string | null | undefined,
): PositionMeta | null {
  if (positionId === null || positionId === undefined) return null;
  return positions.find((position) => position.id === positionId) ?? null;
}

/**
 * Produce a short display label for a position id. Falls back to the bare
 * id when the position isn't recognised (e.g. legacy 2025 ids that don't
 * survive the 2026 renumbering).
 */
export function formatPositionLabel(
  positions: readonly PositionMeta[],
  positionId: string | null | undefined,
): string {
  if (positionId === null || positionId === undefined || positionId.length === 0) return '—';
  const meta = getPositionMeta(positions, positionId);
  if (!meta) return positionId;
  // e.g. "A211 — Station #2 / DC Chief"
  return `${meta.id} · ${meta.station} / ${meta.unit} ${meta.positionName}`;
}
