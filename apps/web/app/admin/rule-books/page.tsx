import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import type { Route } from 'next';
import Link from 'next/link';
import { formatET } from '../../../lib/et-time';
import { requireAdmin } from '../../../lib/require-admin';
import { serverWorkerFetch } from '../../../lib/server-worker-fetch';
import { RuleBookCreateForm } from './RuleBookCreateForm';

export const dynamic = 'force-dynamic';

interface RuleBook {
  version: string;
  effectiveYear: number;
  status: 'draft' | 'active' | 'archived';
  publishedAt: number | null;
}

const statusColors: Record<RuleBook['status'], string> = {
  draft: 'bg-warning text-primary-foreground',
  active: 'bg-success text-primary-foreground',
  archived: 'bg-muted text-foreground',
};

export default async function RuleBooksPage() {
  await requireAdmin();
  let rule_books: RuleBook[] = [];
  let fetchError: string | null = null;
  try {
    const res = await serverWorkerFetch('/api/admin/rule-books');
    if (!res.ok) {
      fetchError = `Worker returned ${res.status}`;
    } else {
      const body = (await res.json()) as { rule_books?: RuleBook[] };
      rule_books = body.rule_books ?? [];
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'fetch failed';
  }

  return (
    <div>
      <h1 className="font-heading text-2xl text-foreground">Rule Books</h1>
      <p className="mt-2 text-sm text-foreground">
        Each year has at most one active book. Drafts can be edited; archived books are immutable.
      </p>
      <RuleBookCreateForm ruleBooks={rule_books} />
      {fetchError && (
        <div className="mt-6 rounded-lg border border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          Could not load rule books: {fetchError}. The current list is unavailable; no policy state
          is inferred.
        </div>
      )}
      {!fetchError && rule_books.length === 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 text-sm text-foreground">
          No rule books yet. Create the first reviewed draft above.
        </div>
      )}
      <Table className="mt-6 w-full border border-border text-sm text-foreground">
        <TableHeader className="bg-card text-left text-foreground">
          <TableRow>
            <TableHead className="p-2">Version</TableHead>
            <TableHead className="p-2">Effective Year</TableHead>
            <TableHead className="p-2">Status</TableHead>
            <TableHead className="p-2">Published</TableHead>
            <TableHead className="p-2" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rule_books.map((rb) => (
            <TableRow key={rb.version} className="border-t border-border">
              <TableCell className="p-2 font-mono">{rb.version}</TableCell>
              <TableCell className="p-2 tabular-nums">{rb.effectiveYear}</TableCell>
              <TableCell className="p-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${statusColors[rb.status]}`}
                >
                  {rb.status}
                </span>
              </TableCell>
              <TableCell className="p-2 tabular-nums">
                {rb.publishedAt !== null ? formatET(new Date(rb.publishedAt), 'datetime') : '—'}
              </TableCell>
              <TableCell className="p-2">
                <Link
                  href={`/admin/rule-books/${rb.version}` as Route}
                  className="text-destructive underline"
                >
                  Open
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
