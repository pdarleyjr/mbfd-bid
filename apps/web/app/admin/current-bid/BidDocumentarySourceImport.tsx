'use client';

import { Button } from '@/components/ui/button';
import { createCsrfAwareFetch } from '@/lib/client-csrf';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  type BidFormArchive,
  BidFormArchiveSchema,
  bidFormArchiveHasIdentityConflict,
  bidFormArchiveHash,
} from '../../../../worker/src/lib/bid-form-source';

const MAX_BYTES = 1_048_576;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const SourceMetadataSchema = z
  .object({
    year: z.number().int(),
    status: z.enum(['PUBLISHED', 'NONE']),
    archiveSha256: digest.nullable(),
    publishedAt: z.string().datetime().nullable(),
    source: z
      .object({ name: z.string().min(1), sha256: digest })
      .strict()
      .nullable(),
    submittedForms: count,
    notSubmitted: count,
    airTechReferences: count,
    rankLists: count,
    rankRows: count,
  })
  .strict()
  .refine((value) =>
    value.status === 'PUBLISHED'
      ? value.archiveSha256 !== null && value.publishedAt !== null && value.source !== null
      : value.archiveSha256 === null &&
        value.publishedAt === null &&
        value.source === null &&
        value.submittedForms +
          value.notSubmitted +
          value.airTechReferences +
          value.rankLists +
          value.rankRows ===
          0,
  );
type SourceMetadata = z.infer<typeof SourceMetadataSchema>;
const PublicationSchema = z
  .object({
    year: z.number().int(),
    sha256: digest,
    publishedAt: z.string().datetime(),
    alreadyPublished: z.boolean(),
  })
  .strict();
type SelectedSource = { year: number; name: string; archive: BidFormArchive; sha256: string };
type MetadataState = {
  year: number;
  data: SourceMetadata | null;
  error: string | null;
  loading: boolean;
};

function sourceCounts(archive: BidFormArchive) {
  return {
    submittedForms: archive.forms.length,
    notSubmitted: archive.notSubmitted.length,
    airTechReferences: archive.airTechReferences?.length ?? 0,
    rankLists: archive.rankLists?.length ?? 0,
    rankRows: (archive.rankLists ?? []).reduce((total, list) => total + list.rows.length, 0),
  };
}

export function BidDocumentarySourceImport({ year }: { year: number }) {
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [metadata, setMetadata] = useState<MetadataState | null>(null);
  const [selected, setSelected] = useState<SelectedSource | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);
  const currentYear = useRef(year);
  currentYear.current = year;
  const generation = useRef(0);
  const fileSequence = useRef(0);
  const busyRef = useRef(false);
  const publicationError = useRef(false);
  const publicationController = useRef<AbortController | null>(null);
  const mutationFetch = useRef<ReturnType<typeof createCsrfAwareFetch> | null>(null);

  useEffect(() => {
    void year;
    generation.current++;
    fileSequence.current++;
    busyRef.current = false;
    publicationError.current = false;
    publicationController.current?.abort();
    setSelected(null);
    setReading(false);
    setBusy(false);
    setError(null);
    setNotice(null);
    setRequiresReload(false);
    return () => {
      generation.current++;
      fileSequence.current++;
      publicationController.current?.abort();
    };
  }, [year]);

  useEffect(() => {
    void reload;
    if (!open || busyRef.current) return;
    const controller = new AbortController();
    const operationGeneration = generation.current;
    const stillCurrent = () =>
      !controller.signal.aborted &&
      currentYear.current === year &&
      generation.current === operationGeneration;
    setMetadata({ year, data: null, error: null, loading: true });
    void fetch(`/api/admin/bid-forms/${year}/source`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('The saved source could not be loaded. Reload source to try again.');
        const result = SourceMetadataSchema.safeParse(await response.json());
        if (!result.success || result.data.year !== year)
          throw new Error(
            'The saved source could not be verified. Reload source before publishing.',
          );
        return result.data;
      })
      .then((data) => {
        if (!stillCurrent()) return;
        setMetadata({ year, data, error: null, loading: false });
        setRequiresReload(false);
        if (publicationError.current) {
          setError(null);
          publicationError.current = false;
        }
      })
      .catch((caught: unknown) => {
        if (!stillCurrent()) return;
        setMetadata({
          year,
          data: null,
          error: caught instanceof Error ? caught.message : 'The saved source could not be loaded.',
          loading: false,
        });
      });
    return () => controller.abort();
  }, [open, year, reload]);

  const currentMetadata = metadata?.year === year ? metadata : null;
  const currentFile = selected?.year === year ? selected : null;

  async function selectFile(file: File | undefined) {
    const sequence = ++fileSequence.current;
    const operationGeneration = generation.current;
    const stillCurrent = () =>
      currentYear.current === year &&
      generation.current === operationGeneration &&
      fileSequence.current === sequence;
    setSelected(null);
    setReading(false);
    publicationError.current = false;
    setError(null);
    setNotice(null);
    if (!file) return;
    setReading(true);
    try {
      if (!file.name.toLowerCase().endsWith('.json'))
        throw new Error('Choose the reviewed JSON source file.');
      if (file.size > MAX_BYTES) throw new Error('The source file must be 1 MiB or smaller.');
      const text = await file.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
        throw new Error('The source file must be 1 MiB or smaller.');
      let input: unknown;
      try {
        input = JSON.parse(text);
      } catch {
        throw new Error('The file could not be read as JSON. Choose a valid source file.');
      }
      const result = BidFormArchiveSchema.safeParse(input);
      if (!result.success) throw new Error('This file is not a valid Bid source archive.');
      if (result.data.year !== year) throw new Error(`Choose a source file for ${year}.`);
      if (bidFormArchiveHasIdentityConflict(result.data))
        throw new Error('The file contains conflicting member IDs. Review it before publishing.');
      const sha256 = await bidFormArchiveHash(result.data);
      if (stillCurrent()) setSelected({ year, name: file.name, archive: result.data, sha256 });
    } catch (caught: unknown) {
      if (stillCurrent())
        setError(caught instanceof Error ? caught.message : 'The source file could not be read.');
    } finally {
      if (stillCurrent()) setReading(false);
    }
  }

  async function publish() {
    const source = currentFile;
    const saved = currentMetadata?.data;
    if (busyRef.current || !open || !source || !saved || currentMetadata.loading || requiresReload)
      return;
    const body = JSON.stringify({
      archive: source.archive,
      ...(saved.archiveSha256 === null ? {} : { expectedArchiveSha256: saved.archiveSha256 }),
    });
    if (new TextEncoder().encode(body).byteLength > MAX_BYTES) {
      setError('The publication exceeds 1 MiB. Choose a smaller reviewed archive.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    publicationController.current = controller;
    const operationGeneration = generation.current;
    const stillCurrent = () =>
      !controller.signal.aborted &&
      currentYear.current === year &&
      generation.current === operationGeneration;
    try {
      mutationFetch.current ??= createCsrfAwareFetch(
        (input, init) => window.fetch(input, init),
        () => window.location.origin,
      );
      const response = await mutationFetch.current('/api/admin/bid-forms', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (response.status === 409)
        throw new Error(
          'The saved source changed or needs review. Reload source before publishing again.',
        );
      if (!response.ok)
        throw new Error(
          'The source was not confirmed as published. Reload source before trying again.',
        );
      const result = PublicationSchema.safeParse(await response.json());
      if (!result.success || result.data.year !== year || result.data.sha256 !== source.sha256)
        throw new Error(
          'The publication could not be verified. Reload source before trying again.',
        );
      if (!stillCurrent()) return;
      setMetadata({
        year,
        loading: false,
        error: null,
        data: {
          year,
          status: 'PUBLISHED',
          archiveSha256: result.data.sha256,
          publishedAt: result.data.publishedAt,
          source: source.archive.source,
          ...sourceCounts(source.archive),
        },
      });
      setNotice(
        result.data.alreadyPublished
          ? 'This source is already published.'
          : 'Source published for Mock and Real bids.',
      );
    } catch (caught: unknown) {
      if (!stillCurrent()) return;
      publicationError.current = true;
      setRequiresReload(true);
      setError(
        caught instanceof Error
          ? caught.message
          : 'The publication could not be verified. Reload source before trying again.',
      );
    } finally {
      if (stillCurrent()) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <details
      className="border-t border-border pt-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
        Bid forms and final rank lists
      </summary>
      {open ? (
        <div className="space-y-3 py-3 text-sm">
          <p className="text-muted-foreground">
            Update the member forms and published reference lists for {year}.
          </p>
          {currentMetadata?.loading ? <output>Loading saved source…</output> : null}
          {currentMetadata?.data ? (
            <p>
              {currentMetadata.data.source?.name ?? 'No source published yet.'}
              {currentMetadata.data.status === 'PUBLISHED'
                ? ` · ${currentMetadata.data.submittedForms} forms · ${currentMetadata.data.rankLists} rank lists · ${currentMetadata.data.rankRows} list rows`
                : ''}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || currentMetadata?.loading}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload source
          </Button>
          <label className="block space-y-2">
            <span className="block font-semibold">Reviewed source file (.json)</span>
            <input
              key={year}
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => void selectFile(event.currentTarget.files?.[0])}
              className="block w-full min-w-0 text-sm"
            />
          </label>
          {reading ? <output>Checking selected file…</output> : null}
          {currentFile ? (
            <p>
              {currentFile.name} · {currentFile.archive.forms.length} forms ·{' '}
              {currentFile.archive.rankLists?.length ?? 0} rank lists
            </p>
          ) : null}
          {currentMetadata?.error || error ? (
            <p role="alert" className="text-warning">
              {error ?? currentMetadata?.error}
            </p>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={
              busy ||
              reading ||
              !currentFile ||
              !currentMetadata?.data ||
              currentMetadata.loading ||
              requiresReload
            }
            onClick={() => void publish()}
          >
            {busy ? 'Publishing source…' : 'Publish source'}
          </Button>
          {notice ? <output className="block text-success">{notice}</output> : null}
        </div>
      ) : null}
    </details>
  );
}
