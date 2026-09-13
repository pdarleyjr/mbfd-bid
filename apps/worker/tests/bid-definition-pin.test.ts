import { createHash } from 'node:crypto';
import { type BidSessionPolicySnapshot, BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';
import {
  type BidDefinitionSnapshotColumns,
  type BidDefinitionSnapshotRow,
  type FrozenBidDefinitionIdentity,
  bidSnapshotSha256,
  validateBidDefinitionSnapshotPin,
} from '../src/lib/bid-definition-pin.js';

// Synthetic identities/material only. A passing structural pin is not evidence
// of approved annual policy, Department context, or permission to execute Live.
const VERSION_HASH = '1'.repeat(64);
const CONTEXT_HASH = '2'.repeat(64);
const CAPTURED_AT = 1_800_000_000_000;
const legacyColumns: BidDefinitionSnapshotColumns = {
  bidVersionId: null,
  bidVersionSha256: null,
  snapshotSha256: null,
  contextSha256: null,
};
const version: FrozenBidDefinitionIdentity = {
  id: 'synthetic-version-18',
  bidYear: 2027,
  contentSha256: VERSION_HASH,
  ruleBookVersion: '2027.92',
  ruleBookRevision: 8,
  positionTemplateVersion: '2027.93',
};

function snapshot(): Extract<BidSessionPolicySnapshot, { v: 3 }> {
  return {
    v: 3,
    ruleBookVersion: version.ruleBookVersion,
    ruleBookRevision: version.ruleBookRevision,
    positionTemplateVersion: version.positionTemplateVersion,
    configurationRevision: 4,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
    },
    credentialEvaluationOn: '2027-01-01',
    capturedAtMs: CAPTURED_AT,
    members: [
      {
        memberId: 101,
        pool: 'FF',
        rscSeniority: 1,
        rankSeniority: 1,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: [],
      },
    ],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: version.ruleBookVersion,
          templateVersion: version.positionTemplateVersion,
          positionId: 'synthetic-seat',
          requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["rsc_seniority"]',
        },
      ],
      positions: [
        {
          id: 'synthetic-seat',
          templateVersion: version.positionTemplateVersion,
          bidParticipation: 'BIDDABLE',
          isExcludedFromCount: false,
          shift: 'A',
          station: '7',
          unit: 'Synthetic Engine – é',
          rankRequired: 'FF',
          positionName: 'Synthetic Firefighter',
        },
      ],
    },
  };
}

function body() {
  return {
    ...snapshot(),
    bidDefinition: {
      v: 1 as const,
      bidSessionId: 'synthetic-session',
      bidYear: 2027,
      versionId: version.id,
      versionSha256: VERSION_HASH,
      contextSha256: CONTEXT_HASH,
    },
  };
}

function row(value: unknown = body()): BidDefinitionSnapshotRow {
  const snapshotJson = JSON.stringify(value);
  return {
    bidSessionId: 'synthetic-session',
    bidYear: 2027,
    ruleBookVersion: version.ruleBookVersion,
    positionTemplateVersion: version.positionTemplateVersion,
    ruleBookRevision: version.ruleBookRevision,
    capturedAtMs: CAPTURED_AT,
    snapshotJson,
    bidVersionId: version.id,
    bidVersionSha256: VERSION_HASH,
    snapshotSha256: createHash('sha256').update(snapshotJson, 'utf8').digest('hex'),
    contextSha256: CONTEXT_HASH,
  };
}

function validate(candidate = row(), identity: FrozenBidDefinitionIdentity | null = version) {
  return validateBidDefinitionSnapshotPin({
    row: candidate,
    expectedBidSessionId: 'synthetic-session',
    version: identity,
  });
}

describe('Bid snapshot identity and byte pins', () => {
  it('accepts the supplied immutable V18 identity without any current-head dependency', () => {
    const candidate = Object.freeze(row());
    const result = validate(candidate, Object.freeze(version));
    expect(result).toMatchObject({
      ok: true,
      kind: 'pinned',
      contextDigestChecked: false,
      bidDefinition: body().bidDefinition,
    });
    expect(candidate.snapshotJson).toBe(JSON.stringify(body()));
    expect(bidSnapshotSha256(candidate.snapshotJson)).toBe(candidate.snapshotSha256);
  });

  it('checks an independently computed context hash and records that boundary', () => {
    const result = validateBidDefinitionSnapshotPin({
      row: row(),
      expectedBidSessionId: 'synthetic-session',
      version,
      expectedContextSha256: CONTEXT_HASH,
    });
    expect(result).toMatchObject({ ok: true, kind: 'pinned', contextDigestChecked: true });
    for (const expectedContextSha256 of ['3'.repeat(64), '', 'INVALID']) {
      expect(
        validateBidDefinitionSnapshotPin({
          row: row(),
          expectedBidSessionId: 'synthetic-session',
          version,
          expectedContextSha256,
        }),
      ).toMatchObject({ ok: false, reason: 'context_digest_mismatch' });
    }
  });

  it.each([1, 2, 3] as const)('preserves the existing V%s legacy parse and original bytes', (v) => {
    const current = snapshot();
    const value =
      v === 3
        ? current
        : {
            v,
            ruleBookVersion: current.ruleBookVersion,
            positionTemplateVersion: current.positionTemplateVersion,
            capturedAtMs: CAPTURED_AT,
            members: [],
            ...(v === 2
              ? {
                  ruleBookRevision: current.ruleBookRevision,
                  configurationRevision: current.configurationRevision,
                  settings: current.settings,
                }
              : {}),
          };
    const snapshotJson = `${JSON.stringify(value, null, 2)}\n`;
    const candidate = {
      ...row(value),
      ...legacyColumns,
      snapshotJson,
      ruleBookRevision: v === 1 ? null : version.ruleBookRevision,
    };
    const original = structuredClone(candidate);
    expect(validate(candidate, null)).toEqual({
      ok: true,
      kind: 'legacy',
      snapshot: BidSessionPolicySnapshotSchema.parse(JSON.parse(snapshotJson)),
      bidDefinition: null,
    });
    expect(candidate).toEqual(original);
  });

  it.each(Array.from({ length: 14 }, (_, index) => index + 1))(
    'rejects mixed NULL pin columns (mask %s)',
    (mask) => {
      const candidate = row();
      const fields = Object.keys(legacyColumns) as (keyof BidDefinitionSnapshotColumns)[];
      fields.forEach((field, index) => {
        if (mask & (1 << index)) candidate[field] = null;
      });
      expect(validate(candidate)).toMatchObject({ ok: false, reason: 'pin_columns_incomplete' });
    },
  );

  it.each(Object.keys(legacyColumns) as (keyof BidDefinitionSnapshotColumns)[])(
    'rejects a missing selected column %s instead of inferring legacy',
    (field) => {
      const candidate = { ...row(snapshot()), ...legacyColumns };
      Reflect.deleteProperty(candidate, field);
      expect(validate(candidate)).toMatchObject({ ok: false, reason: 'pin_columns_invalid' });
    },
  );

  it.each([body().bidDefinition, null, {}, 'synthetic-pin'])(
    'rejects an all-NULL row carrying unverified body metadata %j',
    (bidDefinition) => {
      expect(
        validate({ ...row({ ...snapshot(), bidDefinition }), ...legacyColumns }),
      ).toMatchObject({
        ok: false,
        code: 'session_policy_snapshot_integrity_invalid',
        reason: 'legacy_body_has_pin',
      });
    },
  );

  it('rejects altered bytes even when the parsed JSON is semantically identical', () => {
    const candidate = row();
    candidate.snapshotJson = `${JSON.stringify(body(), null, 2)}\n`;
    expect(validate(candidate)).toMatchObject({ ok: false, reason: 'snapshot_digest_mismatch' });
  });

  it.each([
    ['bidSessionId', 'another-session'],
    ['bidYear', 2028],
    ['versionId', 'synthetic-version-19'],
    ['versionSha256', '3'.repeat(64)],
    ['contextSha256', '3'.repeat(64)],
  ] as const)('rejects rehashed body identity mismatch %s', (field, value) => {
    const candidate = body();
    Object.assign(candidate.bidDefinition, { [field]: value });
    expect(validate(row(candidate))).toMatchObject({ ok: false, reason: 'body_pin_mismatch' });
  });

  it.each([
    ['ruleBookVersion', '2027.94'],
    ['positionTemplateVersion', '2027.94'],
    ['ruleBookRevision', 9],
    ['capturedAtMs', CAPTURED_AT + 1],
  ] as const)('rejects a rehashed snapshot/row mismatch %s', (field, value) => {
    const candidate = body();
    Object.assign(candidate, { [field]: value });
    if (field === 'ruleBookVersion') {
      candidate.ruleBookMaterial.rules = candidate.ruleBookMaterial.rules.map((rule) => ({
        ...rule,
        ruleBookVersion: value,
      }));
    }
    if (field === 'positionTemplateVersion') {
      candidate.ruleBookMaterial.rules = candidate.ruleBookMaterial.rules.map((rule) => ({
        ...rule,
        templateVersion: value,
      }));
      candidate.ruleBookMaterial.positions = candidate.ruleBookMaterial.positions.map(
        (position) => ({
          ...position,
          templateVersion: value,
        }),
      );
    }
    expect(validate(row(candidate))).toMatchObject({ ok: false, reason: 'snapshot_row_mismatch' });
  });

  it.each([
    ['id', 'synthetic-version-19'],
    ['bidYear', 2028],
    ['contentSha256', '3'.repeat(64)],
    ['ruleBookVersion', '2027.94'],
    ['positionTemplateVersion', '2027.94'],
    ['ruleBookRevision', 9],
  ] as const)('rejects a different immutable version field %s', (field, value) => {
    expect(validate(row(), { ...version, [field]: value })).toMatchObject({
      ok: false,
      reason: 'version_identity_mismatch',
    });
  });

  it('rejects a missing version, malformed hashes, missing body pin and unknown body metadata', () => {
    expect(validate(row(), null)).toMatchObject({ ok: false, reason: 'version_identity_missing' });
    expect(validate(row(), { ...version, contentSha256: 'invalid' })).toMatchObject({
      ok: false,
      reason: 'version_identity_invalid',
    });
    expect(validate({ ...row(), bidVersionSha256: 'invalid' })).toMatchObject({
      ok: false,
      reason: 'pin_columns_invalid',
    });
    expect(validate(row(snapshot()))).toMatchObject({ ok: false, reason: 'body_pin_invalid' });
    expect(validate(row({ ...body(), unrecognized: true }))).toMatchObject({
      ok: false,
      reason: 'snapshot_schema_invalid',
    });
    expect(
      validate(row({ ...body(), bidDefinition: { ...body().bidDefinition, headId: 'x' } })),
    ).toMatchObject({ ok: false, reason: 'body_pin_invalid' });
  });

  it('binds the requested session separately from matching row/body identities', () => {
    expect(
      validateBidDefinitionSnapshotPin({
        row: row(),
        expectedBidSessionId: 'another-session',
        version,
      }),
    ).toMatchObject({ ok: false, reason: 'snapshot_row_mismatch' });
  });

  it('retains shared member/date refinements and does not promote V1/V2 to pinned V3', () => {
    const duplicate = body();
    duplicate.members = [...duplicate.members, ...duplicate.members];
    expect(validate(row(duplicate))).toMatchObject({
      ok: false,
      reason: 'snapshot_schema_invalid',
    });
    expect(validate(row({ ...body(), credentialEvaluationOn: '2027-01-02' }))).toMatchObject({
      ok: false,
      reason: 'snapshot_schema_invalid',
    });
    for (const v of [1, 2] as const) {
      const legacy = {
        v,
        ruleBookVersion: version.ruleBookVersion,
        positionTemplateVersion: version.positionTemplateVersion,
        capturedAtMs: CAPTURED_AT,
        members: [],
        ...(v === 2
          ? {
              ruleBookRevision: version.ruleBookRevision,
              configurationRevision: 4,
              settings: snapshot().settings,
            }
          : {}),
      };
      expect(BidSessionPolicySnapshotSchema.safeParse(legacy).success).toBe(true);
      expect(validate(row({ ...legacy, bidDefinition: body().bidDefinition }))).toMatchObject({
        ok: false,
        reason: 'snapshot_schema_invalid',
      });
    }
  });

  it('retains legacy invalid-body and row-revision failures without requiring a version', () => {
    for (const snapshotJson of ['{', 'null', '[]', '{"v":3}']) {
      expect(validate({ ...row(snapshot()), ...legacyColumns, snapshotJson }, null)).toMatchObject({
        ok: false,
        code: 'session_policy_snapshot_invalid',
      });
    }
    expect(
      validate({ ...row(snapshot()), ...legacyColumns, ruleBookRevision: null }, null),
    ).toMatchObject({
      ok: false,
      code: 'session_policy_snapshot_invalid',
      reason: 'snapshot_row_mismatch',
    });
  });
});
