'use client';
import { useQuery } from '@tanstack/react-query';
export function QualificationAlternativesEditor({
  value,
  onChange,
}: { value: string[][]; onChange(groups: string[][]): void }) {
  const catalog = useQuery({
    queryKey: ['admin', 'credentials'],
    staleTime: 30_000,
    queryFn: async () => {
      const rows: { id: number; name: string; policyName?: string; retiredOn?: string | null }[] =
        [];
      let total = 1;
      while (rows.length < total) {
        const response = await fetch(`/api/admin/credentials?limit=500&offset=${rows.length}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Qualification catalog unavailable');
        const result = (await response.json()) as { credentials: typeof rows; total: number };
        if (!result.credentials.length && rows.length < result.total)
          throw new Error('Qualification catalog incomplete');
        rows.push(...result.credentials);
        total = result.total;
      }
      return rows;
    },
  });
  return (
    <fieldset className="space-y-3 rounded border border-slate-600 p-4">
      <legend className="px-1 font-semibold">Qualification alternatives</legend>
      <p className="text-sm text-slate-300">
        Each group is required. Holding one selected qualification within a group satisfies that
        group.
      </p>
      {catalog.isError && (
        <p role="alert" className="text-amber-200">
          The qualification catalog could not be refreshed. Existing selections are retained.
        </p>
      )}
      {value.map((group, index) => (
        <div className="flex items-end gap-2" key={JSON.stringify([index, group])}>
          <label className="min-w-0 flex-1">
            Required group {index + 1}
            <select
              multiple
              className="mt-1 min-h-28 w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2 text-white"
              value={group}
              onChange={(e) =>
                onChange(
                  value.map((g, i) =>
                    i === index ? Array.from(e.target.selectedOptions, (o) => o.value) : g,
                  ),
                )
              }
            >
              {catalog.data?.map((c) => (
                <option
                  disabled={!!c.retiredOn && !group.includes(c.policyName ?? c.name)}
                  key={c.id}
                  value={c.policyName ?? c.name}
                >
                  {c.name}
                  {c.retiredOn ? ' · Retired' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="min-h-11 rounded border border-slate-600 px-3"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove group
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={catalog.isPending || catalog.isError || value.length >= 50}
        className="min-h-11 rounded border border-slate-600 px-3 disabled:opacity-50"
        onClick={() => onChange([...value, []])}
      >
        Add qualification group
      </button>
    </fieldset>
  );
}
