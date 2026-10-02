import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { type BidDefinitionContent, BidEvaluationSchema } from '@mbfd/shared';
import { expect, it } from 'vitest';
import { loadCanonicalBidSessionState } from '../../src/commands/canonical-command-service.js';
import { getDb } from '../../src/db/index.js';
import {
  type BidDefinitionVersionRow,
  loadBidDefinitionVersion,
} from '../../src/lib/bid-definition-version.js';
import { decodeBidEvidenceDocument } from '../../src/lib/bid-evidence-storage.js';
import { loadFrozenSessionBidPolicy } from '../../src/lib/bid-policy.js';
import { signJwt } from '../../src/lib/jwt.js';
import type { WorkerEnv } from '../../src/types/env.js';

const privateEnv = env as unknown as WorkerEnv & { ORIGINAL_RETAINED_SOURCE?: string };

// Exact historical rows and original employee identifiers stay in private
// runtime bindings. No historical lineage, qualification, or session outcome
// is invented, and no employee-ID rule is rerun against renamed identifiers.
it.skipIf(!privateEnv.ORIGINAL_RETAINED_SOURCE)(
  'prepares the exact retained-source successor through actual HTTP, D1 and DO',
  async () => {
    if (!privateEnv.ORIGINAL_RETAINED_SOURCE) throw new Error('Private original source required');
    const input = JSON.parse(privateEnv.ORIGINAL_RETAINED_SOURCE) as {
      versions: BidDefinitionVersionRow[];
      packet: { version: BidDefinitionVersionRow; freeze: Record<string, unknown> };
      saveBody: { content: BidDefinitionContent; expected: unknown; reason: string };
      staffingRows: Record<string, unknown>[];
      policyDocuments: Record<string, unknown>[];
    };
    const freeze = input.packet.freeze;
    const original = BidEvaluationSchema.parse(
      JSON.parse(decodeBidEvidenceDocument(String(freeze.evaluation_json))),
    );
    const personnel = JSON.parse(decodeBidEvidenceDocument(String(freeze.personnel_source_json)));
    const allGrants =
      input.saveBody.content.policy?.executionPolicy.actionPermissions.map(
        (permission) => new Set(permission.actorMemberIds),
      ) ?? [];
    const actor = [...(allGrants[0] ?? [])].find((id) => allGrants.every((grant) => grant.has(id)));
    const actorRow = personnel.memberRows.find((member: { id: number }) => member.id === actor);
    if (actor === undefined || !actorRow) throw new Error('Original reviewed operator required');
    expect(input.versions.map((version) => version.version_number)).toEqual(
      Array.from({ length: 11 }, (_, index) => index + 1),
    );
    expect(input.versions.at(-1)?.id).toBe(input.packet.version.id);

    // Restore captured source projections into a pristine owned database.
    // Their complete qualification and assignment authority remains in the
    // original immutable compressed freeze, which production readers verify.
    await privateEnv.DB.prepare(`INSERT INTO members
        (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,rank_seniority,is_probationary,
         employment_status,employment_status_effective_on,separation_type,created_at,updated_at)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.employeeId'),json_extract(value,'$.firstName'),json_extract(value,'$.lastName'),
          json_extract(value,'$.rank'),json_extract(value,'$.bidCategory'),json_extract(value,'$.rscSeniority'),json_extract(value,'$.rankSeniority'),
          json_extract(value,'$.isProbationary'),json_extract(value,'$.employmentStatus'),json_extract(value,'$.employmentStatusEffectiveOn'),
          json_extract(value,'$.separationType'),1,1 FROM json_each(?)`)
      .bind(JSON.stringify(personnel.memberRows))
      .run();
    await privateEnv.DB.prepare(
      'INSERT INTO credentials(id,name) SELECT 810001+CAST(key AS INTEGER),value FROM json_each(?)',
    )
      .bind(JSON.stringify(original.authoringCredentialNames ?? []))
      .run();
    for (const row of input.staffingRows) {
      const columns = Object.keys(row);
      if (columns.some((column) => !/^[a-z_]+$/.test(column)))
        throw new Error('Private source column invalid');
      await privateEnv.DB.prepare(
        `INSERT INTO staffing_positions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
        .bind(...Object.values(row))
        .run();
    }
    for (const version of input.versions) {
      const content = JSON.parse(version.content_json) as BidDefinitionContent;
      const statements = [
        privateEnv.DB.prepare(
          'INSERT INTO position_templates(version,effective_year,notes) VALUES (?,?,?)',
        ).bind(version.position_template_version, 2026, content.notes.positions),
        privateEnv.DB.prepare(
          "INSERT INTO rule_books(version,effective_year,status,revision,notes) VALUES (?,2026,'draft',?,?)",
        ).bind(version.rule_book_version, version.rule_book_revision, content.notes.bid),
        privateEnv.DB.prepare(`INSERT INTO positions
          (id,template_version,shift,station,division,unit,rank_required,position_name,is_floating,is_vacant_by_design,is_excluded_from_count)
          SELECT json_extract(value,'$.id'),?,json_extract(value,'$.shift'),json_extract(value,'$.station'),json_extract(value,'$.division'),
            json_extract(value,'$.unit'),json_extract(value,'$.rankRequired'),json_extract(value,'$.positionName'),json_extract(value,'$.isFloating'),
            json_extract(value,'$.isVacantByDesign'),json_extract(value,'$.isExcludedFromCount') FROM json_each(?,'$.positions')`).bind(
          version.position_template_version,
          version.content_json,
        ),
        privateEnv.DB.prepare(`INSERT INTO position_rules (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain,notes)
          SELECT ?,json_extract(value,'$.positionId'),?,json_extract(value,'$.requiredCriteriaJson'),json_extract(value,'$.pointsPreferenceJson'),
            json_extract(value,'$.tieBreakChainJson'),json_extract(value,'$.notes') FROM json_each(?,'$.rules')`).bind(
          version.rule_book_version,
          version.position_template_version,
          version.content_json,
        ),
        privateEnv.DB.prepare(`INSERT INTO rule_book_position_participation (rule_book_version,position_id,template_version,bid_participation,authoritative_source_ref,created_at)
          SELECT ?,json_extract(value,'$.positionId'),?,json_extract(value,'$.bidParticipation'),json_extract(value,'$.authoritativeSourceRef'),1
          FROM json_each(?,'$.participation')`).bind(
          version.rule_book_version,
          version.position_template_version,
          version.content_json,
        ),
        privateEnv.DB.prepare(`INSERT INTO position_staffing_bindings (position_id,template_version,staffing_position_id,authoritative_source_ref,review_status,created_at)
          SELECT json_extract(value,'$.positionId'),?,json_extract(value,'$.staffingPositionId'),json_extract(value,'$.authoritativeSourceRef'),json_extract(value,'$.reviewStatus'),1
          FROM json_each(?,'$.staffingBindings')`).bind(
          version.position_template_version,
          version.content_json,
        ),
      ];
      if (content.policy && version.policy_document_id) {
        const document = input.policyDocuments.find((row) => row.id === version.policy_document_id);
        if (!document) throw new Error('Original backing policy document missing');
        const columns = Object.keys(document);
        if (columns.some((column) => !/^[a-z_]+$/.test(column)))
          throw new Error('Private policy column invalid');
        statements.push(
          privateEnv.DB.prepare(
            `INSERT INTO annual_bid_policy_documents (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
          ).bind(...Object.values(document)),
        );
      }
      const versionColumns = [
        'id',
        'bid_year',
        'version_number',
        'schema_version',
        'content_json',
        'content_sha256',
        'origin_json',
        'rule_book_version',
        'rule_book_revision',
        'position_template_version',
        'policy_document_id',
        'predecessor_id',
        'restored_from_id',
        'actor_subject',
        'reason',
        'created_at',
      ] as const;
      statements.push(
        privateEnv.DB.prepare(`INSERT INTO bid_definition_versions
        (id,bid_year,version_number,schema_version,content_json,content_sha256,origin_json,rule_book_version,rule_book_revision,
         position_template_version,policy_document_id,predecessor_id,restored_from_id,actor_subject,reason,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
          ...versionColumns.map((column) => version[column]),
        ),
      );
      statements.push(
        version.version_number === 1
          ? privateEnv.DB.prepare(
              'INSERT INTO bid_definition_heads(bid_year,version_id,revision) VALUES (2026,?,1)',
            ).bind(version.id)
          : privateEnv.DB.prepare(
              'UPDATE bid_definition_heads SET version_id=?,revision=? WHERE bid_year=2026',
            ).bind(version.id, version.version_number),
      );
      await privateEnv.DB.batch(statements);
    }
    const freezeColumns = [
      'id',
      'bid_year',
      'cutoff_at',
      'time_zone',
      'captured_at',
      'actor_subject',
      'source_version_id',
      'source_version_sha256',
      'source_token',
      'evaluation_json',
      'personnel_source_json',
      'credential_source_json',
      'evaluation_sha256',
      'personnel_sha256',
      'credential_sha256',
      'source_imports_json',
    ];
    await privateEnv.DB.prepare(
      `INSERT INTO bid_evidence_freezes (${freezeColumns.join(',')}) VALUES (${freezeColumns.map(() => '?').join(',')})`,
    )
      .bind(...freezeColumns.map((column) => freeze[column]))
      .run();
    const source = await loadBidDefinitionVersion(
      privateEnv.DB,
      2026,
      String(freeze.source_version_id),
    );
    expect(source.ok).toBe(true);
    expect(source.ok && source.sha256).toBe(freeze.source_version_sha256);
    const baseline = await loadBidDefinitionVersion(privateEnv.DB, 2026, input.packet.version.id);
    expect(baseline.ok).toBe(true);
    expect(baseline.ok && baseline.sha256).toBe(input.packet.version.content_sha256);
    const token = await signJwt(
      {
        sub: actor,
        hub_user_id: actor,
        member_id: actor,
        emp: actorRow.employeeId,
        role: 'admin',
        rank: actorRow.rank,
        first_name: 'Local',
        last_name: 'Operator',
        security_version: 1,
        authz_checked_at: Math.floor(Date.now() / 1000),
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      privateEnv.JWT_SIGNING_KEY,
    );
    const request = (path: string, body?: unknown) => appRequest(path, token, body);
    const savedResponse = await request('bid/2026/versions', input.saveBody);
    expect(savedResponse.status).toBe(201);
    const saved = (await savedResponse.json()) as { versionId: string; contentSha256: string };
    expect(saved.contentSha256).toBe(
      '703ad8d63bc5e562a471b451c75753a9d49c0e11b344fa36572c43a5f1c4860c',
    );
    const selection = { versionId: saved.versionId, versionSha256: saved.contentSha256 };
    const mockResponse = await request('bid/2026/preview', { kind: 'mock', ...selection });
    expect(mockResponse.status).toBe(200);
    const mock = (await mockResponse.json()) as {
      wouldAllowCreateMock: boolean;
      contextSha256: string;
      runtimeSourceToken: string;
    };
    expect(mock.wouldAllowCreateMock).toBe(true);
    const liveResponse = await request('bid/2026/preview', { kind: 'live', ...selection });
    expect(liveResponse.status).toBe(200);
    const live = (await liveResponse.json()) as {
      wouldAllowCreateLive: boolean;
      policyError: string;
      readiness?: { checks?: { id: string; status: string }[] };
    };
    expect(live).toMatchObject({
      wouldAllowCreateLive: false,
      policyError: 'policy_source_decision_required',
    });
    const createdResponse = await request('bid/2026/mock-sessions', {
      ...selection,
      expectedContextSha256: mock.contextSha256,
      expectedSourceToken: mock.runtimeSourceToken,
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string };
    const frozen = await loadFrozenSessionBidPolicy(getDb(privateEnv.DB), created.id);
    expect(frozen.ok).toBe(true);
    if (!frozen.ok || frozen.snapshot.v !== 3 || frozen.snapshot.settings.v !== 3)
      throw new Error('Original source frozen pin invalid');
    expect(
      new Set(frozen.snapshot.settings.livePolicy.stages.flatMap((stage) => stage.memberIds)).size,
    ).toBe(218);
    for (const originalMember of original.members) {
      const member = frozen.snapshot.members.find(
        (row) => row.memberId === originalMember.memberId,
      );
      if (!member) throw new Error('Original normalized member missing');
      const {
        pool: _pool,
        exclusionReason: _reason,
        authoritativeAssignmentId: _assignment,
        mockParticipationEvidence: _mock,
        ...protectedFacts
      } = originalMember;
      const {
        pool: _nextPool,
        exclusionReason: _nextReason,
        authoritativeAssignmentId: _nextAssignment,
        mockParticipationEvidence: _nextMock,
        ...nextProtectedFacts
      } = member;
      expect(nextProtectedFacts).toEqual(protectedFacts);
    }
    const started = await request(`bid-session/${created.id}/start`, {});
    expect(started.status).toBe(200);
    const before = await loadCanonicalBidSessionState(privateEnv.DB, created.id);
    expect(before?.bidOrder).toHaveLength(276);
    const stub = env.BID_SESSION.get(env.BID_SESSION.idFromName(created.id));
    let originalInstance: unknown;
    await runInDurableObject(stub, async (instance) => {
      originalInstance = instance;
    });
    await evictDurableObject(stub);
    await stub.fetch('https://owned-original-do/snapshot');
    await runInDurableObject(stub, async (instance) => expect(instance).not.toBe(originalInstance));
    expect(await loadCanonicalBidSessionState(privateEnv.DB, created.id)).toEqual(before);
    const pause = await request(`bid-session/${created.id}/commands/live`, {
      v: 1,
      type: 'live.pause',
      commandId: crypto.randomUUID(),
      expectedSeq: 0,
      reason: 'Preserve exact original source readiness checkpoint',
      evidenceReference: 'local:original-source-proof',
    });
    expect(pause.status).toBe(200);
    expect(await privateEnv.DB.prepare('SELECT count(*) AS n FROM bids').first()).toEqual({ n: 0 });
    expect(
      await privateEnv.DB.prepare('SELECT count(*) AS n FROM member_assignments').first(),
    ).toEqual({ n: 0 });
    expect(
      await privateEnv.DB.prepare('SELECT count(*) AS n FROM bid_sessions WHERE is_mock=0').first(),
    ).toEqual({ n: 0 });
    // biome-ignore lint/suspicious/noConsole: Sanitized private execution receipt; source values remain in bindings.
    console.log(
      'ORIGINAL_RETAINED_SOURCE_RECEIPT',
      JSON.stringify({
        contentSha256: saved.contentSha256,
        localSessionId: created.id,
        mockPreviewAllowed: true,
        uniqueParticipants: 218,
        stageEntries: 276,
        qualificationAndScoringPreserved: true,
        actualD1DOEviction: true,
        completed: false,
        livePreview: {
          wouldAllowCreateLive: live.wouldAllowCreateLive,
          policyError: live.policyError,
          checks: live.readiness?.checks?.map((check: { id: string; status: string }) => ({
            id: check.id,
            status: check.status,
          })),
        },
        productionRequests: 0,
      }),
    );
  },
  300000,
);

async function appRequest(path: string, token: string, body?: unknown) {
  const { app } = await import('../../src/index.js');
  return app.fetch(
    new Request(`https://owned-original-source.invalid/api/admin/${path}`, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
    }),
    privateEnv,
  );
}
