import { describe, expect, it } from 'vitest';

import {
  allowedReviewActionsFor,
  createTeleStaffOperatorPreview,
  reviewMutationFor,
  validateTeleStaffSourceObservationTime,
} from '../../src/lib/telestaff-operator-workflow.js';
import { buildFutureTeleStaffAssignmentsHtml } from '../fixtures/telestaff-assignments-html.js';

describe('TeleStaff operator workflow preview', () => {
  it('returns an aggregate-only preview and requires an explicit source snapshot date', async () => {
    const preview = await createTeleStaffOperatorPreview(
      new TextEncoder().encode(buildFutureTeleStaffAssignmentsHtml()),
      '2026-08-28',
      'official',
    );

    expect(preview).toMatchObject({
      ok: true,
      sourceKind: 'official',
      sourceSnapshotAsOf: '2026-08-28',
      sourceFormat: 'TELSTAFF_ASSIGNMENTS_HTML_V1',
      parserVersion: 'telestaff-assignments-html@1',
      inputRowCount: 262,
      normalizedDataRowCount: 262,
      uniqueEmployeeCount: 262,
      reportRowCount: 263,
      structuralRowCount: 1,
      workflowState: 'PREVIEW_REQUIRES_STAGE',
    });
    if (!preview.ok) return;
    expect(preview.incompleteTopologyCount).toBeGreaterThan(0);
    expect(preview.missingSourceARDayCount).toBeGreaterThan(0);
    expect(JSON.stringify(preview)).not.toContain('SYNTH-000001');
    expect(JSON.stringify(preview)).not.toContain('Synthetic Member');
  });

  it.each(['', '2026-02-30', '08/28/2026', '2026-08-28T10:00:00Z'])(
    'rejects a missing or non-calendar source snapshot date: %j',
    async (sourceSnapshotAsOf) => {
      const preview = await createTeleStaffOperatorPreview(
        new TextEncoder().encode(buildFutureTeleStaffAssignmentsHtml()),
        sourceSnapshotAsOf,
        'official',
      );

      expect(preview).toEqual({ ok: false, code: 'INVALID_SOURCE_SNAPSHOT_AS_OF' });
    },
  );

  it('does not turn a synthetic test preview into an official source', async () => {
    const preview = await createTeleStaffOperatorPreview(
      new TextEncoder().encode(buildFutureTeleStaffAssignmentsHtml()),
      '2026-08-28',
      'synthetic_test',
    );

    expect(preview).toMatchObject({ ok: true, sourceKind: 'synthetic_test' });
  });

  it('does not offer source acceptance when a newer protected canonical record exists', () => {
    const actions = allowedReviewActionsFor({
      classification: 'MOVED',
      isCurrentRecordNewer: true,
    });

    expect(actions).toEqual(['keep_current', 'reject_source_row']);
    expect(reviewMutationFor('MOVED', 'accept_observation', true)).toBeNull();
    expect(reviewMutationFor('MOVED', 'keep_current', true)).toMatchObject({
      reasonCode: 'KEEP_CURRENT_PROTECTED_CANONICAL_ASSIGNMENT',
    });
  });

  it('retains an exact source observation timestamp only with a trustworthy explicit basis', () => {
    expect(
      validateTeleStaffSourceObservationTime({
        sourceSnapshotAsOf: '2026-08-28',
        sourceObservedAt: null,
        sourceObservationTimeBasis: 'date_only',
      }),
    ).toEqual({
      ok: true,
      sourceObservedAt: null,
      sourceObservationTimeBasis: 'date_only',
    });
    expect(
      validateTeleStaffSourceObservationTime({
        sourceSnapshotAsOf: '2026-08-28',
        sourceObservedAt: '2026-08-28T14:05:06.789Z',
        sourceObservationTimeBasis: 'source_metadata',
      }),
    ).toEqual({
      ok: true,
      sourceObservedAt: Date.parse('2026-08-28T14:05:06.789Z'),
      sourceObservationTimeBasis: 'source_metadata',
    });
    expect(
      validateTeleStaffSourceObservationTime({
        sourceSnapshotAsOf: '2026-08-28',
        sourceObservedAt: '2026-08-28T14:05:06Z',
        sourceObservationTimeBasis: 'date_only',
      }),
    ).toEqual({ ok: false, code: 'INVALID_SOURCE_OBSERVATION_TIME' });
    expect(
      validateTeleStaffSourceObservationTime({
        sourceSnapshotAsOf: '2026-08-28',
        sourceObservedAt: '2026-08-29T00:05:06Z',
        sourceObservationTimeBasis: 'administrator_confirmed',
      }),
    ).toEqual({ ok: false, code: 'SOURCE_OBSERVATION_DATE_MISMATCH' });
  });
});
