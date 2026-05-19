import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema.js';

describe('Plan 08 schema (mig 0013)', () => {
  it('exports audit_chunks table with all columns', () => {
    expect(schema.auditChunks).toBeDefined();
    expect(schema.auditChunks.bidSessionId).toBeDefined();
    expect(schema.auditChunks.seq).toBeDefined();
    expect(schema.auditChunks.r2Key).toBeDefined();
    expect(schema.auditChunks.sha256).toBeDefined();
    expect(schema.auditChunks.prevSha256).toBeDefined();
    expect(schema.auditChunks.signatureB64u).toBeDefined();
    expect(schema.auditChunks.pubkeyB64u).toBeDefined();
    expect(schema.auditChunks.eventsInChunk).toBeDefined();
    expect(schema.auditChunks.minSeq).toBeDefined();
    expect(schema.auditChunks.maxSeq).toBeDefined();
    expect(schema.auditChunks.signedAt).toBeDefined();
  });

  it('exports audit_chain_state table', () => {
    expect(schema.auditChainState).toBeDefined();
    expect(schema.auditChainState.bidSessionId).toBeDefined();
    expect(schema.auditChainState.nextSeq).toBeDefined();
    expect(schema.auditChainState.pendingBufferStartedAt).toBeDefined();
    expect(schema.auditChainState.lastChunkSha256).toBeDefined();
  });

  it('audit_log has chunk_seq + chunk_row_index', () => {
    expect(schema.auditLog.chunkSeq).toBeDefined();
    expect(schema.auditLog.chunkRowIndex).toBeDefined();
  });
});
