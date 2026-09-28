// Plan 08 Task 15 — Page audit_log from D1 → gzip → R2.
//
// Pages through D1 in bounded chunks, compresses the CSV, uploads under
// `<year>/<session_id>/audit_full_<nowMs>.csv.gz`, and returns the (signed)
// public URL. Performance target: 250 rows < 2 seconds end-to-end.

import type { R2Bucket, R2MultipartUpload, R2UploadedPart } from '@cloudflare/workers-types';
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
const R2_PART_SIZE = 5 * 1024 * 1024;
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
  const r2Key = `${args.year}/${args.bidSessionId}/audit_full_${startedAt}.csv.gz`;
  const options = {
    httpMetadata: { contentType: 'text/csv', contentEncoding: 'gzip' },
  };
  // R2 cannot accept a generated ReadableStream with unknown length. Buffer one
  // fixed-size part at a time; small exports use put and large exports use R2's
  // multipart API. Both receive a Uint8Array with a known length.
  const reader = csv.pipeThrough(new CompressionStream('gzip')).getReader();
  let part = new Uint8Array(R2_PART_SIZE);
  let partLength = 0;
  let bytesGzipped = 0;
  let multipart: R2MultipartUpload | undefined;
  const uploadedParts: R2UploadedPart[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesGzipped += value.byteLength;
      let offset = 0;
      while (offset < value.byteLength) {
        const count = Math.min(R2_PART_SIZE - partLength, value.byteLength - offset);
        part.set(value.subarray(offset, offset + count), partLength);
        partLength += count;
        offset += count;
        if (partLength === R2_PART_SIZE) {
          multipart ??= await args.r2.createMultipartUpload(r2Key, options);
          uploadedParts.push(await multipart.uploadPart(uploadedParts.length + 1, part));
          part = new Uint8Array(R2_PART_SIZE);
          partLength = 0;
        }
      }
    }
    if (multipart) {
      if (partLength > 0) {
        uploadedParts.push(
          await multipart.uploadPart(uploadedParts.length + 1, part.subarray(0, partLength)),
        );
      }
      await multipart.complete(uploadedParts);
    } else {
      await args.r2.put(r2Key, part.subarray(0, partLength), options);
    }
  } catch (error) {
    if (multipart) {
      try {
        await multipart.abort();
      } catch {
        // Keep the original export failure; R2 also expires orphaned uploads.
      }
    }
    throw error;
  }
  const signedUrl = await args.signUrl(r2Key);
  return {
    r2Key,
    signedUrl,
    rowCount,
    bytesGzipped,
    elapsedMs: args.now() - startedAt,
  };
}
