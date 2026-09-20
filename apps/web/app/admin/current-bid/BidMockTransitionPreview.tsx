'use client';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { z } from 'zod';

const Preview = z.object({
  sessionId: z.string(),
  mode: z.literal('MOCK'),
  canApply: z.literal(false),
  status: z.literal('REHEARSAL_PROJECTION_ONLY'),
  completion: z.object({ revision: z.number().int() }),
  projectedAssignments: z.array(
    z.object({
      memberId: z.number().int(),
      shift: z.string().nullable(),
      station: z.string().nullable(),
      unit: z.string().nullable(),
      position: z.string().nullable(),
      aDay: z.string().nullable(),
    }),
  ),
  finalization: z.object({ complete: z.boolean(), blockers: z.array(z.string()) }),
  applicationBlockers: z.array(z.string()),
});

export function BidMockTransitionPreview({ sessionId }: { sessionId: string }) {
  const [value, setValue] = useState<z.infer<typeof Preview> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError('');
    setValue(null);
    try {
      const response = await fetch(
        `/api/admin/result-distribution/${encodeURIComponent(sessionId)}/rehearsal-transition-preview`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(body);
        throw new Error(
          parsed.success ? parsed.data.error.replaceAll('_', ' ') : 'Rehearsal preview unavailable',
        );
      }
      const parsed = Preview.parse(body);
      if (parsed.sessionId !== sessionId) throw new Error('Preview does not match selected Mock');
      setValue(parsed);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rehearsal preview unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Mock assignment projection" className="space-y-3 rounded border p-3">
      <h3 className="font-semibold">Rehearsal Department assignment projection</h3>
      <p>
        Mock results cannot be applied to Department. This read-only projection requires verified
        canonical Mock completion and does not schedule assignments.
      </p>
      <Button type="button" disabled={busy} onClick={() => void load()}>
        Preview rehearsal assignments
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {value ? (
        <>
          <output>
            {value.projectedAssignments.length} projected assignments · Completion revision{' '}
            {value.completion.revision} ·{' '}
            {value.finalization.complete
              ? 'Annual award coverage verified'
              : 'Annual award coverage requires review'}
          </output>
          {value.finalization.blockers.length ? (
            <ul>
              {value.finalization.blockers.map((code) => (
                <li key={code}>{code.replaceAll('_', ' ').toLowerCase()}</li>
              ))}
            </ul>
          ) : null}
          <ul className="space-y-2">
            {value.projectedAssignments.map((assignment) => (
              <li key={assignment.memberId}>
                Member {assignment.memberId}:{' '}
                {[
                  assignment.shift,
                  assignment.station,
                  assignment.unit,
                  assignment.position,
                  assignment.aDay,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            ))}
          </ul>
          <p>
            Official assignment transition remains blocked for this Mock run. A completed Live Bid
            and a separate reviewed Department transition are required.
          </p>
        </>
      ) : null}
    </section>
  );
}
