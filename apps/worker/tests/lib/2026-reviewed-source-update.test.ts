import { describe, expect, it } from 'vitest';
import {
  OCTOBER1_2026_ANNUAL_HASH,
  OCTOBER1_2026_MASTER_HASH,
  latest2026ReviewedSourceUpdateIssue,
} from '../../src/lib/2026-latest-source-cutoff.js';

function reviewedInput() {
  return {
    versionNumber: 10,
    sourceDecisions: [
      {
        issueId: '2026-latest-substantive-ranks',
        status: 'RESOLVED',
        sourceRef: `${OCTOBER1_2026_MASTER_HASH}; ${OCTOBER1_2026_ANNUAL_HASH}`,
      },
    ],
    members: [
      { employeeId: '17594', rank: 'CPT', bidCategory: 'OFC' },
      { employeeId: '17836', rank: 'LT', bidCategory: 'OFC' },
      { employeeId: '18148', rank: 'DC', bidCategory: 'EXCLUDED' },
    ],
    credentialImports: [
      {
        coverageJson: JSON.stringify({
          sourceReceipt: {
            workbook_hash: OCTOBER1_2026_ANNUAL_HASH,
            source_revision: 5,
            selected_sheet: '2026_BID_Credentials_Version_5_',
            row_count: 3884,
            unique_employee_count: 230,
          },
        }),
        rowCount: 3884,
        reviewedCount: 3884,
      },
    ],
  };
}

describe('October 1 reviewed 2026 source update acceptance', () => {
  it('rejects the superseded MASTER V3 even when every other acceptance gate passes', () => {
    const input = reviewedInput();
    const decision = input.sourceDecisions[0];
    if (!decision) throw new Error('Missing synthetic source decision');
    decision.sourceRef = `3631427507fa7ca0280a03e9b0a14a2429bbafad3404d46f5cef4a1ce679b57d; ${OCTOBER1_2026_ANNUAL_HASH}`;
    expect(latest2026ReviewedSourceUpdateIssue(input)).toBe('latest_2026_source_version_required');
  });
  it('accepts the exact October 1 MASTER and Annual package after complete row review', () => {
    expect(OCTOBER1_2026_MASTER_HASH).toBe(
      'ab87dff9e920d97cfdc6ef401986a0ceb2ba14d99a61496d13fe75526f175d8b',
    );
    expect(OCTOBER1_2026_ANNUAL_HASH).toBe(
      '8af7fb3e4f1e6a557fac3171ad6ccccca259afe4a1bdac0ce229e2c2674391e9',
    );
    expect(latest2026ReviewedSourceUpdateIssue(reviewedInput())).toBeNull();
  });
  it('refuses the older Version 9 even with later source rows present', () => {
    const input = reviewedInput();
    input.versionNumber = 9;
    expect(latest2026ReviewedSourceUpdateIssue(input)).toBe('latest_2026_source_version_required');
  });
  it('requires the resolved decision to reference both original source files', () => {
    const input = reviewedInput();
    const decision = input.sourceDecisions[0];
    if (!decision) throw new Error('Missing synthetic source decision');
    decision.sourceRef = OCTOBER1_2026_MASTER_HASH;
    expect(latest2026ReviewedSourceUpdateIssue(input)).toBe('latest_2026_source_version_required');
  });
  it('does not admit October evidence through the original September cutoff guard', async () => {
    const { latest2026SourceCutoffIssue } = await import(
      '../../src/lib/2026-latest-source-cutoff.js'
    );
    expect(latest2026SourceCutoffIssue(reviewedInput())).toBe(
      'latest_2026_source_version_required',
    );
  });
  it('requires a resolved source decision before accepting the new archive', () => {
    const input = reviewedInput();
    const decision = input.sourceDecisions[0];
    if (!decision) throw new Error('Missing synthetic source decision');
    decision.status = 'OPEN';
    expect(latest2026ReviewedSourceUpdateIssue(input)).toBe('latest_2026_source_version_required');
  });
  it.each([
    { employeeId: '17594', rank: 'DC', bidCategory: 'OFC' },
    { employeeId: '17836', rank: 'LT', bidCategory: 'FF' },
    { employeeId: '18148', rank: 'CPT', bidCategory: 'OFC' },
  ])('rejects uncorrected production rank/pool for $employeeId', (stale) => {
    const input = reviewedInput();
    input.members = input.members.map((member) =>
      member.employeeId === stale.employeeId ? stale : member,
    );
    expect(latest2026ReviewedSourceUpdateIssue(input)).toBe(
      'latest_2026_personnel_corrections_required',
    );
  });
  it('rejects the superseded September 30 MASTER with an otherwise current source receipt', () => {
    const input = reviewedInput();
    const decision = input.sourceDecisions[0];
    if (!decision) throw new Error('Missing synthetic source decision');
    decision.sourceRef = `a1bc6309bd7f565b98616226fd3cbe5fae6c6d7ce764188bdbfdd1eb8702e685; ${OCTOBER1_2026_ANNUAL_HASH}`;
    expect(latest2026ReviewedSourceUpdateIssue(input)).toBe('latest_2026_source_version_required');
  });
  it.each([
    'unreviewed',
    'older-workbook',
    'older-sheet',
    'older-revision',
    'wrong-receipt-row-count',
    'wrong-import-row-count',
    'wrong-employee-count',
    'missing-receipt',
    'malformed',
  ])('cannot seal a credential source with %s evidence', (failure) => {
    const input = reviewedInput();
    const batch = input.credentialImports[0];
    if (!batch) throw new Error('Missing synthetic credential receipt');
    if (failure === 'unreviewed') batch.reviewedCount--;
    if (failure === 'older-workbook')
      batch.coverageJson = batch.coverageJson.replace(OCTOBER1_2026_ANNUAL_HASH, 'a'.repeat(64));
    if (failure === 'older-sheet')
      batch.coverageJson = batch.coverageJson.replace('Version_5_', 'Version_4_');
    if (failure === 'older-revision') {
      const coverage = JSON.parse(batch.coverageJson);
      coverage.sourceReceipt.source_revision = 4;
      batch.coverageJson = JSON.stringify(coverage);
    }
    if (failure === 'wrong-receipt-row-count') {
      const coverage = JSON.parse(batch.coverageJson);
      coverage.sourceReceipt.row_count = 3883;
      batch.coverageJson = JSON.stringify(coverage);
    }
    if (failure === 'wrong-import-row-count') {
      batch.rowCount--;
      batch.reviewedCount--;
    }
    if (failure === 'wrong-employee-count') {
      const coverage = JSON.parse(batch.coverageJson);
      coverage.sourceReceipt.unique_employee_count = 229;
      batch.coverageJson = JSON.stringify(coverage);
    }
    if (failure === 'missing-receipt') batch.coverageJson = '{}';
    if (failure === 'malformed') batch.coverageJson = '{';
    expect(latest2026ReviewedSourceUpdateIssue(input)).toBe(
      'latest_2026_credential_revision_review_required',
    );
  });
  it('allows reviewed acceptance without imposing an invented participant count or seat decision', () => {
    expect(latest2026ReviewedSourceUpdateIssue(reviewedInput())).toBeNull();
  });
});
