'use client';
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
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { annualPost, buttonClass, fieldClass } from '../../annual-plan/annual-plan-client';
type Preview = {
  previewKey: string;
  sourceHash: string;
  sourceRevision: number;
  ready: boolean;
  rows: {
    name: string;
    fyPointsDefault: number;
    previousPoints: number | null;
    operation: string;
  }[];
  errors: { rowNumber: number; message: string }[];
};
export function CredentialImportWorkspace() {
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState('normalized');
  const [metadata, setMetadata] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [committed, setCommitted] = useState(false);
  const previewKey = useRef<string | null>(null);
  const commitRequest = useRef<{ fingerprint: string; key: string } | null>(null);
  useUnsavedChanges(!committed && !!(file || source || reason), 'catalog import review');
  function resetPreview() {
    setPreview(null);
    setAccepted(false);
    setCommitted(false);
    previewKey.current = null;
    commitRequest.current = null;
  }
  async function inspect(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setMessage('');
    setAccepted(false);
    setCommitted(false);
    if (preview || !previewKey.current) previewKey.current = crypto.randomUUID();
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);
    form.append('metadata_columns', mode === 'legacy_wide_matrix' ? metadata : '0');
    try {
      const response = await createCsrfAwareFetch(fetch, () => window.location.origin)(
        '/api/admin/credential-imports/preview',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Idempotency-Key': previewKey.current },
          body: form,
        },
      );
      const result = (await response.json()) as Preview & { error?: string };
      if (!response.ok) throw new Error((result.error ?? 'Preview failed').replaceAll('_', ' '));
      setPreview(result);
      commitRequest.current = null;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preview could not be loaded');
    } finally {
      setBusy(false);
    }
  }
  async function commit(event: React.FormEvent) {
    event.preventDefault();
    if (!preview?.ready || !accepted) return;
    setBusy(true);
    setMessage('');
    const body = {
      preview_key: preview.previewKey,
      expected_source_revision: preview.sourceRevision,
      accept: true,
      source_ref: source,
      reason,
    };
    const fingerprint = JSON.stringify(body);
    if (commitRequest.current?.fingerprint !== fingerprint)
      commitRequest.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const result = await annualPost<{ inserted: number; updated: number; unchanged: number }>(
        'credential-imports/commit',
        body,
        commitRequest.current.key,
      );
      setCommitted(true);
      setMessage(
        `Catalog import recorded: ${result.inserted} created, ${result.updated} updated, ${result.unchanged} unchanged.`,
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['admin', 'credentials'] }),
        client.invalidateQueries({ queryKey: ['admin', 'annual-plan'] }),
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Import response unavailable. Your review and retry key are retained.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-6xl space-y-5 text-foreground">
      <header>
        <h1 className="font-heading text-3xl">Import Qualification Catalog</h1>
        <p className="mt-2 text-sm text-foreground">
          Review catalog labels and informational default points before applying an XLSX file. This
          flow does not grant qualifications to members or replace configured annual scoring.
        </p>
      </header>
      <form onSubmit={inspect}>
        <fieldset disabled={busy} className="space-y-4">
          <Label className="block">
            Catalog XLSX
            <Input
              required
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className={fieldClass}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                resetPreview();
              }}
            />
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Label>
              Import layout
              <NativeSelect
                className={fieldClass}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  resetPreview();
                }}
              >
                <option value="normalized">One qualification per row</option>
                <option value="legacy_wide_matrix">Legacy qualifications as columns</option>
              </NativeSelect>
            </Label>
            {mode === 'legacy_wide_matrix' && (
              <Label>
                Leading metadata columns
                <Input
                  required
                  type="number"
                  min={0}
                  max={100}
                  className={fieldClass}
                  value={metadata}
                  onChange={(e) => {
                    setMetadata(e.target.value);
                    resetPreview();
                  }}
                />
              </Label>
            )}
          </div>
          <p className="text-sm text-foreground">
            A normalized sheet uses name and fy_points_default columns. For a legacy matrix,
            explicitly count the leading employee metadata columns; only the remaining headers
            become catalog entries. Existing points are retained because a header-only matrix
            provides no points evidence.
          </p>
          <Button type="submit" className={buttonClass}>
            {busy
              ? 'Working…'
              : preview
                ? 'Regenerate review with current catalog'
                : 'Preview proposed changes'}
          </Button>
        </fieldset>
      </form>
      {preview && (
        <section className="space-y-4">
          <h2 className="font-heading text-2xl">Review proposed changes</h2>
          <p>
            {preview.rows.filter((r) => r.operation === 'CREATE').length} create ·{' '}
            {preview.rows.filter((r) => r.operation === 'UPDATE').length} update ·{' '}
            {preview.rows.filter((r) => r.operation === 'UNCHANGED').length} unchanged
          </p>
          <p className="break-all text-xs text-muted-foreground">
            Source SHA-256: {preview.sourceHash}
          </p>
          {preview.errors.length > 0 && (
            <div role="alert" className="rounded border border-warning/40 p-4">
              <p className="font-semibold">Resolve every import error before applying this file.</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {preview.errors.map((e, i) => (
                  <li key={`${e.rowNumber}:${i}`}>
                    {e.rowNumber ? `Row ${e.rowNumber}: ` : ''}
                    {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="overflow-x-auto rounded border border-border">
            <Table className="w-full text-left text-sm">
              <TableHeader className="bg-card">
                <TableRow>
                  <TableHead className="p-3">Qualification</TableHead>
                  <TableHead className="p-3">Action</TableHead>
                  <TableHead className="p-3">Current points</TableHead>
                  <TableHead className="p-3">Proposed points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.name} className="border-t border-border">
                    <TableCell className="break-words p-3">{row.name}</TableCell>
                    <TableCell className="p-3">{row.operation}</TableCell>
                    <TableCell className="p-3">{row.previousPoints ?? 'New'}</TableCell>
                    <TableCell className="p-3">{row.fyPointsDefault}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {!committed && (
            <form onSubmit={commit}>
              <fieldset disabled={busy || !preview.ready} className="space-y-4">
                <Label className="block">
                  Authoritative source reference
                  <Input
                    required
                    minLength={4}
                    maxLength={500}
                    className={fieldClass}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </Label>
                <Label className="block">
                  Review reason
                  <Input
                    required
                    minLength={4}
                    maxLength={500}
                    className={fieldClass}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Label>
                <Label className="flex min-h-11 items-center gap-3">
                  <Input
                    type="checkbox"
                    required
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  I reviewed every proposed catalog change.
                </Label>
                <Button type="submit" className={buttonClass} disabled={!accepted}>
                  Apply reviewed catalog import
                </Button>
              </fieldset>
            </form>
          )}
        </section>
      )}
      {message && <output className="block rounded border border-border p-3">{message}</output>}
    </div>
  );
}
