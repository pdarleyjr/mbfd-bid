'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { ConfiguredScoring } from '@mbfd/shared';
import { useQuery } from '@tanstack/react-query';

type Channel = 'total' | 'so' | 'mo';
type Group = ConfiguredScoring[Channel][number];
type Item = Group['items'][number];
const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'total', label: 'Total points' },
  { id: 'so', label: 'Special Operations points' },
  { id: 'mo', label: 'Marine Operations points' },
];
const inputClass =
  'mt-1 min-h-11 w-full rounded border border-border bg-card px-3 text-sm text-foreground';

export function ConfiguredScoringEditor({
  value,
  onChange,
  visibleChannels,
}: {
  value: ConfiguredScoring;
  onChange(value: ConfiguredScoring): void;
  visibleChannels?: Channel[];
}) {
  const credentials = useQuery({
    queryKey: ['admin', 'credentials'],
    staleTime: 30_000,
    queryFn: async () => {
      const entries: {
        id: number;
        name: string;
        policyName?: string;
        retiredOn?: string | null;
      }[] = [];
      let total = 1;
      while (entries.length < total) {
        const response = await fetch(`/api/admin/credentials?limit=500&offset=${entries.length}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Credential catalog unavailable');
        const body = (await response.json()) as { credentials: typeof entries; total: number };
        if (!body.credentials.length && entries.length < body.total)
          throw new Error('Credential catalog incomplete');
        entries.push(...body.credentials);
        total = body.total;
      }
      return entries;
    },
  });
  const updateGroup = (channel: Channel, index: number, update: Partial<Group>) =>
    onChange({
      ...value,
      [channel]: value[channel].map((group, i) => (i === index ? { ...group, ...update } : group)),
    });
  const updateItem = (
    channel: Channel,
    groupIndex: number,
    itemIndex: number,
    update: Partial<Item>,
  ) => {
    const group = value[channel][groupIndex];
    if (group)
      updateGroup(channel, groupIndex, {
        items: group.items.map((item, i) => (i === itemIndex ? { ...item, ...update } : item)),
      });
  };
  const options = credentials.data ?? [];
  const multi = (label: string, selected: string[], change: (tokens: string[]) => void) => (
    <Label className="block text-sm text-foreground">
      {label}
      <NativeSelect
        multiple
        value={selected}
        onChange={(e) => change(Array.from(e.target.selectedOptions, (o) => o.value))}
        className={`${inputClass} min-h-28 py-2`}
      >
        {selected
          .filter((token) => !options.some((c) => (c.policyName ?? c.name) === token))
          .map((token) => (
            <option key={token} value={token}>
              {token} · Catalog review required
            </option>
          ))}
        {options.map((c) => (
          <option key={c.id} value={c.policyName ?? c.name}>
            {c.name}
            {c.retiredOn ? ` · Retires ${c.retiredOn}` : ''}
          </option>
        ))}
      </NativeSelect>
    </Label>
  );
  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground">
        Each channel is explicit. An empty channel awards zero points. Alternatives are approved
        equivalents for this item only; prerequisites require every selected credential. Groups
        award points in displayed order up to their cap.
      </p>
      {credentials.isError && (
        <p role="alert" className="text-sm text-warning">
          {credentials.error.message}. Stored selections remain visible.
        </p>
      )}
      {CHANNELS.filter((c) => !visibleChannels || visibleChannels.includes(c.id)).map(
        ({ id: channel, label }) => (
          <fieldset key={channel} className="rounded border border-border p-4">
            <legend className="px-1 font-semibold text-foreground">{label}</legend>
            {value[channel].map((group, gi) => (
              <div key={group.id} className="mt-3 space-y-3 rounded border border-border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <p className="flex-1 text-sm text-foreground">Group {gi + 1}</p>
                  <Label className="text-sm text-foreground">
                    Group cap (blank means uncapped)
                    <Input
                      type="number"
                      min="0"
                      max="100000"
                      step="1"
                      value={group.cap ?? ''}
                      onChange={(e) =>
                        updateGroup(channel, gi, {
                          cap: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      className={inputClass}
                    />
                  </Label>
                  <Button
                    type="button"
                    className="min-h-11 rounded border border-border px-3 text-sm"
                    onClick={() =>
                      onChange({ ...value, [channel]: value[channel].filter((_, i) => i !== gi) })
                    }
                  >
                    Remove group
                  </Button>
                </div>
                {group.items.map((item, ii) => (
                  <div
                    key={`${group.id}-${ii}`}
                    className="grid gap-3 border-t border-border pt-3 md:grid-cols-2"
                  >
                    <Label className="text-sm text-foreground">
                      Credential
                      <NativeSelect
                        value={item.credential}
                        onChange={(e) =>
                          updateItem(channel, gi, ii, { credential: e.target.value })
                        }
                        className={inputClass}
                      >
                        <option value="">Select credential</option>
                        {item.credential &&
                          !options.some((c) => (c.policyName ?? c.name) === item.credential) && (
                            <option value={item.credential}>
                              {item.credential} · Catalog review required
                            </option>
                          )}
                        {options.map((c) => (
                          <option key={c.id} value={c.policyName ?? c.name}>
                            {c.name}
                            {c.retiredOn ? ` · Retires ${c.retiredOn}` : ''}
                          </option>
                        ))}
                      </NativeSelect>
                    </Label>
                    <Label className="text-sm text-foreground">
                      Points
                      <Input
                        type="number"
                        min="0"
                        max="10000"
                        step="1"
                        value={item.points}
                        onChange={(e) =>
                          updateItem(channel, gi, ii, { points: Number(e.target.value) })
                        }
                        className={inputClass}
                      />
                    </Label>
                    {multi(
                      'Reviewed alternatives (any one qualifies)',
                      item.alternatives,
                      (alternatives) => updateItem(channel, gi, ii, { alternatives }),
                    )}
                    {multi(
                      'Required before credit (all must be held)',
                      item.requiresAll,
                      (requiresAll) => updateItem(channel, gi, ii, { requiresAll }),
                    )}
                    <Button
                      type="button"
                      className="min-h-11 justify-self-start rounded border border-border px-3 text-sm"
                      onClick={() =>
                        updateGroup(channel, gi, { items: group.items.filter((_, i) => i !== ii) })
                      }
                    >
                      Remove item {ii + 1}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  className="min-h-11 rounded border border-border px-3 text-sm"
                  onClick={() =>
                    updateGroup(channel, gi, {
                      items: [
                        ...group.items,
                        { credential: '', alternatives: [], requiresAll: [], points: 0 },
                      ],
                    })
                  }
                >
                  Add scoring item
                </Button>
              </div>
            ))}
            <Button
              type="button"
              className="mt-3 min-h-11 rounded border border-border px-3 text-sm"
              onClick={() =>
                onChange({
                  ...value,
                  [channel]: [...value[channel], { id: crypto.randomUUID(), cap: null, items: [] }],
                })
              }
            >
              Add group for {label.toLowerCase()}
            </Button>
          </fieldset>
        ),
      )}
    </div>
  );
}
