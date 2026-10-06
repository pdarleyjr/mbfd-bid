import { z } from 'zod';
export function finalRankCode(label: string | undefined): string {
  const code: Record<string, string> = {
    Firefighter: 'FF',
    Lieutenant: 'LT',
    Captain: 'CPT',
    'Division Chief': 'DC',
    'Deputy Fire Chief': 'DEP_CHIEF',
    'Fire Chief': 'CHIEF',
  };
  const value = label ? code[label] : undefined;
  if (!value) throw new Error('final_source_rank_invalid');
  return value;
}
import { FinalSourceRowSchema } from '../portal-writeback/final-source.js';
import { bidContentHash } from './bid-definition-content.js';

/** Reviewed final-source display overlay. Never edits frozen topology or awards. */
export async function loadFinalResultSource(db: D1Database, sessionId: string, sequence: number) {
  const row = await db
    .prepare(`SELECT p.id,p.manifest_sha256,p.manifest_json,p.source_workbook_sha256,
      p.source_result_hash FROM final_portal_publications p JOIN canonical_bid_session_state c
      ON c.bid_session_id=p.bid_session_id
    WHERE p.bid_session_id=? AND p.source_sequence=? AND c.current_seq=p.source_sequence`)
    .bind(sessionId, sequence)
    .first<{
      id: string;
      manifest_sha256: string;
      manifest_json: string;
      source_workbook_sha256: string;
      source_result_hash: string;
    }>();
  if (!row) return null;
  if (bidContentHash(row.manifest_json) !== row.manifest_sha256)
    throw new Error('final_source_integrity_failed');
  const manifest = z
    .object({ rows: z.array(FinalSourceRowSchema).length(226) })
    .parse(JSON.parse(row.manifest_json));
  return {
    rows: manifest.rows,
    publicationId: row.id,
    workbookSha256: row.source_workbook_sha256,
    manifestSha256: row.manifest_sha256,
    canonicalResultSha256: row.source_result_hash,
  };
}
