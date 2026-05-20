import type { Rank } from '@mbfd/eligibility';

export interface RosterMember {
  employeeId: string;
  firstName: string;
  lastName: string;
  rank: Rank;
  bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
  rscSeniority: number;
  rankSeniority: number | null;
  isProbationary: boolean;
  credentials: string[];
  priorYearBid: string | null;
}

export interface EligibilityMatrixRow {
  memberEmployeeId: string;
  positionId: string;
  eligible: boolean;
  points: number;
  soPoints: number;
  moPoints: number;
  reasons: string[];
}

export interface RosterInput {
  bidSessionId: string;
  members: RosterMember[];
  eligibilityMatrix: EligibilityMatrixRow[];
}

function stable(o: unknown): string {
  // JSON.stringify with sorted keys. We keep deterministic ordering even
  // though Workers AI no longer caches prompt prefixes — identical inputs
  // should still produce identical outputs (and identical promptHash audit
  // rows) regardless of input key order.
  const seen = new WeakSet<object>();
  return JSON.stringify(o, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (seen.has(v as object)) return undefined;
      seen.add(v as object);
      const obj = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(obj)
          .sort()
          .map((k) => [k, obj[k]]),
      );
    }
    return v;
  });
}

function renderMember(m: RosterMember): string {
  return stable({
    employee_id: m.employeeId,
    name: `${m.lastName}, ${m.firstName}`,
    rank: m.rank,
    bid_category: m.bidCategory,
    rsc_seniority: m.rscSeniority,
    rank_seniority: m.rankSeniority,
    is_probationary: m.isProbationary,
    credentials: [...m.credentials].sort(),
    prior_year_bid: m.priorYearBid,
  });
}

function renderRow(r: EligibilityMatrixRow): string {
  return stable({
    employee_id: r.memberEmployeeId,
    position_id: r.positionId,
    eligible: r.eligible,
    points: r.points,
    so_points: r.soPoints,
    mo_points: r.moPoints,
    reasons: r.reasons,
  });
}

/**
 * Returns the roster + eligibility-matrix portion of the user prompt as
 * plain text. The Workers AI swap (2026-05) collapses the prior
 * cached-roster + uncached-turn pair into a single `user` message; this
 * function provides the roster half, and `turnBlock`/`userPrompt` adds the
 * per-turn context on top.
 */
export function rosterPrompt(input: RosterInput): string {
  const sortedMembers = [...input.members].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  const sortedMatrix = [...input.eligibilityMatrix].sort(
    (a, b) =>
      a.memberEmployeeId.localeCompare(b.memberEmployeeId) ||
      a.positionId.localeCompare(b.positionId),
  );

  return (
    `# Session ${input.bidSessionId} — roster + eligibility matrix\n\n` +
    `## Members (${sortedMembers.length})\n${sortedMembers.map(renderMember).join('\n')}` +
    `\n\n## Eligibility matrix rows (${sortedMatrix.length})\n${sortedMatrix.map(renderRow).join('\n')}`
  );
}

/** @deprecated Use `rosterPrompt()`. Kept for one release. */
export function rosterBlock(input: RosterInput): string {
  return rosterPrompt(input);
}
