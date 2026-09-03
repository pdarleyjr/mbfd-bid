import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

const KEY = 'p'.repeat(64);
const actions = [
  'record_selection',
  'amend_selection',
  'skip_defer',
  'mark_unreachable',
  'force',
  'resolve_tie',
  'alter_order',
  'pause_resume',
  'approve_transition',
  'approve_final_results',
  'publish',
];
const dispositions = ['HOLD', 'PASS', 'DEFER', 'SKIP', 'DECLINED', 'UNREACHABLE'];

async function adminRequest(h: TestD1, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await signJwt(
    {
      sub: 0,
      emp: 'annual-policy-admin',
      role: 'admin',
      rank: 'CHIEF',
      first_name: 'Annual',
      last_name: 'Admin',
      fresh_auth_at: Math.floor(Date.now() / 1000),
    },
    KEY,
  );
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), {
    ...h.env,
    JWT_SIGNING_KEY: KEY,
  });
}

function executionPolicy() {
  return {
    v: 1,
    policyRevision: 'annual-policy-test',
    stages: [
      {
        id: 'FIREFIGHTER',
        label: 'Firefighter',
        order: 0,
        memberIds: [1],
        opportunityPositionIds: ['A101'],
        kind: 'FIREFIGHTER',
      },
    ],
    dispositions: dispositions.map((disposition) => ({
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
    actionPermissions: actions.map((action) => ({ action, actorMemberIds: [1] })),
    specialtyCatalogReference: null,
    aDayPolicyReference: null,
    transitionPolicyReference: null,
    publicationPolicyReference: null,
  };
}

function body(ruleBookVersion = '2027.1') {
  return JSON.stringify({
    rule_book_version: ruleBookVersion,
    policy_text: 'Annual policy language with enough text to satisfy validation.',
    execution_policy: executionPolicy(),
    reason: 'Create the annual policy draft.',
  });
}

describe('annual policy documents', () => {
  let h: TestD1;

  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      `INSERT INTO members
         (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,
          employment_status,employment_status_effective_on,created_at,updated_at)
       VALUES (1,'policy-operator-1','Policy','Operator','FF','FF',1,0,'active','2027-01-01',1,1);
       INSERT INTO position_templates (version,effective_year) VALUES ('2027.1',2027);
       INSERT INTO positions
         (id,template_version,shift,station,division,unit,rank_required,position_name)
       VALUES ('A101','2027.1','A','1','Combat','Engine 1','FF','Firefighter');
       INSERT INTO rule_books (version,effective_year,status)
       VALUES ('2027.1',2027,'draft'),('2028.1',2028,'draft'),('2027.2',2027,'active');
       INSERT INTO position_rules
         (rule_book_version,position_id,template_version,required_criteria,points_preference,tie_break_chain)
       VALUES ('2027.1','A101','2027.1','{"rank":["FF"],"credentials":[],"custom":[]}',
         '{"max":0,"items":[]}','["points","rsc_seniority","rank_seniority"]');
       INSERT INTO bid_years
         (year,status,position_template_version,rule_book_version,config_json,configuration_revision)
       VALUES (2027,'configuring','2027.1','2027.1',
         '{"v":2,"expectedDurationDays":2,"turnTimerSeconds":180,"credentialEvaluationOn":"2027-01-15"}',0);`,
    );
  });
  afterEach(async () => teardownTestD1(h));

  it('creates revisions, exposes them through GET, and writes an audit record', async () => {
    const first = await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
      method: 'POST',
      body: body(),
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ revision: 1, status: 'DRAFT' });

    const second = await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
      method: 'POST',
      body: body(),
    });
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ revision: 2, status: 'DRAFT' });

    const documents = await adminRequest(h, '/api/admin/annual-policy-documents/2027');
    expect(documents.status).toBe(200);
    expect(await documents.json()).toMatchObject({ documents: [{ revision: 2 }, { revision: 1 }] });
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS count FROM audit_log WHERE target_kind = 'annual_policy_document'",
        )
      ).results,
    ).toEqual([{ count: 2 }]);
  });

  it('assigns distinct revisions to concurrent draft requests instead of returning a database error', async () => {
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        adminRequest(h, '/api/admin/annual-policy-documents/2027', {
          method: 'POST',
          body: body(),
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([201, 201]);
    const revisions = await Promise.all(responses.map((response) => response.json()));
    expect(revisions.map((document) => (document as { revision: number }).revision).sort()).toEqual(
      [1, 2],
    );
  });

  it('fails closed for an unknown or non-configuring year and invalid rule-book pairing', async () => {
    expect(
      (
        await adminRequest(h, '/api/admin/annual-policy-documents/2029', {
          method: 'POST',
          body: body(),
        })
      ).status,
    ).toBe(404);
    await h.db.run("UPDATE bid_years SET status = 'live' WHERE year = 2027");
    expect(
      (
        await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
          method: 'POST',
          body: body(),
        })
      ).status,
    ).toBe(409);
    await h.db.run("UPDATE bid_years SET status = 'configuring' WHERE year = 2027");
    expect(
      (
        await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
          method: 'POST',
          body: body('2028.1'),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
          method: 'POST',
          body: body('2027.2'),
        })
      ).status,
    ).toBe(409);
  });

  it('publishes a draft immutably and supersedes the previous published revision', async () => {
    const first = await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
      method: 'POST',
      body: body(),
    });
    const firstDocument = (await first.json()) as { id: string };
    const publishedFirst = await adminRequest(
      h,
      `/api/admin/annual-policy-documents/2027/${firstDocument.id}/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'Approve the first annual policy revision.' }),
      },
    );
    expect(publishedFirst.status).toBe(200);
    expect(await publishedFirst.json()).toMatchObject({
      id: firstDocument.id,
      status: 'PUBLISHED',
    });

    const second = await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
      method: 'POST',
      body: body(),
    });
    const secondDocument = (await second.json()) as { id: string };
    expect(
      (
        await adminRequest(
          h,
          `/api/admin/annual-policy-documents/2027/${secondDocument.id}/publish`,
          {
            method: 'POST',
            body: JSON.stringify({ reason: 'Approve the amended annual policy revision.' }),
          },
        )
      ).status,
    ).toBe(200);

    const read = await adminRequest(h, '/api/admin/annual-policy-documents/2027');
    expect(await read.json()).toMatchObject({
      documents: [
        {
          id: secondDocument.id,
          revision: 2,
          status: 'PUBLISHED',
          supersedes_document_id: firstDocument.id,
        },
        { id: firstDocument.id, revision: 1, status: 'SUPERSEDED' },
      ],
    });
    expect(
      (
        await h.db.run(
          "SELECT count(*) AS count FROM audit_log WHERE action = 'annual_policy_published'",
        )
      ).results,
    ).toEqual([{ count: 2 }]);
    await expect(
      h.db.run("UPDATE annual_bid_policy_documents SET policy_text = 'mutated text' WHERE id = ?", [
        firstDocument.id,
      ]),
    ).rejects.toThrow(/immutable/i);
  });

  it('freezes exact document evidence into a mock session across later draft revisions', async () => {
    const first = await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
      method: 'POST',
      body: body(),
    });
    expect(first.status).toBe(201);
    const firstDocument = (await first.json()) as { id: string; revision: number };

    const session = await adminRequest(h, '/api/admin/bid-session', {
      method: 'POST',
      body: JSON.stringify({ bid_year: 2027, mode: 'mock' }),
    });
    expect(session.status).toBe(201);
    const sessionId = ((await session.json()) as { id: string }).id;
    const frozenBefore = (
      await h.db.run(
        'SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id = ?',
        [sessionId],
      )
    ).results[0] as { snapshot_json: string };
    expect(JSON.parse(frozenBefore.snapshot_json)).toMatchObject({
      annualPolicyEvidence: {
        documentId: firstDocument.id,
        documentRevision: firstDocument.revision,
        ruleBookVersion: '2027.1',
        executablePolicyRevision: 'annual-policy-test',
        policyText: 'Annual policy language with enough text to satisfy validation.',
      },
    });

    expect(
      (
        await adminRequest(h, '/api/admin/annual-policy-documents/2027', {
          method: 'POST',
          body: JSON.stringify({
            ...JSON.parse(body()),
            policy_text: 'A later annual policy draft with independently versioned language.',
          }),
        })
      ).status,
    ).toBe(201);
    const frozenAfter = (
      await h.db.run(
        'SELECT snapshot_json FROM bid_session_policy_snapshots WHERE bid_session_id = ?',
        [sessionId],
      )
    ).results[0] as { snapshot_json: string };
    expect(frozenAfter.snapshot_json).toBe(frozenBefore.snapshot_json);
  });
});
