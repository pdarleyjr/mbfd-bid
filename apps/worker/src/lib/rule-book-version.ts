/**
 * Rule-book version string parser.
 *
 * Format: "<year>.<n>" where year is a 4-digit year and n is a positive
 * integer. Returns null for any malformed input.
 */
export function parseVersion(s: string): { year: number; n: number } | null {
  const m = /^(\d{4})\.(\d+)$/.exec(s);
  if (m === null) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  if (!Number.isInteger(year) || !Number.isInteger(n) || n < 1) return null;
  return { year, n };
}

/**
 * Mints the next sequential version string for `year`, given the list of
 * existing version strings. Malformed strings are silently ignored.
 */
export function nextVersion(year: number, existing: readonly string[]): string {
  let maxN = 0;
  for (const v of existing) {
    const parsed = parseVersion(v);
    if (parsed !== null && parsed.year === year && parsed.n > maxN) {
      maxN = parsed.n;
    }
  }
  return `${year}.${maxN + 1}`;
}
