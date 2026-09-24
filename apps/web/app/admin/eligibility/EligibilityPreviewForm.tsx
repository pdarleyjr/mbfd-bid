'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { type FormEvent, useMemo, useState } from 'react';

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

interface ListDecision {
  member: EligibilityMemberOption & { employeeId: string };
  result: PreviewResult;
  priority: number | null;
  dataBlockers: string[];
}

interface PositionListResult {
  asOf: string;
  eligible: ListDecision[];
  excluded: ListDecision[];
  dataBlocked: ListDecision[];
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
  const [listResult, setListResult] = useState<PositionListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [listSearch, setListSearch] = useState('');
  const [listCategory, setListCategory] = useState<'all' | 'eligible' | 'excluded' | 'blocked'>(
    'all',
  );
  const [listSort, setListSort] = useState<'priority' | 'name' | 'points'>('priority');

  const visibleLists = useMemo(() => {
    if (listResult === null) return null;
    const search = listSearch.trim().toLocaleLowerCase('en-US');
    const filter = (decisions: ListDecision[], category: Exclude<typeof listCategory, 'all'>) =>
      decisions
        .filter(
          (decision) =>
            (listCategory === 'all' || listCategory === category) &&
            (!search ||
              `${decision.member.firstName} ${decision.member.lastName} ${decision.member.employeeId} ${decision.member.rank}`
                .toLocaleLowerCase('en-US')
                .includes(search)),
        )
        .sort((left, right) => {
          if (listSort === 'name')
            return `${left.member.lastName}\u0000${left.member.firstName}`.localeCompare(
              `${right.member.lastName}\u0000${right.member.firstName}`,
            );
          if (listSort === 'points') return right.result.points - left.result.points;
          return (
            (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
          );
        });
    return {
      eligible: filter(listResult.eligible, 'eligible'),
      excluded: filter(listResult.excluded, 'excluded'),
      blocked: filter(listResult.dataBlocked, 'blocked'),
    };
  }, [listCategory, listResult, listSearch, listSort]);

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
    setListResult(null);
    try {
      const body: Record<string, unknown> = {
        member_id: Number(memberId),
        position_id: positionId,
        rule_book_version: ruleBookVersion,
        as_of: asOf,
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

  async function evaluatePositionList() {
    if (positionId === '') {
      setError('Select a position from the configured template.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setListResult(null);
    try {
      const query = new URLSearchParams({
        position_id: positionId,
        rule_book_version: ruleBookVersion,
        as_of: asOf,
        bid_year: '2026',
      });
      const response = await fetch(`/api/admin/eligibility/list?${query}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Position list failed (${response.status})`);
        return;
      }
      setListResult((await response.json()) as PositionListResult);
    } finally {
      setLoading(false);
    }
  }

  const exportHref = (format: 'xlsx' | 'pdf', scope: 'single' | 'all') => {
    const query = new URLSearchParams({
      format,
      scope,
      rule_book_version: ruleBookVersion,
      as_of: asOf,
      bid_year: '2026',
    });
    if (scope === 'single' && positionId !== '') query.set('position_id', positionId);
    return `/api/admin/eligibility/export?${query}`;
  };

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
        <Label className="block max-w-xs">
          <span className="text-sm text-foreground">Evaluate credentials and seniority as of</span>
          <input
            type="date"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
            data-testid="eligibility-as-of"
            className="mt-1 block w-full rounded border border-border bg-card px-3 py-2 text-foreground"
            required
          />
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
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            disabled={loading}
            className="rounded bg-destructive px-4 py-2 text-primary-foreground hover:bg-destructive disabled:opacity-50"
          >
            Evaluate one member
          </Button>
          <Button
            type="button"
            disabled={loading}
            variant="secondary"
            onClick={evaluatePositionList}
          >
            Build official position list
          </Button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <a
          className="rounded border border-border px-3 py-2 underline"
          href={exportHref('xlsx', 'single')}
          aria-disabled={positionId === ''}
        >
          This position — Excel
        </a>
        <a
          className="rounded border border-border px-3 py-2 underline"
          href={exportHref('pdf', 'single')}
          aria-disabled={positionId === ''}
        >
          This position — PDF
        </a>
        <a
          className="rounded border border-border px-3 py-2 underline"
          href={exportHref('xlsx', 'all')}
        >
          All positions — Excel
        </a>
        <a
          className="rounded border border-border px-3 py-2 underline"
          href={exportHref('pdf', 'all')}
        >
          All positions — PDF
        </a>
      </div>

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

      {listResult !== null && (
        <div className="mt-6 space-y-5" data-testid="eligibility-position-list">
          <p className="rounded border border-border bg-card p-3 text-sm text-foreground">
            Official ordered list as of <span className="font-mono">{listResult.asOf}</span>.
            Members with failed requirements or unresolved data are not included in this official
            list.
          </p>
          <div className="grid gap-3 rounded border border-border bg-card p-4 sm:grid-cols-3">
            <Label>
              Search people
              <input
                type="search"
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder="Name, employee ID, or rank"
                className="mt-1 min-h-11 w-full rounded border border-border bg-background px-3"
              />
            </Label>
            <Label>
              Show
              <NativeSelect
                value={listCategory}
                onChange={(event) => setListCategory(event.target.value as typeof listCategory)}
                className="mt-1 min-h-11 w-full"
              >
                <option value="all">All outcomes</option>
                <option value="eligible">Eligible</option>
                <option value="excluded">Failed requirements</option>
                <option value="blocked">Needs data review</option>
              </NativeSelect>
            </Label>
            <Label>
              Sort by
              <NativeSelect
                value={listSort}
                onChange={(event) => setListSort(event.target.value as typeof listSort)}
                className="mt-1 min-h-11 w-full"
              >
                <option value="priority">Bid priority</option>
                <option value="name">Name</option>
                <option value="points">Points</option>
              </NativeSelect>
            </Label>
          </div>
          {(
            [
              ['Eligible and ordered', visibleLists?.eligible ?? [], 'text-success'],
              ['Excluded — failed requirements', visibleLists?.excluded ?? [], 'text-destructive'],
              ['Data blocked — review required', visibleLists?.blocked ?? [], 'text-warning'],
            ] as const
          ).map(([heading, decisions, tone]) => (
            <section
              key={heading}
              className="overflow-x-auto rounded border border-border bg-card p-4"
            >
              <h2 className={`font-heading text-lg ${tone}`}>
                {heading} ({decisions.length})
              </h2>
              <table className="mt-3 min-w-full text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="pr-4">Priority</th>
                    <th className="pr-4">Member</th>
                    <th className="pr-4">Employee ID</th>
                    <th className="pr-4">Rank</th>
                    <th className="pr-4">Points</th>
                    <th>Explanation</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((decision) => (
                    <tr
                      key={decision.member.employeeId}
                      className="border-t border-border align-top"
                    >
                      <td className="py-2 pr-4 tabular-nums">{decision.priority ?? '—'}</td>
                      <td className="py-2 pr-4">
                        {decision.member.lastName}, {decision.member.firstName}
                      </td>
                      <td className="py-2 pr-4 font-mono">{decision.member.employeeId}</td>
                      <td className="py-2 pr-4">{decision.member.rank}</td>
                      <td className="py-2 pr-4 tabular-nums">{decision.result.points}</td>
                      <td className="py-2">
                        {[
                          ...decision.result.reasons
                            .filter((reason) => !reason.satisfied)
                            .map((reason) => reason.label),
                          ...decision.dataBlockers,
                        ].join(' · ') || 'All required criteria passed'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
