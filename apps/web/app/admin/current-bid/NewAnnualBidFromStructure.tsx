'use client';

import { annualPost } from '@/app/admin/annual-plan/annual-plan-client';
import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BidConfigurationSettings, BidDefinitionContent } from '@mbfd/shared';
import { useRef, useState } from 'react';
import type { BidVersion } from './bid-client';

type Result = {
  targetYear: number;
  notice: string;
  reviewItems: string[];
};

function defaults(settings: BidConfigurationSettings | null) {
  return {
    expectedDurationDays: settings?.expectedDurationDays ?? '',
    turnTimerSeconds: settings?.turnTimerSeconds ?? '',
  };
}

/**
 * The future-cycle path intentionally takes only an immutable saved version.
 * Unsaved browser edits, current people, credentials, authority grants, and
 * runtime state can therefore never leak into the next annual configuration.
 */
export function NewAnnualBidFromStructure({
  sourceYear,
  sourceVersion,
  content,
  disabled,
  onCreated,
}: {
  sourceYear: number;
  sourceVersion: BidVersion | null;
  content: BidDefinitionContent | null;
  disabled: boolean;
  onCreated(targetYear: number): void;
}) {
  const [open, setOpen] = useState(false);
  const [targetYear, setTargetYear] = useState(String(sourceYear + 1));
  const [effectiveOn, setEffectiveOn] = useState('');
  const [credentialEvaluationOn, setCredentialEvaluationOn] = useState('');
  const initial = defaults(content?.settings ?? null);
  const [expectedDurationDays, setExpectedDurationDays] = useState(
    String(initial.expectedDurationDays),
  );
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(String(initial.turnTimerSeconds));
  const [reason, setReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const canStart = sourceVersion !== null && !disabled;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceVersion || busy) return;
    const body = {
      source_year: sourceYear,
      source_version_id: sourceVersion.id,
      source_version_sha256: sourceVersion.contentSha256,
      target_year: Number(targetYear),
      effective_on: effectiveOn,
      credential_evaluation_on: credentialEvaluationOn,
      expected_duration_days: Number(expectedDurationDays),
      turn_timer_seconds: Number(turnTimerSeconds),
      reason,
      accept_carry_forward: accepted,
    };
    const fingerprint = JSON.stringify(body);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    setBusy(true);
    setMessage('');
    try {
      const result = await annualPost<Result>(
        'annual-plan/from-bid-definition',
        body,
        pending.current.key,
      );
      setMessage(`${result.notice} Review required: ${result.reviewItems.join('; ')}.`);
      pending.current = null;
      setOpen(false);
      onCreated(result.targetYear);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'New annual Bid could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button type="button" disabled={!canStart} onClick={() => setOpen(true)}>
        New Annual Bid
      </Button>
      {!sourceVersion && (
        <p className="mt-2 text-xs text-muted-foreground">
          Save this Bid before using it as a future-year structure.
        </p>
      )}
      {message && <output className="mt-2 block text-sm">{message}</output>}
      <TaskPanel
        open={open}
        onClose={() => setOpen(false)}
        title="Start a new annual Bid from saved structure"
        description="Creates a separate, non-executable draft from this immutable saved version. It retains reusable opportunity, rule, profile, stage, specialty, A-Day, contact, and fallback structure only."
      >
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            It does not copy participants, explicit inclusions or exclusions, credentials, operator
            permissions, source approvals, current occupants, active sessions, or prior annual
            dates. Every copied item is marked for new annual review.
          </p>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
            <Label className="block">
              New Bid year
              <Input
                required
                type="number"
                min={sourceYear + 1}
                max={2100}
                value={targetYear}
                onChange={(event) => setTargetYear(event.target.value)}
              />
            </Label>
            <Label className="block">
              Personnel and staffing evaluation date
              <Input
                required
                type="date"
                value={effectiveOn}
                onChange={(event) => setEffectiveOn(event.target.value)}
              />
            </Label>
            <Label className="block">
              Credential evaluation date
              <Input
                required
                type="date"
                value={credentialEvaluationOn}
                onChange={(event) => setCredentialEvaluationOn(event.target.value)}
              />
            </Label>
            <Label className="block">
              Expected duration (days)
              <Input
                required
                type="number"
                min={1}
                max={7}
                value={expectedDurationDays}
                onChange={(event) => setExpectedDurationDays(event.target.value)}
              />
            </Label>
            <Label className="block">
              Informational turn timer (seconds)
              <Input
                required
                type="number"
                min={30}
                max={600}
                value={turnTimerSeconds}
                onChange={(event) => setTurnTimerSeconds(event.target.value)}
              />
            </Label>
            <Label className="block sm:col-span-2">
              Carry-forward reason or authorization
              <Input
                required
                minLength={4}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Label>
            <Label className="flex items-start gap-3 sm:col-span-2">
              <Input
                required
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              I will complete the new annual review, participant preview, credential reconciliation,
              authority grants, Mock readiness, and approval before considering any Live session.
            </Label>
          </fieldset>
          <Button type="submit" disabled={!accepted || !sourceVersion || busy}>
            {busy ? 'Creating annual draft…' : 'Create non-executable annual draft'}
          </Button>
        </form>
      </TaskPanel>
    </div>
  );
}
