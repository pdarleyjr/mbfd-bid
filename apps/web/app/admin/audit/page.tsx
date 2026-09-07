import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { formatET } from '../../../lib/et-time';
import { requireAdmin } from '../../../lib/require-admin';
import { serverWorkerFetch } from '../../../lib/server-worker-fetch';

export const dynamic = 'force-dynamic';

interface AuditEntry {
  id: string;
  seq: number;
  bidSessionId: string | null;
  actorType: 'member' | 'admin' | 'system' | 'ai';
  actorId: number | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  reason: string | null;
  aiAdvisoryId: string | null;
  createdAt: number;
}

const AUDIT_ACTIONS = [
  'pick',
  'forced_pick',
  'pause',
  'resume',
  'skip',
  'override_rule',
  'override_cert',
  'lock_position',
  'unlock_position',
  'grant_extension',
  'admin_bid_for_member',
  'session_start',
  'session_complete',
  'members_import',
  'credentials_import',
  'positions_clone',
  'rule_book_clone',
  'dissent',
] as const;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;

  const qs = new URLSearchParams();
  qs.set('limit', '100');
  if (sp.action !== undefined && sp.action !== '') qs.set('action', sp.action);
  if (sp.from !== undefined && sp.from !== '') qs.set('from', sp.from);
  if (sp.to !== undefined && sp.to !== '') qs.set('to', sp.to);

  let entries: AuditEntry[] = [];
  let total = 0;
  let fetchError: string | null = null;
  try {
    const res = await serverWorkerFetch(`/api/admin/audit?${qs.toString()}`);
    if (!res.ok) {
      fetchError = `Worker returned ${res.status}`;
    } else {
      const body = (await res.json()) as { entries?: AuditEntry[]; total?: number };
      entries = body.entries ?? [];
      total = body.total ?? 0;
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'fetch failed';
  }

  const exportQs = new URLSearchParams(qs);
  exportQs.set('format', 'csv');
  exportQs.delete('limit');

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl text-foreground">Audit Log</h1>
        <a
          href={`/api/admin/audit/export?${exportQs.toString()}`}
          className="rounded border border-border px-3 py-1 text-sm text-foreground hover:border-border"
        >
          Export CSV
        </a>
      </div>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        <Label className="block">
          <span className="block text-xs text-muted-foreground">Action</span>
          <NativeSelect
            name="action"
            defaultValue={sp.action ?? ''}
            className="mt-1 rounded bg-card px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">All</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="block">
          <span className="block text-xs text-muted-foreground">From (ISO)</span>
          <Input
            type="datetime-local"
            name="from"
            defaultValue={sp.from ?? ''}
            className="mt-1 rounded bg-card px-3 py-1.5 text-sm text-foreground"
          />
        </Label>
        <Label className="block">
          <span className="block text-xs text-muted-foreground">To (ISO)</span>
          <Input
            type="datetime-local"
            name="to"
            defaultValue={sp.to ?? ''}
            className="mt-1 rounded bg-card px-3 py-1.5 text-sm text-foreground"
          />
        </Label>
        <Button
          type="submit"
          className="rounded bg-destructive px-3 py-1.5 text-sm text-primary-foreground hover:bg-destructive"
        >
          Filter
        </Button>
      </form>

      {fetchError && (
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          Could not load audit log: {fetchError}.{' '}
          <span className="text-warning">
            Check the Worker logs and JWT validity. The page is rendering with an empty list.
          </span>
        </div>
      )}
      {!fetchError && entries.length === 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-foreground">
          No audit entries match the current filter.
        </div>
      )}
      <p className="mt-4 text-sm text-muted-foreground">
        Showing {entries.length} of {total} matches.
      </p>

      <Table className="mt-4 w-full border border-border text-xs text-foreground">
        <TableHeader className="bg-card text-left text-foreground">
          <TableRow>
            <TableHead className="p-2">When (ET)</TableHead>
            <TableHead className="p-2">Seq</TableHead>
            <TableHead className="p-2">Actor</TableHead>
            <TableHead className="p-2">Action</TableHead>
            <TableHead className="p-2">Target</TableHead>
            <TableHead className="p-2">Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id} className="border-t border-border">
              <TableCell className="p-2 tabular-nums">
                {formatET(new Date(e.createdAt), 'datetime')}
              </TableCell>
              <TableCell className="p-2 tabular-nums">{e.seq}</TableCell>
              <TableCell className="p-2">
                {e.actorType}
                {e.actorId !== null ? ` #${e.actorId}` : ''}
              </TableCell>
              <TableCell className="p-2 font-mono">{e.action}</TableCell>
              <TableCell className="p-2">
                {e.targetKind !== null ? `${e.targetKind}:${e.targetId ?? ''}` : '—'}
              </TableCell>
              <TableCell className="p-2">{e.reason ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
