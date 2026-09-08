'use client';
import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { type AnnualPlan, annualGet, annualPost, expectedPlan } from './annual-plan-client';

export function AnnualPlanSuccessor({
  plan,
  onSaved,
  onDirty,
}: { plan: AnnualPlan; onSaved(): Promise<void>; onDirty(v: boolean): void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [effective, setEffective] = useState(plan.effectiveOn ?? '');
  const [cutoff, setCutoff] = useState(plan.settings?.credentialEvaluationOn ?? '');
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const revision = useRef(expectedPlan(plan));
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const history = useQuery({
    retry: false,
    queryKey: ['admin', 'annual-plan', plan.year, 'successors'],
    queryFn: () =>
      annualGet<{
        successors: {
          ruleBookVersion: string;
          createdAt: number;
          reason: string;
          predecessor: { configuration: { rule_book_version: string } };
        }[];
      }>(`annual-plan/${plan.year}/successors`),
  });
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const body = {
      ...revision.current,
      effective_on: effective,
      credential_evaluation_on: cutoff,
      turn_timer_seconds: plan.settings.turnTimerSeconds,
      expected_duration_days: plan.settings.expectedDurationDays,
      reason,
      accept_successor: accepted,
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      await annualPost(`annual-plan/${plan.year}/successor`, body, pending.current.key);
      onDirty(false);
      setOpen(false);
      setReason('');
      setAccepted(false);
      pending.current = null;
      await onSaved();
      setMessage(
        'Editable successor created. Continue through the preparation stages to review and practice it.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Successor could not be saved. Your entries are retained.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {plan.lifecycle === 'FROZEN' && (
        <Button
          type="button"
          onClick={() => {
            revision.current = expectedPlan(plan);
            setOpen(true);
          }}
        >
          Prepare changes to this approved setup
        </Button>
      )}
      {message && <output className="block rounded border border-border p-3">{message}</output>}
      <TaskPanel
        open={open}
        onClose={() => setOpen(false)}
        title={`Prepare changes for ${plan.year}`}
        description="Create a separate draft while preserving the previous approved rules, policy and evidence."
      >
        <form onSubmit={save} onChange={() => onDirty(true)} className="space-y-4">
          <p className="text-sm">
            Available before any real session is created. Copied positions and staffing links
            require review. The new setup must pass review and practice before approval. If a real
            session exists, use its authorized amendment controls.
          </p>
          <fieldset disabled={busy} className="space-y-4">
            <Label className="block">
              Personnel and staffing effective date
              <Input
                required
                type="date"
                min={`${plan.year}-01-01`}
                max={`${plan.year}-12-31`}
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              />
            </Label>
            <Label className="block">
              Credential evaluation date
              <Input
                required
                type="date"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
              />
            </Label>
            <Label className="block">
              Approved change or source and reason
              <Input
                required
                minLength={4}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Label>
            <Label className="flex items-start gap-3">
              <Input
                required
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              I am preparing an authorized change. I will review and practice this draft before
              approving it.
            </Label>
            <Button type="submit">{busy ? 'Creating draft…' : 'Create editable successor'}</Button>
          </fieldset>
          {message && <p role="alert">{message}</p>}
        </form>
      </TaskPanel>
      {!!history.data?.successors?.length && (
        <details className="rounded border border-border p-3">
          <summary className="cursor-pointer font-semibold">
            Previous approved setups and change history ({history.data.successors.length})
          </summary>
          <ul className="mt-3 max-h-60 space-y-3 overflow-y-auto">
            {history.data.successors.map((item) => (
              <li key={item.ruleBookVersion}>
                <p>
                  {new Date(item.createdAt).toLocaleString()} · {item.reason}
                </p>
                <p className="text-xs text-muted-foreground">
                  Preserved setup {item.predecessor.configuration.rule_book_version} → draft{' '}
                  {item.ruleBookVersion}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {history.isError && (
        <p role="alert">
          Change history is unavailable.{' '}
          <Button type="button" onClick={() => void history.refetch()}>
            Retry history
          </Button>
        </p>
      )}
    </div>
  );
}
