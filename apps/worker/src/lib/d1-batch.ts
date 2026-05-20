/**
 * D1 has a hard cap on bound parameters per SQL statement (~100 placeholders
 * in the version we target). A `WHERE col IN (?, ?, …)` clause expands to one
 * placeholder per id, so a 226-member roster lookup or a session-wide bid
 * sweep will blow the limit and produce 500s like:
 *
 *   Failed query: select … where "member_credentials"."member_id"
 *                 in (?, ?, ?, ?, ?, …)  (250+ params)
 *
 * These helpers split a large id list into safely-sized chunks and run the
 * caller's query function once per chunk, concatenating SELECT results or
 * sequencing UPDATE / DELETE statements.
 *
 * Default chunk size is 90 — comfortably under the limit while still
 * keeping round-trip overhead low.
 */

const DEFAULT_CHUNK_SIZE = 90;

/**
 * Runs `fetchBatch` once per chunk of `ids` and concatenates the rows.
 * Returns `[]` when `ids` is empty without ever calling `fetchBatch`.
 */
export async function chunkedInArraySelect<TId extends number | string, TRow>(
  ids: ReadonlyArray<TId>,
  fetchBatch: (chunk: TId[]) => Promise<TRow[]>,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<TRow[]> {
  if (ids.length === 0) return [];
  const out: TRow[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize) as TId[];
    const batch = await fetchBatch(chunk);
    out.push(...batch);
  }
  return out;
}

/**
 * Runs `mutateBatch` once per chunk of `ids`. For UPDATE / DELETE where
 * there's nothing to concatenate. Returns the total chunk count for callers
 * that want to report on it.
 */
export async function chunkedInArrayMutate<TId extends number | string>(
  ids: ReadonlyArray<TId>,
  mutateBatch: (chunk: TId[]) => Promise<unknown>,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<number> {
  if (ids.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize) as TId[];
    await mutateBatch(chunk);
    count += 1;
  }
  return count;
}
