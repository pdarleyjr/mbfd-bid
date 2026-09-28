// Plan 08 Task 15 — Stream audit_log from D1 → gzip → R2.
//
// Pages through D1 in bounded chunks, compresses the CSV as a stream, uploads under
// `<year>/<session_id>/audit_full_<nowMs>.csv.gz`, and returns the (signed)
// public URL. Performance target: 250 rows < 2 seconds end-to-end.

import type { R2Bucket } from '@cloudflare/workers-types';
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

const PAGE_SIZE = 25;
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
  let isFirstPage = true;
  const encoder = new TextEncoder();
  const csv = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const rows = await args.db.pageRows(offset, PAGE_SIZE);
      if (rows.length === 0) {
        if (isFirstPage) controller.enqueue(encoder.encode(`${AUDIT_CSV_FIELDS.join(',')}\n`));
        controller.close();
        return;
      }
      const page = Papa.unparse(rows as Record<string, unknown>[], {
        header: isFirstPage,
        columns: AUDIT_CSV_FIELDS as unknown as string[],
        newline: '\n',
      });
      controller.enqueue(encoder.encode(`${page}\n`));
      isFirstPage = false;
      rowCount += rows.length;
      offset += rows.length;
      if (rows.length < PAGE_SIZE) controller.close();
    },
  });
  const [uploadStream, countStream] = csv.pipeThrough(new CompressionStream('gzip')).tee();
  const countBytes = (async () => {
    let total = 0;
    const reader = countStream.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
    }
    return total;
  })();
  const r2Key = `${args.year}/${args.bidSessionId}/audit_full_${startedAt}.csv.gz`;
  await args.r2.put(r2Key, uploadStream as Parameters<R2Bucket['put']>[1], {
    httpMetadata: {
      contentType: 'text/csv',
      contentEncoding: 'gzip',
    },
  });
  const bytesGzipped = await countBytes;
  const signedUrl = await args.signUrl(r2Key);
  return {
    r2Key,
    signedUrl,
    rowCount,
    bytesGzipped,
    elapsedMs: args.now() - startedAt,
  };
}
