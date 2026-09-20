import {
  BidDispositionSchema,
  BidSessionPolicySnapshotSchema,
  type JwtPayload,
  LiveBidActionSchema,
} from '@mbfd/shared';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { requireAdmin, requireLiveBidAction } from '../../src/routes/admin/middleware.js';
import type { WorkerEnv } from '../../src/types/env.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const LOCAL_ACTOR = 42;
const SESSION = 'SYNTHETIC-IDENTITY-LIVE';

describe('exact local identity before administrator authorization and writes', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    h.sqlite.exec(`
      INSERT INTO members(id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at)
      VALUES (42,'SYNTHETIC-LOCAL','Synthetic','Local','FF','FF',1,0,1,1);
      INSERT INTO bid_years(year,status) VALUES(2026,'live');
      INSERT INTO position_templates(version,effective_year) VALUES('synthetic-identity',2026);
      INSERT INTO rule_books(version,effective_year,status,revision) VALUES('synthetic-identity',2026,'active',0);
      INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,is_mock) VALUES('${SESSION}',2026,1,'config',0);
    `);
    const snapshot = BidSessionPolicySnapshotSchema.parse({
      v: 3,
      ruleBookVersion: 'synthetic-identity',
      ruleBookRevision: 0,
      positionTemplateVersion: 'synthetic-identity',
      configurationRevision: 0,
      credentialEvaluationOn: '2026-01-15',
      capturedAtMs: 1,
      settings: {
        v: 3,
        expectedDurationDays: 2,
        turnTimerSeconds: 180,
        credentialEvaluationOn: '2026-01-15',
        livePolicy: {
          v: 1,
          policyRevision: 'synthetic-identity',
          stages: [
            {
              id: 'FF',
              label: 'Synthetic',
              order: 0,
              memberIds: [42],
              opportunityPositionIds: ['SYNTHETIC-SEAT'],
              kind: 'FIREFIGHTER',
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
            actorMemberIds: [LOCAL_ACTOR],
          })),
          specialtyCatalogReference: null,
          aDayPolicyReference: null,
          transitionPolicyReference: null,
          publicationPolicyReference: null,
        },
      },
      members: [],
      ruleBookMaterial: {
        v: 1,
        rules: [
          {
            ruleBookVersion: 'synthetic-identity',
            positionId: 'SYNTHETIC-SEAT',
            templateVersion: 'synthetic-identity',
            requiredCriteriaJson: '{"rank":["FF"],"credentials":[],"custom":[]}',
            pointsPreferenceJson: '{"max":0,"items":[]}',
            tieBreakChainJson: '["rsc_seniority"]',
          },
        ],
        positions: [
          {
            id: 'SYNTHETIC-SEAT',
            templateVersion: 'synthetic-identity',
            bidParticipation: 'BIDDABLE',
            isExcludedFromCount: false,
            shift: 'A',
            station: '1',
            unit: 'Synthetic',
            rankRequired: 'FF',
            positionName: 'Synthetic',
          },
        ],
      },
    });
    h.sqlite
      .prepare(`INSERT INTO bid_session_policy_snapshots
      (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
      VALUES (?,'synthetic-identity','synthetic-identity',0,?,1)`)
      .run(SESSION, JSON.stringify(snapshot));
  });
  afterEach(async () => teardownTestD1(h));

  async function token(employeeId: string, hubMemberId: number) {
    const now = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        sub: 700,
        hub_user_id: 700,
        member_id: hubMemberId,
        emp: employeeId,
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Synthetic',
        last_name: 'Hub',
        security_version: 1,
        fresh_auth_at: now,
        authz_checked_at: now,
      },
      h.env.JWT_SIGNING_KEY,
    );
  }

  function guardedApp() {
    const reachedGrant = vi.fn();
    const route = new Hono<{ Bindings: WorkerEnv; Variables: { claims: JwtPayload } }>();
    route.use('*', requireAdmin);
    route.post(
      '/:id/action',
      async (_c, next) => {
        reachedGrant();
        await next();
      },
      requireLiveBidAction('pause_resume'),
      (c) => c.json({ localMemberId: c.get('claims').member_id, hubSubject: c.get('claims').sub }),
    );
    return { route, reachedGrant };
  }

  it('uses an exact employee join for a different Hub numeric ID and preserves the real frozen grant', async () => {
    const { route, reachedGrant } = guardedApp();
    const response = await route.request(
      `/${SESSION}/action`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token('SYNTHETIC-LOCAL', 900)}` },
      },
      h.env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ localMemberId: LOCAL_ACTOR, hubSubject: 700 });
    expect(reachedGrant).toHaveBeenCalledOnce();
  });

  it('rejects an unmatched employee before a colliding local frozen grant or write handler can run', async () => {
    const { route, reachedGrant } = guardedApp();
    const authorization = `Bearer ${await token('SYNTHETIC-UNMATCHED', LOCAL_ACTOR)}`;
    const tables = [
      'members',
      'audit_log',
      'bid_years',
      'bid_definition_versions',
      'bid_ordinal_datasets',
      'bid_session_policy_snapshots',
    ];
    const before = tables.map((table) => h.sqlite.prepare(`SELECT * FROM ${table}`).all());
    const response = await route.request(
      `/${SESSION}/action`,
      {
        method: 'POST',
        headers: { Authorization: authorization },
      },
      h.env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'member_identity_unavailable' });
    expect(reachedGrant).not.toHaveBeenCalled();

    // Real Hono routes must reject identity before payload validation or persistence.
    for (const path of ['/api/admin/bid/2026/versions', '/api/admin/bid-ordinals']) {
      const denied = await app.fetch(
        new Request(`http://x${path}`, {
          method: 'POST',
          headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: '{}',
        }),
        h.env,
      );
      expect(denied.status).toBe(503);
      expect(await denied.json()).toEqual({ error: 'member_identity_unavailable' });
    }
    expect(tables.map((table) => h.sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
  });
});
