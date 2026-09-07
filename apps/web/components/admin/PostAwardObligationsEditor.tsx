'use client';
import { buttonClass, fieldClass } from '@/app/admin/annual-plan/annual-plan-client';
import { useCredentialCatalog } from '@/lib/use-credential-catalog';
import type { PostAwardObligation } from '@mbfd/shared';
export function PostAwardObligationsEditor({
  value,
  onChange,
}: { value: PostAwardObligation[]; onChange(value: PostAwardObligation[]): void }) {
  const catalog = useCredentialCatalog();
  const update = (id: string, patch: Partial<PostAwardObligation>) =>
    onChange(value.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <fieldset className="space-y-4 rounded border border-slate-600 p-4">
      <legend className="px-1 font-semibold">Post-award qualifications</legend>
      <p className="text-sm text-slate-300">
        These follow-up requirements do not affect initial eligibility or points. Choose whether the
        approved period starts at the final award or on an explicitly approved bid start date.
        Calendar-month deadlines use the last day of a shorter month. Cite the authority for the
        date, period and calendar zone.
      </p>
      {value.map((row) => (
        <div className="space-y-3 rounded border border-slate-700 p-3" key={row.id}>
          <label className="block">
            Qualification
            <select
              className={fieldClass}
              required
              value={row.credential}
              onChange={(e) => update(row.id, { credential: e.target.value })}
            >
              <option value="">Choose qualification</option>
              {row.credential &&
                !catalog.data?.some((c) => (c.policyName ?? c.name) === row.credential) && (
                  <option value={row.credential}>{row.credential} · Catalog review required</option>
                )}
              {catalog.data?.map((c) => (
                <option
                  key={c.id}
                  value={c.policyName ?? c.name}
                  disabled={!!c.retiredOn && row.credential !== (c.policyName ?? c.name)}
                >
                  {c.name}
                  {c.retiredOn ? ' · Retired' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Deadline starts from
            <select
              className={fieldClass}
              value={row.deadline.basis}
              onChange={(e) => {
                const period = {
                  unit: row.deadline.unit,
                  count: row.deadline.count,
                  timeZone: row.deadline.timeZone,
                };
                update(row.id, {
                  deadline:
                    e.target.value === 'APPROVED_BID_START_DATE'
                      ? { ...period, basis: 'APPROVED_BID_START_DATE', startOn: '' }
                      : { ...period, basis: 'FINAL_POSITION_AWARD' },
                });
              }}
            >
              <option value="FINAL_POSITION_AWARD">Final accepted position award</option>
              <option value="APPROVED_BID_START_DATE">Approved bid start date</option>
            </select>
          </label>
          {row.deadline.basis === 'APPROVED_BID_START_DATE' && (
            <label className="block">
              Approved bid start date
              <input
                type="date"
                required
                className={fieldClass}
                value={row.deadline.startOn}
                onChange={(e) => {
                  if (row.deadline.basis === 'APPROVED_BID_START_DATE')
                    update(row.id, { deadline: { ...row.deadline, startOn: e.target.value } });
                }}
              />
              <span className="mt-1 block text-sm text-slate-400">
                Use the date approved for this policy. Session creation, bidding day and assignment
                start are not interchangeable. An amended award keeps this frozen date.
              </span>
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              Period
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={1200}
                required
                value={row.deadline.count || ''}
                onChange={(e) =>
                  update(row.id, { deadline: { ...row.deadline, count: Number(e.target.value) } })
                }
              />
            </label>
            <label>
              Calendar unit
              <select
                className={fieldClass}
                value={row.deadline.unit}
                onChange={(e) =>
                  update(row.id, {
                    deadline: {
                      ...row.deadline,
                      unit: e.target.value as PostAwardObligation['deadline']['unit'],
                    },
                  })
                }
              >
                <option value="CALENDAR_DAYS">Calendar days</option>
                <option value="CALENDAR_MONTHS">Calendar months</option>
              </select>
            </label>
            <label>
              Calendar zone
              <select
                className={fieldClass}
                value={row.deadline.timeZone}
                onChange={(e) =>
                  update(row.id, {
                    deadline: {
                      ...row.deadline,
                      timeZone: e.target.value as PostAwardObligation['deadline']['timeZone'],
                    },
                  })
                }
              >
                <option value="America/New_York">Miami / New York</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
          </div>
          <label className="block">
            Approved obligation source
            <input
              className={fieldClass}
              required
              minLength={4}
              maxLength={500}
              value={row.sourceRef}
              onChange={(e) => update(row.id, { sourceRef: e.target.value })}
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            onClick={() => onChange(value.filter((o) => o.id !== row.id))}
          >
            Remove obligation
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass}
        disabled={value.length >= 50}
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              credential: '',
              sourceRef: '',
              deadline: {
                basis: 'FINAL_POSITION_AWARD',
                unit: 'CALENDAR_MONTHS',
                count: 0,
                timeZone: 'America/New_York',
              },
            },
          ])
        }
      >
        Add post-award qualification
      </button>
    </fieldset>
  );
}
