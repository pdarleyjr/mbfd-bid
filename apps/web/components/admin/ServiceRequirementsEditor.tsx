'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useQuery } from '@tanstack/react-query';
export function ServiceRequirementsEditor({
  value,
  onChange,
}: {
  value: { serviceCode: string; minimumMonths: number }[];
  onChange(value: { serviceCode: string; minimumMonths: number }[]): void;
}) {
  const types = useQuery({
    queryKey: ['admin', 'service-evidence', 'types'],
    staleTime: 30_000,
    queryFn: async () => {
      const r = await fetch('/api/admin/service-evidence/types', { credentials: 'include' });
      if (!r.ok) throw new Error('Service categories unavailable');
      return (await r.json()) as { types: { id: string; name: string }[] };
    },
  });
  return (
    <fieldset className="space-y-3 rounded border border-border p-4">
      <legend className="px-1 font-semibold">Cumulative service requirements</legend>
      <p className="text-sm text-foreground">
        Only dated, source-supported service totals satisfy these requirements. Missing or unknown
        evidence blocks eligibility.
      </p>
      {types.isError && <p role="alert">Service categories could not be loaded.</p>}
      {value.map((entry, index) => (
        <div className="flex flex-wrap items-end gap-3" key={`${index}:${entry.serviceCode}`}>
          <Label className="min-w-48 flex-1">
            Service category
            <NativeSelect
              className="mt-1 min-h-11 w-full rounded border border-border bg-card px-3"
              value={entry.serviceCode}
              onChange={(e) =>
                onChange(
                  value.map((v, i) => (i === index ? { ...v, serviceCode: e.target.value } : v)),
                )
              }
            >
              <option value="">Choose category</option>
              {types.data?.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            Minimum completed months
            <Input
              type="number"
              min={1}
              max={1200}
              className="mt-1 block min-h-11 w-28 rounded border border-border bg-card px-3"
              value={entry.minimumMonths}
              onChange={(e) =>
                onChange(
                  value.map((v, i) =>
                    i === index ? { ...v, minimumMonths: Number(e.target.value) } : v,
                  ),
                )
              }
            />
          </Label>
          <Button
            type="button"
            className="min-h-11 rounded border border-border px-3"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove requirement
          </Button>
        </div>
      ))}
      <Button
        type="button"
        disabled={types.isPending || types.isError || value.length >= 30}
        className="min-h-11 rounded border border-border px-3 disabled:opacity-50"
        onClick={() => onChange([...value, { serviceCode: '', minimumMonths: 1 }])}
      >
        Add service requirement
      </Button>
    </fieldset>
  );
}
