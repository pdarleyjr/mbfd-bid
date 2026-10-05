import type { ScoreReferenceEvidence, ScoreReferencePriority } from './types.js';

/** One exact opportunity, or a specialty's complete opportunity scope. A
 * partial/mixed specialty reference cannot redefine another seat's ranking. */
export function scoreReferenceForPositions(
  references: readonly ScoreReferenceEvidence[] | undefined,
  positionIds: readonly string[],
): ScoreReferenceEvidence | null {
  const matches = positionIds.map((positionId) =>
    (references ?? []).filter((reference) => reference.positionIds.includes(positionId)),
  );
  if (matches.some((rows) => rows.length > 1)) throw new Error('SCORE_REFERENCE_SCOPE_AMBIGUOUS');
  if (matches.every((rows) => rows.length === 0)) return null;
  if (matches.some((rows) => rows.length === 0))
    throw new Error('SCORE_REFERENCE_SCOPE_INCOMPLETE');
  const first = matches[0]?.[0];
  if (!first) return null;
  if (
    matches.some((rows) => {
      const row = rows[0];
      return (
        !row ||
        row.listId !== first.listId ||
        row.sourceSha256 !== first.sourceSha256 ||
        row.points !== first.points ||
        row.soPoints !== first.soPoints ||
        row.moPoints !== first.moPoints ||
        row.sourcePriority !== first.sourcePriority
      );
    })
  )
    throw new Error('SCORE_REFERENCE_SCOPE_INCONSISTENT');
  return first;
}

export function referencePriority(reference: ScoreReferenceEvidence): ScoreReferencePriority {
  return {
    listId: reference.listId,
    sourceSha256: reference.sourceSha256,
    priority: reference.sourcePriority,
  };
}

/** Only one source-ranked cohort can override its own frozen comparator. */
export function compareScoreReferencePriorities(
  left: ScoreReferencePriority | undefined,
  right: ScoreReferencePriority | undefined,
): number | null {
  if (!left || !right) return null;
  if (left.listId !== right.listId || left.sourceSha256 !== right.sourceSha256)
    throw new Error('SCORE_REFERENCE_COHORT_MISMATCH');
  if (left.priority === right.priority) throw new Error('SCORE_REFERENCE_PRIORITY_AMBIGUOUS');
  return left.priority - right.priority;
}
