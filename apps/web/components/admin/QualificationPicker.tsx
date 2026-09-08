'use client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';

/** Checkboxes replace a modifier-key multi-select without removing saved or retired values. */
export function QualificationPicker({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: { value: string; label: string }[];
  onChange(values: string[]): void;
}) {
  const [search, setSearch] = useState('');
  const all = [
    ...options,
    ...values
      .filter((value) => !options.some((o) => o.value === value))
      .map((value) => ({ value, label: `${value} (saved requirement; review catalog)` })),
  ];
  const filtered = all.filter((o) =>
    o.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Which qualifications are mandatory?</legend>
      <p className="text-xs text-muted-foreground">
        Every checked qualification is required. Use alternatives below when one of several
        qualifications is sufficient.
      </p>
      <Label className="block text-sm">
        Find a qualification
        <Input value={search} onChange={(e) => setSearch(e.target.value)} />
      </Label>
      <output className="block text-xs text-muted-foreground">
        {values.length} selected · {filtered.length} matching qualifications
      </output>
      {!!values.length && (
        <details>
          <summary className="cursor-pointer text-sm">
            Review selected qualifications ({values.length})
          </summary>
          <ul className="max-h-40 overflow-y-auto text-sm">
            {values.map((v) => (
              <li key={v}>{all.find((o) => o.value === v)?.label ?? v}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="max-h-52 overflow-y-auto rounded border border-border p-2">
        {filtered.map((option) => (
          <Label key={option.value} className="flex min-h-11 items-center gap-3 text-sm">
            <Input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, option.value]
                    : values.filter((v) => v !== option.value),
                )
              }
            />
            {option.label}
          </Label>
        ))}
        {!filtered.length && (
          <p className="p-2 text-sm">
            No matching qualifications. Clear the search or add a definition in the qualification
            catalog.
          </p>
        )}
      </div>
    </fieldset>
  );
}
