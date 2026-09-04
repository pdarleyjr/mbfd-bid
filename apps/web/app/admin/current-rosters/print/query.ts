const PRINT_ROSTER_FILTERS = ['shift', 'station', 'division', 'unit', 'rank'] as const;

export function buildCurrentRosterPrintQuery(
  input: Record<string, string | undefined>,
): URLSearchParams {
  const query = new URLSearchParams();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.as_of ?? '')) query.set('as_of', input.as_of as string);
  for (const key of PRINT_ROSTER_FILTERS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) query.set(key, value);
  }
  return query;
}
