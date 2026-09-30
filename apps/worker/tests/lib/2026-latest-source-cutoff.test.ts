import { describe, expect, it } from 'vitest';
import {
  LATEST_2026_ANNUAL_HASH,
  LATEST_2026_MASTER_HASH,
  latest2026SourceCutoffIssue,
} from '../../src/lib/2026-latest-source-cutoff.js';

function reviewedInput() {
  return {
    versionNumber: 10,
    sourceDecisions: [
      {
        issueId: '2026-latest-substantive-ranks',
        status: 'RESOLVED',
        sourceRef: `${LATEST_2026_MASTER_HASH}; ${LATEST_2026_ANNUAL_HASH}`,
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
            workbook_hash: LATEST_2026_ANNUAL_HASH,
            source_revision: 4,
            selected_sheet: '2026_BID_Credentials_Version_4_',
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

describe('latest 2026 cutoff source acceptance', () => {
  it('rejects the superseded MASTER V3 even when every other acceptance gate passes', () => {
    const input = reviewedInput();
    const decision = input.sourceDecisions[0];
    if (!decision) throw new Error('Missing synthetic source decision');
    decision.sourceRef = `3631427507fa7ca0280a03e9b0a14a2429bbafad3404d46f5cef4a1ce679b57d; ${LATEST_2026_ANNUAL_HASH}`;
    expect(latest2026SourceCutoffIssue(input)).toBe('latest_2026_source_version_required');
  });
  it('accepts the independently verified MASTER V4 when every other gate passes', () => {
    expect(LATEST_2026_MASTER_HASH).toBe(
      'a1bc6309bd7f565b98616226fd3cbe5fae6c6d7ce764188bdbfdd1eb8702e685',
    );
    expect(latest2026SourceCutoffIssue(reviewedInput())).toBeNull();
  });
  it('refuses the older Version 9 even with later source rows present', () => {
    const input = reviewedInput();
    input.versionNumber = 9;
    expect(latest2026SourceCutoffIssue(input)).toBe('latest_2026_source_version_required');
  });
  it('requires the resolved decision to reference both original source files', () => {
    const input = reviewedInput();
    const decision = input.sourceDecisions[0];
    if (!decision) throw new Error('Missing synthetic source decision');
    decision.sourceRef = LATEST_2026_MASTER_HASH;
    expect(latest2026SourceCutoffIssue(input)).toBe('latest_2026_source_version_required');
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
    expect(latest2026SourceCutoffIssue(input)).toBe('latest_2026_personnel_corrections_required');
  });
  it.each(['unreviewed', 'older-workbook', 'older-sheet', 'missing-receipt', 'malformed'])(
    'cannot seal a credential source with %s evidence',
    (failure) => {
      const input = reviewedInput();
      const batch = input.credentialImports[0];
      if (!batch) throw new Error('Missing synthetic credential receipt');
      if (failure === 'unreviewed') batch.reviewedCount--;
      if (failure === 'older-workbook')
        batch.coverageJson = batch.coverageJson.replace(LATEST_2026_ANNUAL_HASH, 'a'.repeat(64));
      if (failure === 'older-sheet')
        batch.coverageJson = batch.coverageJson.replace('Version_4_', 'Version_1_');
      if (failure === 'missing-receipt') batch.coverageJson = '{}';
      if (failure === 'malformed') batch.coverageJson = '{';
      expect(latest2026SourceCutoffIssue(input)).toBe(
        'latest_2026_credential_revision_review_required',
      );
    },
  );
  it('allows reviewed acceptance without imposing an invented participant count or seat decision', () => {
    expect(latest2026SourceCutoffIssue(reviewedInput())).toBeNull();
  });
});
