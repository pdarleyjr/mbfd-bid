'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  type = 'text',
  help,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  multiline?: boolean;
  type?: 'text' | 'date';
  help?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={7}
          aria-describedby={help ? `${id}-help` : undefined}
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={help ? `${id}-help` : undefined}
        />
      )}
      {help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
}: { label: string; value: number; onChange(value: number): void; min?: number; max?: number }) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          if (e.target.value === '') return;
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}
export function NullableNumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  emptyLabel = 'No fixed limit',
}: {
  label: string;
  value: number | null;
  onChange(value: number | null): void;
  min?: number;
  max?: number;
  emptyLabel?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        placeholder={emptyLabel}
        onChange={(event) => {
          if (event.target.value === '') return onChange(null);
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      {value === null && <p className="text-xs text-muted-foreground">{emptyLabel}</p>}
    </div>
  );
}
export function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
export function CheckField({
  label,
  value,
  onChange,
}: { label: string; value: boolean; onChange(value: boolean): void }) {
  return (
    <Label className="flex min-h-11 items-center gap-3">
      <Input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </Label>
  );
}
export function FieldSection({
  title,
  description,
  children,
}: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <header>
        <h3 className="font-heading text-lg">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}
export function NullableText({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string | null;
  onChange(value: string | null): void;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-2">
      <CheckField
        label={`Include ${label.toLowerCase()}`}
        value={value !== null}
        onChange={(enabled) => onChange(enabled ? '' : null)}
      />
      {value !== null && (
        <TextField label={label} value={value} onChange={onChange} multiline={multiline} />
      )}
    </div>
  );
}
export type ReferenceOption = { value: string; label: string };
export function TextEntries({
  label,
  values,
  onChange,
  help,
}: { label: string; values: string[]; onChange(values: string[]): void; help?: string }) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">{label}</legend>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {values.map((value, index) => (
        <div key={`${label}-${index + 1}`} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={`${label} ${index + 1}`}
              value={value}
              onChange={(next) => onChange(values.map((entry, i) => (i === index ? next : entry)))}
            />
          </div>
          <Button type="button" onClick={() => onChange(values.filter((_, i) => i !== index))}>
            Remove entry {index + 1}
          </Button>
        </div>
      ))}
      <Button type="button" onClick={() => onChange([...values, ''])}>
        Add {label.toLowerCase()}
      </Button>
    </fieldset>
  );
}
/** Paging changes visibility only. Saved, off-page and missing references stay selected. */
export function ReferencePicker({
  label,
  values,
  options,
  onChange,
  help,
}: {
  label: string;
  values: string[];
  options: ReferenceOption[];
  onChange(values: string[]): void;
  help?: string;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const available = new Map(options.map((o) => [o.value, o]));
  const all = [
    ...available.values(),
    ...values
      .filter((v) => !available.has(v))
      .map((v) => ({ value: v, label: `${v} · Saved selection; catalog review required` })),
  ];
  const matching = all.filter((o) =>
    `${o.label} ${o.value}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matching.length / 20));
  const selectedPage = Math.min(page, pages - 1);
  return (
    <fieldset className="min-w-0 space-y-2 rounded border border-border p-3">
      <legend className="px-1 font-medium">{label}</legend>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      <TextField
        label={`Find ${label.toLowerCase()}`}
        value={search}
        onChange={(text) => {
          setSearch(text);
          setPage(0);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {values.length} selected · {matching.length} matching
      </p>
      {values.length > 0 && (
        <details>
          <summary className="min-h-11 content-center cursor-pointer text-sm">
            Review all selected ({values.length})
          </summary>
          <ul className="space-y-1 break-words text-sm">
            {values.map((v) => (
              <li key={v}>{all.find((o) => o.value === v)?.label ?? v}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="grid min-w-0 gap-x-4 sm:grid-cols-2">
        {matching.slice(selectedPage * 20, (selectedPage + 1) * 20).map((o) => (
          <CheckField
            key={o.value}
            label={o.label}
            value={values.includes(o.value)}
            onChange={(checked) =>
              onChange(checked ? [...values, o.value] : values.filter((v) => v !== o.value))
            }
          />
        ))}
      </div>
      {!matching.length && <p className="py-2 text-sm">No matching entries.</p>}
      {pages > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!selectedPage} onClick={() => setPage(selectedPage - 1)}>
            Previous choices
          </Button>
          <span className="text-sm">
            Page {selectedPage + 1} of {pages}
          </span>
          <Button
            type="button"
            disabled={selectedPage === pages - 1}
            onClick={() => setPage(selectedPage + 1)}
          >
            Next choices
          </Button>
        </div>
      )}
    </fieldset>
  );
}
export function OrderedChoices<T extends string>({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: T[];
  options: readonly { value: T; label: string }[];
  onChange(values: T[]): void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">{label}</legend>
      {values.map((value, index) => (
        <div key={`${index}:${value}`} className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <ChoiceField
              label={`${label} ${index + 1}`}
              value={value}
              options={options}
              onChange={(next) => onChange(values.map((v, i) => (i === index ? next : v)))}
            />
          </div>
          <Button
            type="button"
            disabled={index === 0}
            onClick={() => {
              const next = [...values];
              next.splice(index - 1, 0, ...next.splice(index, 1));
              onChange(next);
            }}
          >
            Move up
          </Button>
          <Button
            type="button"
            disabled={index === values.length - 1}
            onClick={() => {
              const next = [...values];
              next.splice(index + 1, 0, ...next.splice(index, 1));
              onChange(next);
            }}
          >
            Move down
          </Button>
          <Button type="button" onClick={() => onChange(values.filter((_, i) => i !== index))}>
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        disabled={values.length >= options.length}
        onClick={() => {
          const next = options.find((o) => !values.includes(o.value));
          if (next) onChange([...values, next.value]);
        }}
      >
        Add {label.toLowerCase()}
      </Button>
    </fieldset>
  );
}
export function useBidMembers() {
  return useQuery({
    queryKey: ['admin', 'current-bid', 'member-options'],
    staleTime: 30_000,
    queryFn: async () => {
      const members: {
        id: number;
        firstName: string;
        lastName: string;
        employeeId: string;
        rank: 'FF' | 'LT' | 'CPT' | 'DC' | 'DEP_CHIEF' | 'CHIEF';
        bidCategory: 'OFC' | 'FF' | 'EXCLUDED';
        employmentStatus: 'unknown' | 'active' | 'inactive' | 'retired' | 'separated';
        priorPositionId: string | null;
      }[] = [];
      let total = 1;
      while (members.length < total) {
        const response = await fetch(`/api/admin/members?limit=500&offset=${members.length}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Member catalog unavailable');
        const body = (await response.json()) as { members: typeof members; total: number };
        if (
          !Array.isArray(body.members) ||
          !Number.isSafeInteger(body.total) ||
          (!body.members.length && members.length < body.total)
        )
          throw new Error('Member catalog incomplete');
        members.push(...body.members);
        total = body.total;
      }
      return members.map((m) => ({
        value: String(m.id),
        label: `${m.lastName}, ${m.firstName} · ${m.employeeId}`,
        employeeId: m.employeeId,
        rank: m.rank,
        bidCategory: m.bidCategory,
        employmentStatus: m.employmentStatus,
        priorPositionId: m.priorPositionId,
      }));
    },
  });
}
