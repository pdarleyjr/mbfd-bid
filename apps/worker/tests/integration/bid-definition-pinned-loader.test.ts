import { deepStrictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { type BidSessionPolicySnapshot, BidSessionPolicySnapshotSchema } from '@mbfd/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import type { PinnedBidSessionPolicySnapshot } from '../../src/lib/bid-definition-pin.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import {
  loadBidSessionPolicySnapshot,
  loadFrozenSessionBidPolicy,
} from '../../src/lib/bid-policy.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

type Snapshot = Extract<BidSessionPolicySnapshot, { v: 3 }>;
type StoredVersion = Extract<Awaited<ReturnType<typeof loadBidDefinitionVersion>>, { ok: true }>;
const CAPTURED_AT = Date.parse('2027-01-01T10:00:00.000Z');
const SESSION = 'synthetic-pinned-session';
const digest = (serialized: string) =>
  createHash('sha256').update(serialized, 'utf8').digest('hex');

// Complete synthetic V3 material; V2 settings exercise a Mock-capable definition.
// These fixtures make no assertion of Live readiness or accepted Department facts.
function contextSnapshot(): Snapshot {
  const parsed = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: '2027.1',
    ruleBookRevision: 0,
    positionTemplateVersion: '2027.1',
    configurationRevision: 1,
    settings: {
      v: 2,
      expectedDurationDays: 2,
      turnTimerSeconds: 180,
      credentialEvaluationOn: '2027-01-01',
      personnelEvaluationOn: '2027-01-01',
    },
    credentialEvaluationOn: '2027-01-01',
    capturedAtMs: CAPTURED_AT,
    members: [
      {
        memberId: 10001,
        pool: 'FF',
        rscSeniority: 1,
        rankSeniority: 1,
        exclusionReason: null,
        authoritativeAssignmentId: null,
        rank: 'FF',
        isProbationary: false,
        credentialNames: ['Synthetic A', 'Synthetic B'],
      },
    ],
    ruleBookMaterial: {
      v: 1,
      rules: [
        {
          ruleBookVersion: '2027.1',
          templateVersion: '2027.1',
          positionId: 'synthetic-pinned-seat',
          requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
          pointsPreferenceJson: '{"max":0,"items":[]}',
          tieBreakChainJson: '["rsc_seniority"]',
        },
      ],
      positions: [
        {
          id: 'synthetic-pinned-seat',
          templateVersion: '2027.1',
          shift: 'A',
          station: '7',
          division: 'Combat',
          unit: 'Synthetic Engine',
          rankRequired: 'FF',
          positionName: 'Synthetic firefighter',
          isFloating: false,
          isVacantByDesign: false,
          isExcludedFromCount: false,
          bidParticipation: 'BIDDABLE',
        },
      ],
    },
  });
  if (parsed.v !== 3) throw new Error('Synthetic V3 fixture required');
  return parsed;
}

describe('stored Bid version snapshot loader integrity', () => {
  let h: TestD1;
  let version: StoredVersion;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.pragma('foreign_keys = ON');
    h.sqlite.exec(`
      INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,created_at,updated_at)
        VALUES (10001,'synthetic-pinned-editor','Synthetic','Editor','FF','FF',1,1,1);
      INSERT INTO position_templates (version,effective_year,notes) VALUES ('2027.1',2027,'Synthetic topology');
      INSERT INTO rule_books (version,effective_year,status,revision,notes) VALUES ('2027.1',2027,'draft',4,'Synthetic source');
      INSERT INTO bid_years (year,status,rule_book_version,position_template_version,configuration_revision,config_json)
        VALUES (2027,'configuring','2027.1','2027.1',3,'{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-01","personnelEvaluationOn":"2027-01-01"}');
      INSERT INTO positions (id,template_version,shift,station,division,unit,rank_required,position_name)
        VALUES ('synthetic-pinned-seat','2027.1','A','7','Combat','Synthetic Engine','FF','Synthetic firefighter');
      INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
        VALUES ('2027.1','synthetic-pinned-seat','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
          '{"max":0,"items":[]}','["rsc_seniority"]');
    `);
    const captured = await captureBidDefinitionSource(h.env.DB, 2027);
    if (!captured.ok) throw new Error(JSON.stringify(captured));
    const saved = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-pin-adoption',
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'legacy', sourceToken: captured.sourceToken },
      reason: 'Synthetic snapshot pin adoption',
      intent: { operation: 'save', content: captured.content },
    });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const loaded = await loadBidDefinitionVersion(h.env.DB, 2027, String(saved.response.versionId));
    if (!loaded.ok) throw new Error(JSON.stringify(loaded));
    version = loaded;
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });

  function pinnedSnapshot(): PinnedBidSessionPolicySnapshot {
    if (version.content.settings?.v !== 2) throw new Error('Synthetic V2 configuration required');
    const participation = new Map(
      version.content.participation.map((entry) => [entry.positionId, entry.bidParticipation]),
    );
    const base: Snapshot = {
      ...contextSnapshot(),
      ruleBookVersion: version.row.rule_book_version,
      ruleBookRevision: version.row.rule_book_revision,
      positionTemplateVersion: version.row.position_template_version,
      configurationRevision: version.row.version_number,
      settings: structuredClone(version.content.settings),
      credentialEvaluationOn: version.content.settings.credentialEvaluationOn,
      ruleBookMaterial: {
        v: 1,
        rules: version.content.rules.map((rule) => ({
          positionId: rule.positionId,
          ruleBookVersion: version.row.rule_book_version,
          templateVersion: version.row.position_template_version,
          requiredCriteriaJson: rule.requiredCriteriaJson,
          pointsPreferenceJson: rule.pointsPreferenceJson,
          tieBreakChainJson: rule.tieBreakChainJson,
        })),
        positions: version.content.positions.map((position) => ({
          ...position,
          templateVersion: version.row.position_template_version,
          bidParticipation: participation.get(position.id) ?? 'BIDDABLE',
        })),
      },
    };
    expect(BidSessionPolicySnapshotSchema.safeParse(base).success).toBe(true);
    return {
      ...base,
      bidDefinition: {
        v: 1,
        bidSessionId: SESSION,
        bidYear: 2027,
        versionId: version.row.id,
        versionSha256: version.sha256,
        contextSha256: bidDefinitionContextHash(base),
      },
    };
  }

  function insertSnapshot(
    body: PinnedBidSessionPolicySnapshot,
    columns: Partial<{
      bidVersionId: string | null;
      bidVersionSha256: string | null;
      snapshotSha256: string | null;
      contextSha256: string | null;
      snapshotJson: string;
    }> = {},
  ) {
    const stored = {
      bidVersionId: version.row.id,
      bidVersionSha256: version.sha256,
      snapshotJson: JSON.stringify(body),
      snapshotSha256: digest(JSON.stringify(body)),
      contextSha256: body.bidDefinition.contextSha256,
      ...columns,
    };
    h.sqlite
      .prepare(`INSERT INTO bid_sessions
        (id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
        VALUES (?,2027,?,'not_started',1,?,?,?)`)
      .run(
        SESSION,
        CAPTURED_AT,
        body.settings.turnTimerSeconds,
        body.settings.expectedDurationDays,
        JSON.stringify(body.settings),
      );
    h.sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots
        (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,
         bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(
        SESSION,
        version.row.rule_book_version,
        version.row.position_template_version,
        version.row.rule_book_revision,
        stored.snapshotJson,
        body.capturedAtMs,
        stored.bidVersionId,
        stored.bidVersionSha256,
        stored.snapshotSha256,
        stored.contextSha256,
      );
  }

  async function rejectRead() {
    const bytes = h.sqlite.serialize();
    expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual({
      snapshot: null,
      error: 'invalid',
    });
    expect(await loadFrozenSessionBidPolicy(getDb(h.env.DB), SESSION)).toEqual({
      ok: false,
      code: 'session_policy_snapshot_invalid',
    });
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  }

  function bypassPinInsertGuards() {
    // Corrupt-row simulation only. Keep every legacy UPDATE immutability guard,
    // all FKs, all version seals, and 0060 replacement/delete guards intact.
    h.sqlite.exec(`
      DROP TRIGGER bid_session_policy_snapshots_pin_required;
      DROP TRIGGER bid_session_policy_snapshots_pin_identity;
    `);
  }

  it('loads the original version and exact snapshot after a different head is saved', async () => {
    const body = pinnedSnapshot();
    insertSnapshot(body);
    const original = h.sqlite.prepare('SELECT * FROM bid_session_policy_snapshots').all();
    const firstRead = await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION);
    expect(firstRead).toEqual({ snapshot: body, error: null });
    const successor = await saveBidDefinition(h.env.DB, {
      year: 2027,
      key: 'synthetic-next-policy',
      actorSubject: 'synthetic-editor',
      actorId: 10001,
      expected: { kind: 'version', versionId: version.row.id, revision: 1, sha256: version.sha256 },
      reason: 'Synthetic next version changes future settings',
      intent: {
        operation: 'save',
        content: {
          ...version.content,
          settings: { ...version.content.settings, turnTimerSeconds: 240 },
        },
      },
    });
    if (!successor.ok) throw new Error(JSON.stringify(successor));
    expect(successor.response).toMatchObject({ changed: true, versionNumber: 2 });
    expect(successor.response.versionId).not.toBe(version.row.id);
    const bytes = h.sqlite.serialize();
    expect(await loadBidSessionPolicySnapshot(getDb(h.env.DB), SESSION)).toEqual(firstRead);
    const frozen = await loadFrozenSessionBidPolicy(getDb(h.env.DB), SESSION);
    expect(frozen).toMatchObject({ ok: true, snapshot: body, coverage: { valid: true } });
    expect(h.sqlite.prepare('SELECT * FROM bid_session_policy_snapshots').all()).toEqual(original);
    deepStrictEqual(h.sqlite.serialize(), bytes);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects changed snapshot bytes with an unchanged exact-byte digest', async () => {
    const body = pinnedSnapshot();
    insertSnapshot(body, { snapshotJson: `${JSON.stringify(body, null, 2)}\n` });
    await rejectRead();
  });

  it.each(['settings', 'rules', 'positions', 'configuration-revision'] as const)(
    'rejects changed version-owned %s even after the snapshot digest is recomputed',
    async (kind) => {
      const body = pinnedSnapshot();
      if (kind === 'settings') body.settings.turnTimerSeconds = 240;
      if (kind === 'configuration-revision') body.configurationRevision++;
      if (kind === 'rules') {
        body.ruleBookMaterial.rules = body.ruleBookMaterial.rules.map((rule) => ({
          ...rule,
          requiredCriteriaJson:
            '{"rank":["FF"],"credentials":["Synthetic added requirement"],"custom":[]}',
        }));
      }
      if (kind === 'positions') {
        body.ruleBookMaterial.positions = body.ruleBookMaterial.positions.map((position) => ({
          ...position,
          positionName: 'Synthetic altered position',
        }));
      }
      // Context remains the same: these cases must reach immutable material comparison.
      expect(bidDefinitionContextHash(body)).toBe(body.bidDefinition.contextSha256);
      insertSnapshot(body);
      await rejectRead();
    },
  );

  it.each(['member', 'optional-evidence', 'mock-participation'] as const)(
    'rejects changed %s context even after the snapshot digest is recomputed',
    async (kind) => {
      const body = pinnedSnapshot();
      if (kind === 'member') {
        body.members = body.members.map((member) => ({
          ...member,
          credentialNames: [...member.credentialNames, 'Synthetic altered qualification'],
        }));
      }
      if (kind === 'optional-evidence') body.authoringCredentialNames = [];
      if (kind === 'mock-participation') {
        body.members = body.members.map((member) => ({
          ...member,
          mockParticipationEvidence: 'ACCEPTED_STAFFING_BASELINE',
        }));
      }
      expect(bidDefinitionContextHash(body)).not.toBe(body.bidDefinition.contextSha256);
      insertSnapshot(body);
      await rejectRead();
    },
  );

  it.each(['bidVersionId', 'bidVersionSha256', 'snapshotSha256', 'contextSha256'] as const)(
    'rejects an isolated corrupt row missing %s with only 0060 insert guards bypassed',
    async (field) => {
      bypassPinInsertGuards();
      insertSnapshot(pinnedSnapshot(), { [field]: null });
      await rejectRead();
    },
  );

  it('rejects unverified body provenance in an all-NULL legacy row', async () => {
    bypassPinInsertGuards();
    insertSnapshot(pinnedSnapshot(), {
      bidVersionId: null,
      bidVersionSha256: null,
      snapshotSha256: null,
      contextSha256: null,
    });
    await rejectRead();
  });
});

describe('frozen Bid context identity properties', () => {
  it('excludes capture milliseconds and minted aliases without mutating the snapshot', () => {
    const original = contextSnapshot();
    const before = JSON.stringify(original);
    const changed = structuredClone(original);
    changed.capturedAtMs += 86_400_000 + 1234;
    changed.ruleBookVersion = '2027.91';
    changed.ruleBookRevision = 98;
    changed.positionTemplateVersion = '2027.92';
    changed.configurationRevision = 99;
    changed.ruleBookMaterial.rules = changed.ruleBookMaterial.rules.map((rule) => ({
      ...rule,
      ruleBookVersion: changed.ruleBookVersion,
      templateVersion: changed.positionTemplateVersion,
    }));
    changed.ruleBookMaterial.positions = changed.ruleBookMaterial.positions.map((position) => ({
      ...position,
      templateVersion: changed.positionTemplateVersion,
    }));
    expect(BidSessionPolicySnapshotSchema.safeParse(changed).success).toBe(true);
    expect(bidDefinitionContextHash(changed)).toBe(bidDefinitionContextHash(original));
    expect(JSON.stringify(original)).toBe(before);
  });

  it('retains a fallback evaluation DATE while excluding milliseconds within that date', () => {
    const original = contextSnapshot();
    if (original.settings.v === 1) throw new Error('Synthetic dated settings required');
    const { personnelEvaluationOn: _omitted, ...settingsWithoutPersonnelDate } = original.settings;
    original.settings = settingsWithoutPersonnelDate;
    expect(bidDefinitionContextHash({ ...original, capturedAtMs: CAPTURED_AT + 1234 })).toBe(
      bidDefinitionContextHash(original),
    );
    expect(
      bidDefinitionContextHash({ ...original, capturedAtMs: CAPTURED_AT + 86_400_000 }),
    ).not.toBe(bidDefinitionContextHash(original));
  });

  it.each(['personnel', 'credential'] as const)(
    'retains the explicit %s evaluation date',
    (kind) => {
      const original = contextSnapshot();
      const changed = structuredClone(original);
      if (changed.settings.v === 1) throw new Error('Synthetic dated settings required');
      if (kind === 'personnel') changed.settings.personnelEvaluationOn = '2027-01-02';
      if (kind === 'credential') {
        changed.settings.credentialEvaluationOn = '2027-01-02';
        changed.credentialEvaluationOn = '2027-01-02';
      }
      expect(BidSessionPolicySnapshotSchema.safeParse(changed).success).toBe(true);
      expect(bidDefinitionContextHash(changed)).not.toBe(bidDefinitionContextHash(original));
    },
  );

  it.each(['authoringCredentialNames', 'tenureEvidence', 'operatorIdentityProjection'] as const)(
    'keeps absent %s distinct from an explicitly empty collection',
    (field) => {
      const original = contextSnapshot();
      const explicit = { ...original, [field]: [] };
      expect(original).not.toHaveProperty(field);
      expect(BidSessionPolicySnapshotSchema.safeParse(explicit).success).toBe(true);
      expect(bidDefinitionContextHash(explicit)).not.toBe(bidDefinitionContextHash(original));
    },
  );

  it.each(['serviceCredits', 'specialtyQualifications'] as const)(
    'keeps absent member %s distinct from explicit empty evidence',
    (field) => {
      const original = contextSnapshot();
      const explicit = {
        ...original,
        members: original.members.map((member) => ({ ...member, [field]: [] })),
      };
      expect(BidSessionPolicySnapshotSchema.safeParse(explicit).success).toBe(true);
      expect(bidDefinitionContextHash(explicit)).not.toBe(bidDefinitionContextHash(original));
    },
  );

  it('keeps Mock-only participation evidence significant', () => {
    const original = contextSnapshot();
    const concession: Snapshot = {
      ...original,
      members: original.members.map((member) => ({
        ...member,
        mockParticipationEvidence: 'ACCEPTED_STAFFING_BASELINE',
      })),
    };
    expect(BidSessionPolicySnapshotSchema.safeParse(concession).success).toBe(true);
    expect(bidDefinitionContextHash(concession)).not.toBe(bidDefinitionContextHash(original));
  });

  it('treats credential/member sets consistently while preserving their original arrays', () => {
    const original = contextSnapshot();
    const first = original.members[0];
    if (!first) throw new Error('Synthetic member required');
    original.members.push({ ...first, memberId: 10002, rscSeniority: 2, rankSeniority: 2 });
    original.authoringCredentialNames = ['Synthetic A', 'Synthetic B'];
    const before = JSON.stringify(original);
    const changed = structuredClone(original);
    changed.members.reverse();
    changed.authoringCredentialNames?.reverse();
    for (const member of changed.members) member.credentialNames.reverse();
    expect(bidDefinitionContextHash(changed)).toBe(bidDefinitionContextHash(original));
    expect(JSON.stringify(original)).toBe(before);
  });
});
