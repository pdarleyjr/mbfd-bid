// Plan 08 Task 15 — Stream audit_log from D1 → gzip → R2.
//
// Pages through D1 in chunks of 500 rows, builds a single concatenated CSV
// document, gzips with pako, uploads under
// `<year>/<session_id>/audit_full_<nowMs>.csv.gz`, and returns the (signed)
// public URL. Performance target: 250 rows < 2 seconds end-to-end.

import type { R2Bucket } from '@cloudflare/workers-types';
import { gzip } from 'pako';
import Papa from 'papaparse';

export interface AuditCsvDb {
  pageRows(offset: number, limit: number): Promise<ReadonlyArray<Record<string, unknown>>>;
  count(): Promise<number>;
}

export interface AuditCsvArgs {
  bidSessionId: string;
  year: number;
  db: AuditCsvDb;
  r2: R2Bucket;
  /** Mints a signed download URL for the uploaded R2 object. */
  signUrl: (key: string) => Promise<string>;
  now: () => number;
}

export interface AuditCsvResult {
  r2Key: string;
  signedUrl: string;
  rowCount: number;
  bytesGzipped: number;
  elapsedMs: number;
}

const PAGE_SIZE = 500;
export const AUDIT_CSV_FIELDS = [
  'id',
  'bid_session_id',
  'seq',
  'actor_type',
  'actor_id',
  'action',
  'target_kind',
  'target_id',
  'before_state',
  'after_state',
  'reason',
  'ai_advisory_id',
  'client_meta',
  'created_at',
] as const;

export async function exportAuditCsv(args: AuditCsvArgs): Promise<AuditCsvResult> {
  const startedAt = args.now();
  let offset = 0;
  let rowCount = 0;
  const chunks: string[] = [];
  let isFirstPage = true;

  while (true) {
    const rows = await args.db.pageRows(offset, PAGE_SIZE);
    if (rows.length === 0) break;
    const csv = Papa.unparse(rows as Record<string, unknown>[], {
      header: isFirstPage,
      columns: AUDIT_CSV_FIELDS as unknown as string[],
      newline: '\n',
    });
    chunks.push(`${csv}\n`);
    isFirstPage = false;
    rowCount += rows.length;
    offset += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;
  }

  if (rowCount === 0) {
    chunks.push(`${AUDIT_CSV_FIELDS.join(',')}\n`);
  }

  const raw = new TextEncoder().encode(chunks.join(''));
  const gzipped = gzip(raw, { level: 6 });
  const generatedAt = args.now();
  const r2Key = `${args.year}/${args.bidSessionId}/audit_full_${generatedAt}.csv.gz`;
  await args.r2.put(r2Key, gzipped, {
    httpMetadata: {
      contentType: 'text/csv',
      contentEncoding: 'gzip',
    },
  });
  const signedUrl = await args.signUrl(r2Key);
  return {
    r2Key,
    signedUrl,
    rowCount,
    bytesGzipped: gzipped.byteLength,
    elapsedMs: generatedAt - startedAt,
  };
}
