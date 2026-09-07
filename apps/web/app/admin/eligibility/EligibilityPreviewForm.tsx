'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { type FormEvent, useState } from 'react';

interface EligibilityReason {
  code: string;
  label: string;
  satisfied: boolean;
}

interface PreviewResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  points: number;
}

export interface EligibilityMemberOption {
  id: number;
  firstName: string;
  lastName: string;
  rank: string;
}

export interface EligibilityPositionOption {
  id: string;
  positionName: string;
  station: string;
  unit: string;
  rankRequired: string;
}

interface Props {
  ruleBookVersion: string;
  positionTemplateVersion: string;
  members: readonly EligibilityMemberOption[];
  positions: readonly EligibilityPositionOption[];
}

export function EligibilityPreviewForm({
  ruleBookVersion,
  positionTemplateVersion,
  members,
  positions,
}: Props) {
  const [memberId, setMemberId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (memberId === '') {
      setError('Select a member from the configured roster.');
      setResult(null);
      return;
    }
    if (positionId === '') {
      setError('Select a position from the configured template.');
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        member_id: Number(memberId),
        position_id: positionId,
        rule_book_version: ruleBookVersion,
      };
      const res = await fetch('/api/admin/eligibility/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        setError(errBody.error ?? `Preview failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as PreviewResult);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <Label className="block">
          <span className="text-sm text-foreground">Member</span>
          <NativeSelect
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            data-testid="eligibility-member-id"
            className="mt-1 block w-full rounded bg-card px-3 py-2 text-foreground"
            required
          >
            <option value="">Select a member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.lastName}, {member.firstName} — {member.rank}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="block">
          <span className="text-sm text-foreground">Position</span>
          <NativeSelect
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            data-testid="eligibility-position-id"
            className="mt-1 block w-full rounded bg-card px-3 py-2 text-foreground"
            required
          >
            <option value="">Select a configured position</option>
            {positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.id} — {position.positionName} ({position.station} / {position.unit} /{' '}
                {position.rankRequired})
              </option>
            ))}
          </NativeSelect>
        </Label>
        <div className="rounded border border-border bg-card px-3 py-2 text-sm text-foreground">
          <span className="font-medium">Selected annual configuration</span>
          <span className="ml-2 text-muted-foreground">Rule book:</span>{' '}
          <output data-testid="eligibility-rule-book-version" className="font-mono text-foreground">
            {ruleBookVersion}
          </output>
          <span className="ml-3 text-muted-foreground">Position template:</span>{' '}
          <span className="font-mono text-foreground">{positionTemplateVersion}</span>
        </div>
        <Button
          type="submit"
          disabled={loading}
          className="rounded bg-destructive px-4 py-2 text-primary-foreground hover:bg-destructive disabled:opacity-50"
        >
          Evaluate
        </Button>
      </form>

      {error !== null && (
        <output aria-live="polite" className="mt-4 block text-sm text-destructive">
          {error}
        </output>
      )}

      {result !== null && (
        <div className="mt-6 rounded border border-border bg-card p-4">
          <p className="text-sm">
            <span className="text-muted-foreground">Eligible:</span>{' '}
            <span
              className={`font-semibold ${result.eligible ? 'text-success' : 'text-destructive'}`}
            >
              {result.eligible ? 'YES' : 'NO'}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Points: <span className="tabular-nums text-foreground">{result.points}</span>
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {result.reasons.map((r) => (
              <li key={r.code}>
                <span
                  className={`mr-2 inline-block rounded px-1.5 py-0.5 text-xs ${
                    r.satisfied
                      ? 'bg-success text-primary-foreground'
                      : 'bg-destructive text-primary-foreground'
                  }`}
                >
                  {r.code}
                </span>
                <span className="text-foreground">{r.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
