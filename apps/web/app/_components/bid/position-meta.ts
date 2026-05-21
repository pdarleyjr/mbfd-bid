/**
 * Lightweight position-id → human label helper.
 *
 * The bid roster + bidder context strips show "A211 · Station #2 · DC" so
 * the chief can read a position pick in plain English without consulting
 * the station grid. Built on top of the bundled positions.json so it stays
 * in sync with the rest of the board.
 */
import positionsRaw from '../../bid/_data/positions.json';
import type { PositionMeta } from './types';

const ALL_POSITIONS = positionsRaw as PositionMeta[];
const BY_ID = new Map(ALL_POSITIONS.map((p) => [p.id, p]));

export function getPositionMeta(positionId: string | null | undefined): PositionMeta | null {
  if (positionId === null || positionId === undefined) return null;
  return BY_ID.get(positionId) ?? null;
}

/**
 * Produce a short display label for a position id. Falls back to the bare
 * id when the position isn't recognised (e.g. legacy 2025 ids that don't
 * survive the 2026 renumbering).
 */
export function formatPositionLabel(positionId: string | null | undefined): string {
  if (positionId === null || positionId === undefined || positionId.length === 0) return '—';
  const meta = BY_ID.get(positionId);
  if (!meta) return positionId;
  // e.g. "A211 — Station #2 / DC Chief"
  return `${meta.id} · ${meta.station} / ${meta.unit} ${meta.positionName}`;
}
