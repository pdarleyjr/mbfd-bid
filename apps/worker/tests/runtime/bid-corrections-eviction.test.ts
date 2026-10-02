import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  FrozenLiveBidPolicySchema,
  LiveBidActionSchema,
  type LiveBidCommand,
  type LiveBidCommandResult,
} from '@mbfd/shared';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import {
  commitLiveBidCommand,
  loadCanonicalBidSessionState,
} from '../../src/commands/canonical-command-service.js';
import { emptyBidSessionState } from '../../src/durable/bid-session-state.js';
import { mintPrintToken } from '../../src/exports/print-token.js';
import { app } from '../../src/index.js';
import { bidDefinitionContextHash } from '../../src/lib/bid-definition-context.js';
import { captureBidDefinitionSource } from '../../src/lib/bid-definition-source.js';
import { saveBidDefinition } from '../../src/lib/bid-definition-store.js';
import { loadBidDefinitionVersion } from '../../src/lib/bid-definition-version.js';
import { signJwt } from '../../src/lib/jwt.js';
import { loadCanonicalAmendmentLinks } from '../../src/lib/official-annual-completion.js';
import type { WorkerEnv } from '../../src/types/env.js';

const SESSION = 'synthetic-runtime-correction';
const MEMBERS = [100101, 100102] as const;
const POSITIONS = ['runtime-one', 'runtime-two', 'runtime-spare'] as const;
const NOW = Date.parse('2038-01-01T10:00:00.000Z');

async function seedFrozenSource(deferredSpecialty = false, sessionId = SESSION) {
  const year = deferredSpecialty ? 2039 : 2038;
  const versionTag = `${year}.1`;
  const policy = FrozenLiveBidPolicySchema.parse({
    v: 1,
    policyRevision: 'runtime-correction-v1',
    stages: [
      {
        id: 'ff',
        label: 'Synthetic Firefighters',
        order: 0,
        kind: 'FIREFIGHTER',
        memberIds: MEMBERS,
        opportunityPositionIds: POSITIONS,
      },
    ],
    dispositions: BidDispositionSchema.options.map((disposition) => ({
      disposition,
      advances: true,
      returns: false,
      returnStageId: null,
      retainsLaterSelectionRights: false,
      terminal: false,
      requiresReason: true,
      requiresEvidence: false,
      contactPolicyReference: null,
    })),
    actionPermissions: LiveBidActionSchema.options.map((action) => ({
      action,
      actorMemberIds: [MEMBERS[0]],
    })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
    annualOperations: {
      v: 1,
      stageOrder: ['ff'],
      requiredTopologyPositionIds: POSITIONS,
      ...(deferredSpecialty
        ? {
            specialties: [
              {
                id: 'runtime-specialty',
                label: 'Synthetic deferred specialty',
                mode: 'INTERRUPTING',
                opportunityPositionIds: ['runtime-one'],
                requiredCredentialNames: [],
                requiredSpecialtyCodes: [],
                points: [],
                tieBreakChain: ['POINTS', 'RSC_SENIORITY'],
                scoring: {
                  v: 1,
                  total: [],
                  so: [],
                  mo: [],
                  orderedPreference: {
                    mode: 'ORDERED_QUALIFICATIONS',
                    sourceRef: 'Synthetic qualification preference',
                    criteria: [{ credential: 'IAAI', alternatives: [], requiresAll: [] }],
                  },
                },
                rankingChannel: 'total',
              },
            ],
          }
        : {}),
      contact: { minimumAttempts: null, timingMode: 'OPERATOR_DISCRETION', durationSeconds: null },
      aDay: {
        combatGroups: ['G1', 'G2', 'G3', 'G4'],
        min: null,
        max: null,
        captainDcMax: null,
        specialtyMaximums: { MARINE_ASSIGNED: 1, MARINE_FLOAT: 1, DE: 1, SWAT: 1 },
        execution: {
          timing: 'SIMULTANEOUS',
          officersPerGroup: null,
          sourceRef: 'synthetic:runtime-correction',
          constraints: [
            {
              id: 'runtime-scope',
              label: 'Synthetic scoped A-Day maximum',
              sourceRef: 'synthetic:runtime-scope',
              maximum: 1,
              positionIds: POSITIONS,
              memberIds: [],
              ranks: [],
              shifts: ['A'],
            },
          ],
          ...(deferredSpecialty
            ? {
                timingExceptions: [
                  {
                    id: 'runtime-deferred',
                    label: 'Synthetic specialty ordinary-turn A-Day',
                    timing: 'AFTER_POSITION_SELECTION',
                    sourceRef: 'synthetic:runtime-deferred',
                    positionIds: ['runtime-one'],
                    profileIds: [],
                  },
                ],
              }
            : {}),
        },
      },
    },
  });
  const settings = {
    v: 3,
    expectedDurationDays: 2,
    turnTimerSeconds: 180,
    credentialEvaluationOn: '2038-01-01',
    personnelEvaluationOn: '2038-01-01',
    livePolicy: policy,
  };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO position_templates(version,effective_year) VALUES (?,?)').bind(
      versionTag,
      year,
    ),
    env.DB.prepare(
      "INSERT INTO rule_books(version,effective_year,status,revision) VALUES (?,?,'draft',1)",
    ).bind(versionTag, year),
    env.DB.prepare(
      "INSERT INTO bid_years(year,status,rule_book_version,position_template_version,configuration_revision,config_json) VALUES (?,'configuring',?,?,1,?)",
    ).bind(year, versionTag, versionTag, JSON.stringify(settings)),
    ...MEMBERS.map((id, index) =>
      env.DB.prepare(`INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,employment_status,created_at,updated_at)
      VALUES (?,?,'Synthetic','Runtime correction','FF','FF',?,?,0,'active',1,1) ON CONFLICT(id) DO NOTHING`).bind(
        id,
        `synthetic-runtime-${id}`,
        index + 1,
        index + 1,
      ),
    ),
    ...POSITIONS.map((id) =>
      env.DB.prepare(
        `INSERT INTO positions(id,template_version,shift,station,division,unit,rank_required,position_name) VALUES (?,?,'A','1','Combat','Synthetic Engine','FF',?)`,
      ).bind(id, versionTag, id),
    ),
    ...POSITIONS.map((id) =>
      env.DB.prepare(`INSERT INTO position_rules(rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
      VALUES (?,?,?,'{"rank":["FF"],"credentials":[],"custom":[]}','{"max":0,"items":[]}','["rsc_seniority"]')`).bind(
        versionTag,
        id,
        versionTag,
      ),
    ),
  ]);
  const captured = await captureBidDefinitionSource(env.DB, year);
  if (!captured.ok) throw new Error(JSON.stringify(captured));
  const saved = await saveBidDefinition(env.DB, {
    year,
    key: `${sessionId}-definition`,
    actorSubject: 'synthetic-runtime-100101',
    actorId: MEMBERS[0],
    expected: { kind: 'legacy', sourceToken: captured.sourceToken },
    reason: 'Isolated runtime correction fixture',
    intent: { operation: 'save', content: captured.content },
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  const version = await loadBidDefinitionVersion(env.DB, year, String(saved.response.versionId));
  if (!version.ok || version.content.settings?.v !== 3)
    throw new Error('Runtime frozen definition unavailable');
  const body = BidSessionPolicySnapshotSchema.parse({
    v: 3,
    ruleBookVersion: version.row.rule_book_version,
    ruleBookRevision: version.row.rule_book_revision,
    positionTemplateVersion: version.row.position_template_version,
    configurationRevision: version.row.version_number,
    settings: version.content.settings,
    credentialEvaluationOn: '2038-01-01',
    capturedAtMs: NOW,
    members: MEMBERS.map((memberId, index) => ({
      memberId,
      pool: 'FF',
      rscSeniority: index + 1,
      rankSeniority: index + 1,
      exclusionReason: null,
      authoritativeAssignmentId: null,
      rank: 'FF',
      isProbationary: false,
      credentialNames: deferredSpecialty && memberId === MEMBERS[1] ? ['IAAI'] : [],
      specialtyQualifications: [],
    })),
    ruleBookMaterial: {
      v: 1,
      rules: version.content.rules.map((rule) => ({
        positionId: rule.positionId,
        requiredCriteriaJson: rule.requiredCriteriaJson,
        pointsPreferenceJson: rule.pointsPreferenceJson,
        tieBreakChainJson: rule.tieBreakChainJson,
        ruleBookVersion: version.row.rule_book_version,
        templateVersion: version.row.position_template_version,
      })),
      positions: version.content.positions.map((position) => ({
        ...position,
        templateVersion: version.row.position_template_version,
        bidParticipation: 'BIDDABLE',
      })),
    },
  });
  if (body.v !== 3 || body.settings.v !== 3) throw new Error('Runtime snapshot must be V3');
  const snapshot = {
    ...body,
    bidDefinition: {
      v: 1,
      bidSessionId: sessionId,
      bidYear: year,
      versionId: version.row.id,
      versionSha256: version.sha256,
      contextSha256: bidDefinitionContextHash(body),
    },
  };
  const json = JSON.stringify(snapshot);
  await env.DB.prepare(`INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,is_mock,turn_timer_seconds,expected_duration_days,config_json)
    VALUES (?, ?,?,'position_bid',1,180,2,?)`)
    .bind(sessionId, year, NOW, JSON.stringify(body.settings))
    .run();
  await env.DB.prepare(`INSERT INTO bid_session_policy_snapshots(bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at,bid_version_id,bid_version_sha256,snapshot_sha256,context_sha256)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      sessionId,
      body.ruleBookVersion,
      body.positionTemplateVersion,
      body.ruleBookRevision,
      json,
      NOW,
      version.row.id,
      version.sha256,
      bytesToHex(sha256(json)),
      snapshot.bidDefinition.contextSha256,
    )
    .run();
  return { policy: body.settings.livePolicy, snapshotJson: json };
}

// Reserved test federation origin prevents any Hub request; DB and named DO
// remain the actual isolated Workers bindings from the stock runtime config.
const readbackEnv = () =>
  ({
    ...env,
    ENV: 'test',
    PORTAL_BASE_URL: 'https://test.invalid',
    PORTAL_WRITEBACK_ENABLED: 'false',
    PORTAL_BID_FEDERATION_TOKEN: 'synthetic-only',
  }) as unknown as WorkerEnv;

async function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: MEMBERS[0],
      hub_user_id: MEMBERS[0],
      member_id: MEMBERS[0],
      security_version: 1,
      emp: `synthetic-runtime-${MEMBERS[0]}`,
      role: 'admin',
      rank: 'FF',
      first_name: 'Synthetic',
      last_name: 'Runtime operator',
      fresh_auth_at: now,
      authz_checked_at: now,
    },
    env.JWT_SIGNING_KEY,
  );
}

async function persistedCorrectionRows() {
  const tables = [
    'canonical_bid_session_state',
    'bid_command_events',
    'bid_command_receipts',
    'audit_log',
    'bid_audit_outbox',
  ];
  return Promise.all(
    tables.map(
      async (table) =>
        (
          await env.DB.prepare(`SELECT * FROM ${table} WHERE bid_session_id=? ORDER BY rowid`)
            .bind(SESSION)
            .all()
        ).results,
    ),
  );
}

describe('audited corrections on actual Workers D1 and Durable Object runtime', () => {
  it(
    'reconstructs correction and revocation after eviction, replays exactly, and seals only the corrected final award',
    { timeout: 30_000 },
    async () => {
      const { policy, snapshotJson } = await seedFrozenSource();
      let counter = 0;
      const common = (seq: number) => ({
        v: 1 as const,
        commandId: `cccccccc-cccc-4ccc-accc-${String(++counter).padStart(12, '0')}`,
        bidSessionId: SESSION,
        expectedSeq: seq,
        actor: { id: MEMBERS[0], role: 'admin' as const },
        reason: 'Synthetic runtime correction',
        evidenceReference: null,
      });
      let initial = {
        ...emptyBidSessionState(SESSION),
        currentPhase: 'position_bid' as const,
        currentBidderId: MEMBERS[0] as number | null,
        bidOrder: MEMBERS.map((memberId, index) => ({
          memberId,
          ordinal: index + 1,
          pool: 'FF' as const,
          stageId: 'ff',
        })),
      };
      const sourceCommands: LiveBidCommand[] = [];
      for (const [index, memberId] of MEMBERS.entries()) {
        const command = {
          ...common(initial.lastSeq),
          type: 'live.record_selection',
          memberId,
          positionId: POSITIONS[index],
          aDay: index === 0 ? 'G1' : 'G2',
        } as LiveBidCommand;
        sourceCommands.push(command);
        const awarded = await commitLiveBidCommand({ db: env.DB, command, state: initial, policy });
        expect(awarded.result.kind).toBe('accepted');
        if (!awarded.canonicalState) throw new Error('Runtime canonical award missing');
        initial = awarded.canonicalState as typeof initial;
      }
      const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(SESSION));
      const send = async (command: LiveBidCommand) => {
        const response = await stub.fetch('https://do/admin/commands/live', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(command),
        });
        return response.json<LiveBidCommandResult>();
      };
      const original = initial.fills['runtime-one'];
      if (!original || !sourceCommands[0]) throw new Error('Runtime source award missing');
      const sourceEvents = (
        await env.DB.prepare('SELECT * FROM bid_command_events WHERE bid_session_id=? ORDER BY seq')
          .bind(SESSION)
          .all()
      ).results;
      const correction = {
        ...common(initial.lastSeq),
        type: 'live.correct_bid',
        memberId: MEMBERS[0],
        originalCommandId: sourceCommands[0].commandId,
        originalBidId: original.bidId,
        originalPositionId: 'runtime-one',
        originalADayCommandId: null,
        operation: 'REPLACE',
        replacement: { positionId: 'runtime-one', aDay: 'G3' },
      } as LiveBidCommand;
      for (const [override, code] of [
        [{ expectedSeq: 0 }, 'STALE_SEQUENCE'],
        [
          { originalCommandId: 'ffffffff-ffff-4fff-afff-ffffffffffff' },
          'CORRECTION_SOURCE_RECEIPT_INVALID',
        ],
        [{ replacement: { positionId: 'runtime-one', aDay: 'G2' } }, 'SCOPED_A_DAY_MAXIMUM'],
      ] as const) {
        expect(
          await send({
            ...correction,
            ...override,
            commandId: common(initial.lastSeq).commandId,
          } as LiveBidCommand),
        ).toMatchObject({ kind: 'rejected', code });
        expect(await loadCanonicalBidSessionState(env.DB, SESSION)).toEqual(initial);
      }
      const token = await adminToken();
      const beforePreview = await persistedCorrectionRows();
      const preview = await app.fetch(
        new Request(`http://x/api/admin/bid-session/${SESSION}/corrections/preview`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(correction),
        }),
        readbackEnv(),
      );
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({
        valid: true,
        expectedSeq: initial.lastSeq,
        before: { positionId: 'runtime-one' },
        after: { positionId: 'runtime-one', fill: { aDay: 'G3' } },
      });
      expect(await persistedCorrectionRows()).toEqual(beforePreview);
      const corrected = await send(correction);
      expect(corrected.kind).toBe('accepted');
      const beforeEviction = await loadCanonicalBidSessionState(env.DB, SESSION);
      let oldInstance: unknown;
      await runInDurableObject(stub, (instance) => {
        oldInstance = instance;
      });
      await evictDurableObject(stub);
      expect(await send(correction)).toEqual(corrected);
      await runInDurableObject(stub, (instance) => {
        expect(instance).not.toBe(oldInstance);
      });
      expect(await loadCanonicalBidSessionState(env.DB, SESSION)).toEqual(beforeEviction);
      const active = beforeEviction?.fills['runtime-one'];
      if (!active || !beforeEviction) throw new Error('Runtime corrected award missing');
      const revoke = {
        ...correction,
        ...common(beforeEviction.lastSeq),
        originalCommandId: correction.commandId,
        originalBidId: active.bidId,
        operation: 'REVOKE',
        replacement: null,
      } as LiveBidCommand;
      const revoked = await send(revoke);
      expect(revoked.kind).toBe('accepted');
      if (revoked.kind !== 'accepted') throw new Error('Runtime revocation rejected');
      await evictDurableObject(stub);
      expect(await send({ ...common(revoked.seq), type: 'live.complete_session' })).toMatchObject({
        kind: 'rejected',
        code: 'UNRESOLVED_CORRECTIONS_BLOCK_COMPLETION',
      });
      const revokedBidId = (revoked.envelope.payload as { bidId: string }).bidId;
      const restored = await send({
        ...correction,
        ...common(revoked.seq),
        originalCommandId: revoke.commandId,
        originalBidId: revokedBidId,
        replacement: { positionId: 'runtime-spare', aDay: 'G4' },
      } as LiveBidCommand);
      expect(restored.kind).toBe('accepted');
      if (restored.kind !== 'accepted') throw new Error('Runtime replacement rejected');
      const finalState = await loadCanonicalBidSessionState(env.DB, SESSION);
      expect(finalState?.fills['runtime-one']).toBeUndefined();
      expect(finalState?.fills['runtime-spare']).toMatchObject({
        memberId: MEMBERS[0],
        aDay: 'G4',
        ordinal: 1,
      });
      expect(finalState?.aDay?.picks.find((pick) => pick.memberId === MEMBERS[0])?.aDay).toBe('G4');
      expect(await loadCanonicalAmendmentLinks(env.DB, SESSION)).toHaveLength(3);
      expect(
        (
          await env.DB.prepare(
            'SELECT * FROM bid_command_events WHERE bid_session_id=? ORDER BY seq LIMIT 2',
          )
            .bind(SESSION)
            .all()
        ).results,
      ).toEqual(sourceEvents);
      expect(
        (
          await env.DB.prepare(
            'SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?',
          )
            .bind(SESSION)
            .first<{ snapshot_json: string }>()
        )?.snapshot_json,
      ).toBe(snapshotJson);
      expect(await send({ ...common(restored.seq), type: 'live.complete_session' })).toMatchObject({
        kind: 'accepted',
      });
      const sealed = await loadCanonicalBidSessionState(env.DB, SESSION);
      const results = await app.fetch(
        new Request(`http://x/api/admin/bid-session/${SESSION}/results`, {
          headers: { authorization: `Bearer ${token}` },
        }),
        readbackEnv(),
      );
      expect(results.status).toBe(200);
      const awards = (
        await results.json<{
          awards: Array<{
            memberId: number;
            positionId: string;
            aDay: string;
            correctionLineage: unknown[];
          }>;
        }>()
      ).awards;
      expect(awards.find((award) => award.memberId === MEMBERS[0])).toMatchObject({
        positionId: 'runtime-spare',
        aDay: 'G4',
        correctionLineage: [
          { originalBidId: original.bidId },
          { after: null, replacementBidId: null },
          { after: { positionId: 'runtime-spare' } },
        ],
      });
      expect(awards.some((award) => award.positionId === 'runtime-one')).toBe(false);
      const printToken = mintPrintToken(
        { kind: 'roster', shift: 'A', session_id: SESSION },
        env.JWT_SIGNING_KEY,
      );
      const roster = await app.fetch(
        new Request(
          `http://x/api/admin/exports/roster-data?session_id=${SESSION}&shift=A&token=${printToken}`,
        ),
        readbackEnv(),
      );
      expect(roster.status).toBe(200);
      const rows = (
        await roster.json<{
          stations: Array<{
            rows: Array<{ position_id: string; member_id: string | null; a_day: string | null }>;
          }>;
        }>()
      ).stations.flatMap((station) => station.rows);
      expect(rows.find((row) => row.position_id === 'runtime-one')?.member_id).toBeNull();
      expect(rows.find((row) => row.position_id === 'runtime-spare')).toMatchObject({
        a_day: 'G4',
      });
      expect(
        await send({
          ...correction,
          ...common(sealed?.lastSeq ?? 0),
          originalCommandId: (restored as Extract<LiveBidCommandResult, { kind: 'accepted' }>)
            .commandId,
          originalBidId: finalState?.fills['runtime-spare']?.bidId ?? '',
          originalPositionId: 'runtime-spare',
        } as LiveBidCommand),
      ).toMatchObject({ kind: 'rejected', code: 'ANNUAL_COMPLETION_SEALED' });
    },
  );
  it(
    'keeps an early specialty winner in ordinary A-Day order and corrects the later pick using its exact receipt after eviction',
    { timeout: 30_000 },
    async () => {
      const SESSION = 'synthetic-runtime-correction-early';
      const { policy, snapshotJson } = await seedFrozenSource(true, SESSION);
      let counter = 0;
      const common = (seq: number) => ({
        v: 1 as const,
        commandId: `dddddddd-dddd-4ddd-addd-${String(++counter).padStart(12, '0')}`,
        bidSessionId: SESSION,
        expectedSeq: seq,
        actor: { id: MEMBERS[0], role: 'admin' as const },
        reason: 'Synthetic early specialty correction',
        evidenceReference: null,
      });
      let initial = {
        ...emptyBidSessionState(SESSION),
        currentPhase: 'position_bid' as const,
        currentBidderId: MEMBERS[0] as number | null,
        bidOrder: MEMBERS.map((memberId, index) => ({
          memberId,
          ordinal: index + 1,
          pool: 'FF' as const,
          stageId: 'ff',
        })),
      };
      const requestCommand: LiveBidCommand = {
        ...common(0),
        type: 'live.start_specialty_adjudication',
        specialtyId: 'runtime-specialty',
        positionId: 'runtime-one',
        candidateMemberIds: [MEMBERS[1]],
      };
      const awardCommand: LiveBidCommand = {
        ...common(1),
        type: 'live.resolve_specialty_candidate',
        memberId: MEMBERS[1],
        outcome: 'ACCEPT',
      };
      for (const command of [requestCommand, awardCommand]) {
        const applied = await commitLiveBidCommand({ db: env.DB, state: initial, command, policy });
        expect(applied.result.kind, JSON.stringify(applied.result)).toBe('accepted');
        if (!applied.canonicalState) throw new Error('Runtime early specialty award missing');
        initial = applied.canonicalState as typeof initial;
      }
      const original = initial.fills['runtime-one'];
      if (!original) throw new Error('Runtime early source award missing');
      const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(SESSION));
      const send = async (command: LiveBidCommand) =>
        (
          await stub.fetch('https://do/admin/commands/live', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(command),
          })
        ).json<LiveBidCommandResult>();
      const earlyCorrection = {
        ...common(initial.lastSeq),
        type: 'live.correct_bid',
        memberId: MEMBERS[1],
        originalCommandId: awardCommand.commandId,
        originalBidId: original.bidId,
        originalPositionId: 'runtime-one',
        originalADayCommandId: null,
        operation: 'REPLACE',
        replacement: { positionId: 'runtime-one', aDay: null },
      } as LiveBidCommand;
      expect(
        await send({
          ...earlyCorrection,
          commandId: common(initial.lastSeq).commandId,
          replacement: { positionId: 'runtime-one', aDay: 'G3' },
        } as LiveBidCommand),
      ).toMatchObject({ kind: 'rejected', code: 'CORRECTION_ORDINARY_A_DAY_NOT_REACHED' });
      expect(await loadCanonicalBidSessionState(env.DB, SESSION)).toEqual(initial);
      const acceptedEarly = await send(earlyCorrection);
      expect(acceptedEarly.kind, JSON.stringify(acceptedEarly)).toBe('accepted');
      if (acceptedEarly.kind !== 'accepted') throw new Error('Runtime early correction rejected');
      await evictDurableObject(stub);
      expect(await send(earlyCorrection)).toEqual(acceptedEarly);
      const beforeOrdinary = await loadCanonicalBidSessionState(env.DB, SESSION);
      expect(beforeOrdinary).toMatchObject({ queueCursor: 0, currentBidderId: MEMBERS[0] });
      expect(beforeOrdinary?.bidOrder).toEqual(initial.bidOrder);
      expect(
        beforeOrdinary?.aDay?.picks.some((pick) => pick.memberId === MEMBERS[1]) ?? false,
      ).toBe(false);
      const ordinary = await send({
        ...common(acceptedEarly.seq),
        type: 'live.record_selection',
        memberId: MEMBERS[0],
        positionId: 'runtime-two',
        aDay: 'G1',
      });
      expect(ordinary.kind, JSON.stringify(ordinary)).toBe('accepted');
      if (ordinary.kind !== 'accepted')
        throw new Error('Runtime original ordinary bidder rejected');
      expect(await loadCanonicalBidSessionState(env.DB, SESSION)).toMatchObject({
        currentPhase: 'a_day_bid',
        currentBidderId: MEMBERS[1],
        queueCursor: 1,
      });
      const aDayCommand: LiveBidCommand = {
        ...common(ordinary.seq),
        type: 'live.record_a_day',
        memberId: MEMBERS[1],
        aDay: 'G2',
      };
      const picked = await send(aDayCommand);
      expect(picked.kind, JSON.stringify(picked)).toBe('accepted');
      if (picked.kind !== 'accepted') throw new Error('Runtime deferred A-Day rejected');
      const beforeCorrection = await loadCanonicalBidSessionState(env.DB, SESSION);
      const active = beforeCorrection?.fills['runtime-one'];
      if (!active) throw new Error('Runtime deferred active award missing');
      const correction = {
        ...earlyCorrection,
        ...common(picked.seq),
        originalCommandId: earlyCorrection.commandId,
        originalBidId: active.bidId,
        replacement: { positionId: 'runtime-one', aDay: 'G3' },
      } as LiveBidCommand;
      expect(await send(correction)).toMatchObject({
        kind: 'rejected',
        code: 'CORRECTION_A_DAY_RECEIPT_REQUIRED',
      });
      expect(await loadCanonicalBidSessionState(env.DB, SESSION)).toEqual(beforeCorrection);
      const receiptBound = {
        ...correction,
        commandId: common(picked.seq).commandId,
        originalADayCommandId: aDayCommand.commandId,
      };
      const corrected = await send(receiptBound);
      expect(corrected.kind, JSON.stringify(corrected)).toBe('accepted');
      await evictDurableObject(stub);
      expect(await send(receiptBound)).toEqual(corrected);
      const final = await loadCanonicalBidSessionState(env.DB, SESSION);
      expect(final?.aDay?.picks.find((pick) => pick.memberId === MEMBERS[1])).toMatchObject({
        aDay: 'G3',
      });
      expect(final?.live?.corrections?.at(-1)?.specialtyRequest).toMatchObject({
        requesterMemberId: MEMBERS[0],
        requestCommandId: requestCommand.commandId,
        positionId: 'runtime-one',
      });
      expect(
        (
          await env.DB.prepare(
            'SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id=?',
          )
            .bind(SESSION)
            .first<{ snapshot_json: string }>()
        )?.snapshot_json,
      ).toBe(snapshotJson);
    },
  );
});
