import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index.js';
import { signJwt } from '../../src/lib/jwt.js';
import { deriveMemberQualificationProjection } from '../../src/lib/qualification-lifecycle.js';
import { mapEvent } from '../../src/routes/admin/qualification-lifecycle.js';
import { type TestD1, setupTestD1, teardownTestD1 } from './helpers/test-d1.js';
const KEY = 't'.repeat(64);
describe('TargetSolutions reviewed import', () => {
  let h: TestD1;
  beforeEach(async () => {
    h = await setupTestD1();
    await h.db.run(
      "INSERT INTO members (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,created_at,updated_at) VALUES (1,'0012','Test','Member','FF','FF',1,0,1,1); INSERT INTO credentials(id,name) VALUES(10,'Synthetic Certification');",
    );
  });
  afterEach(async () => {
    await teardownTestD1(h);
  });
  async function request(path: string, body?: unknown) {
    const identity = await h.env.DB.prepare('SELECT employee_id FROM members WHERE id=1').first<{
      employee_id: string;
    }>();
    const token = await signJwt(
      {
        sub: 0,
        emp: identity?.employee_id ?? '0012',
        role: 'admin',
        rank: 'CHIEF',
        first_name: 'Test',
        last_name: 'Admin',
        fresh_auth_at: Math.floor(Date.now() / 1000),
      },
      KEY,
    );
    return app.fetch(
      new Request(`http://x/api/admin/targetsolutions${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { ...h.env, JWT_SIGNING_KEY: KEY },
    );
  }
  const csv =
    'Credentials\nRun Date:,"Sep 7, 2026 4:34 PM"\nFilters:,Credential Status,Active\nFirst Name,Last Name,Employee ID,Credential Name\nTest,Member,0012,Synthetic Certification\nTest,Unknown,0999,Synthetic Certification';
  it('records a specific unverified qualification hold without a false revocation or source edit', async () => {
    const uploaded = await request('/imports', {
      csv: 'Employee ID,Credential Name,Credential Status,Start Date,Expiration Date\n0012,Synthetic Certification,Active,2023-01-01,2099-05-07',
      filename: 'synthetic-unverified.csv',
      observed_on: '2026-09-29',
    });
    expect(uploaded.status).toBe(201);
    const { id } = (await uploaded.json()) as { id: string };
    await request(`/imports/${id}/review`, { accept: true });
    const detail = (await (await request(`/imports/${id}`)).json()) as {
      rows: { id: string; source_json: string }[];
    };
    const row = detail.rows[0];
    expect(row).toBeDefined();
    const held = await request(`/imports/${id}/reject`, {
      row_ids: [row?.id],
      needs_admin_evidence: true,
      reason: 'Administrator evidence needed for unusual PSD date',
    });
    expect(held.status).toBe(200);
    await request(`/imports/${id}/review`, { accept: true });
    const readback = (await (await request(`/imports/${id}`)).json()) as {
      rows: {
        source_json: string;
        classification: string;
        before: { reviewHold: { status: string } };
      }[];
    };
    expect(readback.rows[0]?.source_json).toBe(row?.source_json);
    expect(readback.rows[0]?.classification).toBe('REJECTED');
    expect(readback.rows[0]?.before.reviewHold.status).toBe('NEEDS ADMIN EVIDENCE');
    expect(
      await h.env.DB.prepare('SELECT COUNT(*) AS n FROM member_qualification_events').first(),
    ).toEqual({ n: 0 });
  });
  it('does not clear an unresolved qualification hold through a safe dated-source import', async () => {
    await h.db.run(`INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date)
      VALUES(1,10,NULL,NULL); INSERT INTO credentials(id,name) VALUES(11,'Unrelated Qualification');`);
    const anomaly = (await (
      await request('/imports', {
        csv: 'Employee ID,Credential Name,Credential Status,Start Date,Expiration Date\n0012,Synthetic Certification,Active,2023-05-07,2099-05-07',
        filename: 'held-date.csv',
        observed_on: '2026-09-29',
      })
    ).json()) as { id: string };
    await request(`/imports/${anomaly.id}/review`, { accept: true });
    const prior = (await (await request(`/imports/${anomaly.id}`)).json()) as {
      rows: { id: string; source_json: string }[];
    };
    const priorRow = prior.rows[0];
    if (!priorRow) throw new Error('Missing synthetic held source');
    expect(
      (
        await request(`/imports/${anomaly.id}/reject`, {
          row_ids: [priorRow.id],
          needs_admin_evidence: true,
          reason: 'Individual verification needed for unproven expiration',
        })
      ).status,
    ).toBe(200);
    const heldBefore = h.sqlite
      .prepare('SELECT * FROM targetsolutions_rows WHERE id=?')
      .get(priorRow.id);
    const legacyBefore = h.sqlite.prepare('SELECT * FROM member_credentials').all();
    const next = (await (
      await request('/imports', {
        csv: 'Employee ID,Credential Name,Credential Status,Start Date,Expiration Date\n0012,Synthetic Certification,Active,2023-05-07,\n0012,Unrelated Qualification,Active,2024-01-01,2028-01-01',
        filename: 'updated-date.csv',
        observed_on: '2026-09-30',
      })
    ).json()) as { id: string };
    expect((await request(`/imports/${next.id}/review`, { accept: true })).status).toBe(200);
    const detail = (await (await request(`/imports/${next.id}`)).json()) as {
      counts: Record<string, number>;
      rows: { id: string; credential_id: number; applied_at: number | null }[];
    };
    expect(detail.counts).toMatchObject({ CONFLICT: 1, NEW_QUALIFICATION: 1 });
    const held = detail.rows.find((row) => row.credential_id === 10);
    if (!held) throw new Error('Missing updated held qualification');
    const safe = await request(`/imports/${next.id}/apply`, {
      safe: true,
      reason: 'Apply only independently safe source rows',
    });
    expect(safe.status).toBe(200);
    expect(await safe.json()).toMatchObject({ processed: 1, eventsAdded: 1 });
    const adverse = await request(`/imports/${next.id}/apply`, {
      row_ids: [held.id],
      accept_adverse: true,
      reason: 'Attempt blanket approval over unresolved evidence hold',
    });
    expect(adverse.status).toBe(409);
    expect(await adverse.json()).toMatchObject({
      error: 'conflicting_evidence_requires_individual_qualification_correction',
    });
    expect(
      h.sqlite
        .prepare('SELECT COUNT(*) AS n FROM member_qualification_events WHERE credential_id=10')
        .get(),
    ).toEqual({ n: 0 });
    expect(
      h.sqlite.prepare('SELECT * FROM targetsolutions_rows WHERE id=?').get(priorRow.id),
    ).toEqual(heldBefore);
    expect(h.sqlite.prepare('SELECT * FROM member_credentials').all()).toEqual(legacyBefore);
    expect(
      h.sqlite.prepare('SELECT applied_at FROM targetsolutions_rows WHERE id=?').get(held.id),
    ).toEqual({ applied_at: null });
  });
  it('allows normal renewal after later approved dated evidence resolves a qualification hold', async () => {
    await h.db.run(`INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date)
      VALUES(1,10,NULL,NULL);
      INSERT INTO targetsolutions_imports(id,filename,observed_on,source_row_count,unique_row_count,coverage_json,status,created_by,created_at)
        VALUES('prior-reviewed-hold','synthetic.csv','2026-09-29',1,1,'{}','reviewed','0',1);
      INSERT INTO targetsolutions_rows(id,import_id,row_number,source_json,member_id,credential_id,classification,before_json,reviewed_at,applied_at)
        VALUES('prior-held-row','prior-reviewed-hold',1,'{}',1,10,'REJECTED',
          '{"reviewHold":{"status":"NEEDS ADMIN EVIDENCE","reviewedAt":10}}',10,10);
      INSERT INTO member_qualification_events(id,member_id,credential_id,kind,effective_on,expires_on,evidence_source,evidence_reference,reason,actor_subject,idempotency_key,before_state,after_state,created_at)
        VALUES('individually-approved-date',1,10,'CERTIFICATION_GAINED','2023-01-01','2028-01-01',
          'Individual administrator verification','synthetic-proof','Approved individual qualification interval',
          '0','individual-approved-date','{}','{}',20);`);
    const upload = await request('/imports', {
      csv: 'Employee ID,Credential Name,Credential Status,Start Date,Expiration Date\n0012,Synthetic Certification,Active,2023-01-01,2029-01-01',
      filename: 'verified-renewal.csv',
      observed_on: '2026-09-30',
    });
    expect(upload.status).toBe(201);
    const { id } = (await upload.json()) as { id: string };
    expect((await request(`/imports/${id}/review`, { accept: true })).status).toBe(200);
    const detail = (await (await request(`/imports/${id}`)).json()) as {
      counts: Record<string, number>;
    };
    expect(detail.counts.RENEWAL).toBe(1);
    const applied = await request(`/imports/${id}/apply`, {
      safe: true,
      reason: 'Apply renewal after individual dated verification',
    });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ processed: 1, eventsAdded: 1 });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM member_qualification_events').get()).toEqual(
      { n: 2 },
    );
  });
  it.each([
    ['2028-01-01', 'FILL_MISSING_DATE', 'active'],
    ['2026-08-01', 'EXPIRATION_REVIEW', 'expired'],
  ])(
    'reconciles dated evidence expiring %s without treating the old report date as an issue date',
    async (expiresOn, classification, status) => {
      const initial = (await (
        await request('/imports', { csv, filename: 'active-only.csv' })
      ).json()) as { id: string };
      await request(`/imports/${initial.id}/review`, { accept: true });
      await request(`/imports/${initial.id}/apply`, {
        safe: true,
        reason: 'Original active-only observation',
      });
      const dated = (await (
        await request('/imports', {
          csv: `Employee ID,Credential Name,Credential Status,Start Date,Expiration Date\n0012,Synthetic Certification,Active,2023-01-01,${expiresOn}`,
          filename: 'dated-source.csv',
          observed_on: '2026-09-29',
        })
      ).json()) as { id: string };
      await request(`/imports/${dated.id}/review`, { accept: true });
      const detail = (await (await request(`/imports/${dated.id}`)).json()) as {
        counts: Record<string, number>;
        rows: { id: string }[];
      };
      expect(detail.counts[classification]).toBe(1);
      const applied = await request(
        `/imports/${dated.id}/apply`,
        status === 'active'
          ? { safe: true, reason: 'Fill original source dates' }
          : {
              row_ids: [detail.rows[0]?.id],
              accept_adverse: true,
              reason: 'Verify source expiration',
            },
      );
      expect(applied.status).toBe(200);
      const persisted = await h.env.DB.prepare(
        'SELECT event.*, credential.name AS credential_name FROM member_qualification_events event JOIN credentials credential ON credential.id=event.credential_id ORDER BY event.created_at,event.id',
      ).all<Parameters<typeof mapEvent>[0]>();
      const events = persisted.results.map(mapEvent).filter((event) => event !== null);
      const project = (asOf: string) =>
        deriveMemberQualificationProjection({ memberId: 1, asOf, legacyCredentials: [], events })
          .certifications[0];
      expect(project('2026-09-28')).toMatchObject({
        status: 'active',
        expiresOn: null,
        effectiveOn: '2026-09-07',
      });
      expect(project('2026-09-30')).toMatchObject({ status, expiresOn });
      if (status === 'active') expect(project('2026-09-30')?.effectiveOn).toBe('2023-01-01');
      expect(events.at(-1)?.effectiveOn).toBe('2026-09-29');
      await request(`/imports/${dated.id}/review`, { accept: true });
      const repeated = (await (await request(`/imports/${dated.id}`)).json()) as {
        counts: Record<string, number>;
      };
      expect(repeated.counts.APPLIED).toBe(1);
    },
  );
  it('keeps a genuinely conflicting explicit issue date in individual review', async () => {
    await h.db.run(
      "INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES(1,10,'2024-01-01','2028-01-01')",
    );
    const uploaded = (await (
      await request('/imports', {
        csv: 'Employee ID,Credential Name,Credential Status,Start Date,Expiration Date\n0012,Synthetic Certification,Active,2023-01-01,2028-01-01',
        filename: 'conflicting-date.csv',
        observed_on: '2026-09-29',
      })
    ).json()) as { id: string };
    await request(`/imports/${uploaded.id}/review`, { accept: true });
    const detail = (await (await request(`/imports/${uploaded.id}`)).json()) as {
      counts: Record<string, number>;
    };
    expect(detail.counts.CONFLICT).toBe(1);
    await request(`/imports/${uploaded.id}/apply`, { safe: true, reason: 'Safe records only' });
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });
  it.each([
    ['25611', 'Christopher', 'Nodarse', 'FL State - EMT - Basic'],
    ['25615', 'Taj', 'Thomas', 'FL State - Paramedic'],
  ])(
    'retains the current interval and schedules employee %s renewal idempotently',
    async (employeeId, firstName, lastName, credentialName) => {
      await h.env.DB.prepare('UPDATE members SET employee_id=?,first_name=?,last_name=? WHERE id=1')
        .bind(employeeId, firstName, lastName)
        .run();
      await h.env.DB.prepare('INSERT INTO credentials(id,name) VALUES(11,?)')
        .bind(credentialName)
        .run();
      await h.db.run(
        "INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES(1,11,'2024-12-01','2026-12-01')",
      );
      const renewal = `First Name,Last Name,Employee ID,Rank,Credential Name,Expiration Date,Start Date\n${firstName},${lastName},${employeeId},Firefighter,${credentialName},2028-12-01,2026-12-01`;
      const receipt = {
        workbook_hash: 'a'.repeat(64),
        selected_sheet: '2026_BID_Credentials_Version_4_',
        source_revision: 4,
        row_count: 1,
        unique_employee_count: 1,
        source_filename: 'annual-v5.xlsx',
      };
      const uploaded = await request('/imports', {
        csv: renewal,
        filename: 'annual-v5.xlsx',
        observed_on: '2026-09-30',
        source_receipt: receipt,
      });
      expect(uploaded.status).toBe(201);
      expect(uploaded.status).toBe(201);
      const { id } = (await uploaded.json()) as { id: string };
      await request(`/imports/${id}/review`, { accept: true });
      const detail = (await (await request(`/imports/${id}`)).json()) as {
        counts: Record<string, number>;
        source_receipt: unknown;
      };
      expect(detail.counts.FUTURE_RENEWAL).toBe(1);
      expect(detail.source_receipt).toMatchObject({ ...receipt, approved_at: null });
      expect(
        (
          await request(`/imports/${id}/apply`, {
            safe: true,
            reason: 'Approved contiguous future renewal',
          })
        ).status,
      ).toBe(200);
      const event = await h.env.DB.prepare(
        'SELECT id,member_id AS memberId,credential_id AS credentialId,kind,effective_on AS effectiveOn,expires_on AS expiresOn,evidence_source AS evidenceSource,evidence_reference AS evidenceReference,reason,actor_subject AS actorSubject,idempotency_key AS idempotencyKey,before_state AS beforeState,after_state AS afterState,created_at AS createdAt FROM member_qualification_events',
      ).first<Parameters<typeof deriveMemberQualificationProjection>[0]['events'][number]>();
      if (!event) throw new Error('Expected scheduled renewal event');
      const projection = (asOf: string) =>
        deriveMemberQualificationProjection({
          memberId: 1,
          asOf,
          legacyCredentials: [
            {
              memberId: 1,
              credentialId: 11,
              credentialName,
              startDate: '2024-12-01',
              expirationDate: '2026-12-01',
            },
          ],
          events: [{ ...event, credentialName, specialtyCode: null }],
        }).certifications[0];
      expect(projection('2026-09-30')).toMatchObject({
        status: 'active',
        effectiveOn: '2024-12-01',
        expiresOn: '2026-12-01',
        origin: 'legacy_projection',
      });
      expect(projection('2026-12-01')).toMatchObject({
        status: 'active',
        effectiveOn: '2026-12-01',
        expiresOn: '2028-12-01',
        origin: 'lifecycle_evidence',
      });
      await request(`/imports/${id}/review`, { accept: true });
      await request(`/imports/${id}/apply`, { safe: true, reason: 'Retry scheduled renewal' });
      expect(
        (
          await h.env.DB.prepare('SELECT COUNT(*) AS n FROM member_qualification_events').first<{
            n: number;
          }>()
        )?.n,
      ).toBe(1);
    },
  );
  it('rejects a receipt whose revision or counts disagree with the selected CSV', async () => {
    const result = await request('/imports', {
      csv,
      filename: 'annual.xlsx',
      source_receipt: {
        workbook_hash: 'a'.repeat(64),
        selected_sheet: '2026_BID_Credentials_Version_4_',
        source_revision: 1,
        row_count: 2,
        unique_employee_count: 2,
        source_filename: 'annual.xlsx',
      },
    });
    expect(result.status).toBe(422);
  });
  it('requires individual verification of an anomalous date even with blanket adverse approval', async () => {
    const anomaly =
      'Employee ID,Credential Name,Credential Status,Start Date,Expiration Date\n0012,Synthetic Certification,Active,2023-05-07,2099-05-07';
    const { id } = (await (
      await request('/imports', {
        csv: anomaly,
        filename: 'anomaly.csv',
        observed_on: '2026-09-30',
      })
    ).json()) as { id: string };
    const before = await h.env.DB.prepare(
      'SELECT revision FROM annual_source_revision WHERE id=1',
    ).first<{ revision: number }>();
    await request(`/imports/${id}/review`, { accept: true });
    const detail = (await (await request(`/imports/${id}`)).json()) as {
      counts: Record<string, number>;
      rows: { id: string }[];
    };
    expect(detail.counts.ANOMALOUS_DATE_REVIEW).toBe(1);
    expect(
      (
        await h.env.DB.prepare('SELECT revision FROM annual_source_revision WHERE id=1').first<{
          revision: number;
        }>()
      )?.revision,
    ).toBeGreaterThan(before?.revision ?? -1);
    expect(
      (
        await request(`/imports/${id}/apply`, {
          row_ids: [detail.rows[0]?.id],
          accept_adverse: true,
          reason: 'Attempt blanket anomaly approval',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) AS n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });
  it('matches exact IDs, applies approved evidence once and preserves unresolved rows on replay', async () => {
    const upload = await request('/imports', { csv, filename: 'test.csv' });
    expect(upload.status).toBe(201);
    const { id } = (await upload.json()) as { id: string };
    expect((await request(`/imports/${id}/review`, { accept: true })).status).toBe(200);
    const preview = (await (await request(`/imports/${id}`)).json()) as {
      counts: Record<string, number>;
    };
    expect(preview.counts).toMatchObject({ NEW_QUALIFICATION: 1, UNKNOWN_MEMBER: 1 });
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Reviewed synthetic import' }))
        .status,
    ).toBe(200);
    expect((await request('/imports', { csv, filename: 'test.csv' })).status).toBe(200);
    await request(`/imports/${id}/review`, { accept: true });
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Retry synthetic import' });
    const count = await h.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM member_qualification_events',
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
    const legacy = await h.env.DB.prepare('SELECT COUNT(*) AS n FROM member_credentials').first<{
      n: number;
    }>();
    expect(legacy?.n).toBe(0);
  });
  it('does not apply an unreviewed batch', async () => {
    const { id } = (await (await request('/imports', { csv, filename: 'test.csv' })).json()) as {
      id: string;
    };
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Attempt without review' }))
        .status,
    ).toBe(409);
  });

  it('preserves known dates on active-only imports and fills a missing date without duplicating the qualification', async () => {
    await h.db.run(
      "INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES(1,10,'2025-01-01','2027-01-01')",
    );
    const { id } = (await (await request('/imports', { csv, filename: 'active.csv' })).json()) as {
      id: string;
    };
    await request(`/imports/${id}/review`, { accept: true });
    const preview = (await (await request(`/imports/${id}`)).json()) as {
      counts: Record<string, number>;
    };
    expect(preview.counts.UNCHANGED).toBe(1);
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Preserve known expiration' });
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    const renewal =
      'Employee ID,Credential Name,Credential Status,Expiration Date\n0012,Synthetic Certification,Active,2028-01-01';
    const next = (await (
      await request('/imports', {
        csv: renewal,
        filename: 'renewal.csv',
        observed_on: '2026-09-07',
      })
    ).json()) as { id: string };
    await request(`/imports/${next.id}/review`, { accept: true });
    expect(
      (await request(`/imports/${next.id}/apply`, { safe: true, reason: 'Reviewed renewal date' }))
        .status,
    ).toBe(200);
    const event = await h.env.DB.prepare(
      'SELECT kind,effective_on,expires_on FROM member_qualification_events',
    ).first();
    expect(event).toMatchObject({
      kind: 'CERTIFICATION_GAINED',
      effective_on: '2025-01-01',
      expires_on: '2028-01-01',
    });
    await request(`/imports/${next.id}/review`, { accept: true });
    await request(`/imports/${next.id}/apply`, { safe: true, reason: 'Repeat reviewed renewal' });
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
  });

  it('requires explicit adverse approval', async () => {
    const adverse =
      'Employee ID,Credential Name,Credential Status,Expiration Date\n0012,Synthetic Certification,Expired,2026-08-01';
    const { id } = (await (
      await request('/imports', {
        csv: adverse,
        filename: 'expired.csv',
        observed_on: '2026-09-07',
      })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, { accept: true });
    const detail = (await (await request(`/imports/${id}`)).json()) as { rows: { id: string }[] };
    const row = detail.rows[0];
    if (!row) throw new Error('Expected source row');
    expect(
      (
        await request(`/imports/${id}/apply`, {
          row_ids: [row.id],
          reason: 'Review without approval',
        })
      ).status,
    ).toBe(409);
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Only safe changes approved' });
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await request(`/imports/${id}/apply`, {
          row_ids: [row.id],
          accept_adverse: true,
          reason: 'Source expiration verified',
        })
      ).status,
    ).toBe(200);
    expect(
      await h.env.DB.prepare('SELECT kind,effective_on FROM member_qualification_events').first(),
    ).toMatchObject({ kind: 'CERTIFICATION_EXPIRED', effective_on: '2026-08-02' });
    const repeat = (await (
      await request('/imports', {
        csv: adverse.replace('Expired', 'expired'),
        filename: 'later-export.csv',
        observed_on: '2026-09-07',
      })
    ).json()) as { id: string };
    await request(`/imports/${repeat.id}/review`, { accept: true });
    const again = (await (await request(`/imports/${repeat.id}`)).json()) as {
      counts: Record<string, number>;
      rows: { before: { current: { expiresOn: string } } }[];
    };
    expect(again.counts.UNCHANGED).toBe(1);
    expect(again.rows[0]?.before.current.expiresOn).toBe('2026-08-01');
    await request(`/imports/${repeat.id}/apply`, {
      safe: true,
      reason: 'Same expiration in later export',
    });
    expect(
      await h.env.DB.prepare('SELECT count(*) AS n FROM member_qualification_events').first(),
    ).toEqual({ n: 1 });
  });

  it('rolls back a failed apply group without leaving a qualification or completed source row', async () => {
    const { id } = (await (
      await request('/imports', { csv, filename: 'rollback.csv' })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, { accept: true });
    h.failNextBatchAt(2);
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Synthetic interrupted group' }))
        .status,
    ).toBe(409);
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await h.env.DB.prepare(
          'SELECT COUNT(*) n FROM targetsolutions_rows WHERE applied_at IS NOT NULL',
        ).first<{ n: number }>()
      )?.n,
    ).toBe(0);
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Retry interrupted group' }))
        .status,
    ).toBe(200);
  });

  it('blocks a stale review after a member qualification is changed', async () => {
    const { id } = (await (await request('/imports', { csv, filename: 'stale.csv' })).json()) as {
      id: string;
    };
    await request(`/imports/${id}/review`, { accept: true });
    await h.db.run(
      "INSERT INTO member_credentials(member_id,credential_id,start_date,expiration_date) VALUES(1,10,'2025-01-01','2026-01-01')",
    );
    expect(
      (await request(`/imports/${id}/apply`, { safe: true, reason: 'Stale source review attempt' }))
        .status,
    ).toBe(409);
    expect(
      (
        await h.env.DB.prepare('SELECT COUNT(*) n FROM member_qualification_events').first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });

  it('requires explicit catalog classification for unknown names and never creates a person', async () => {
    const source = csv.replaceAll('Synthetic Certification', 'Synthetic new qualification');
    const { id } = (await (
      await request('/imports', { csv: source, filename: 'mapping.csv' })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, { accept: true });
    const result = await request('/mappings', {
      source_name: 'Synthetic new qualification',
      create_new: true,
      reason: 'Verified distinct qualification',
    });
    expect(result.status).toBe(200);
    await request(`/imports/${id}/review`, { accept: true });
    await request(`/imports/${id}/apply`, { safe: true, reason: 'Reviewed mapped qualification' });
    expect(
      (await h.env.DB.prepare('SELECT COUNT(*) n FROM members').first<{ n: number }>())?.n,
    ).toBe(1);
    expect(
      await h.env.DB.prepare(
        "SELECT fy_points_default FROM credentials WHERE name='Synthetic new qualification'",
      ).first(),
    ).toMatchObject({ fy_points_default: 0 });
  });
  it('registers a reviewed set of distinct names once without awarding catalog points', async () => {
    const text = csv.replaceAll('Synthetic Certification', 'New distinct certification');
    const { id } = (await (
      await request('/imports', { csv: text, filename: 'new.csv' })
    ).json()) as { id: string };
    await request(`/imports/${id}/review`, {});
    expect(
      (
        await request(`/imports/${id}/register-names`, {
          names: ['New distinct certification'],
          reason: 'Reviewed distinct synthetic definition',
          confirm_distinct: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/imports/${id}/register-names`, {
          names: ['New distinct certification'],
          reason: 'Replay registration',
          confirm_distinct: true,
        })
      ).status,
    ).toBe(409);
    expect(
      await h.env.DB.prepare('SELECT fy_points_default AS points FROM credentials WHERE name=?')
        .bind('New distinct certification')
        .first(),
    ).toEqual({ points: 0 });
    await request(`/imports/${id}/review`, {});
    expect(
      (
        await request(`/imports/${id}/apply`, {
          safe: true,
          reason: 'Apply reviewed synthetic definition',
        })
      ).status,
    ).toBe(200);
  });
  it('preserves and revises a mapping without reassigning already applied evidence', async () => {
    await request('/mappings', {
      source_name: 'Another source name',
      credential_id: 10,
      reason: 'Reviewed first mapping',
    });
    const catalog = (await (await request('/catalog')).json()) as {
      mappings: { created_at: number }[];
    };
    const rev = catalog.mappings[0]?.created_at;
    expect(rev).toBeTypeOf('number');
    expect(
      (
        await request('/mappings', {
          source_name: 'Another source name',
          reference_only: true,
          reason: 'Corrected classification',
          expected_mapping_revision: rev,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('/mappings', {
          source_name: 'Another source name',
          credential_id: 10,
          reason: 'Stale correction attempt',
          expected_mapping_revision: rev,
        })
      ).status,
    ).toBe(409);
    expect(
      await h.env.DB.prepare('SELECT COUNT(*) AS n FROM targetsolutions_mapping_history').first(),
    ).toEqual({ n: 1 });
  });
  it('retains rejected source assertions in their own review category without changing qualifications', async () => {
    const { id } = (await (await request('/imports', { csv, filename: 'reject.csv' })).json()) as {
      id: string;
    };
    await request(`/imports/${id}/review`, {});
    const detail = (await (await request(`/imports/${id}`)).json()) as { rows: { id: string }[] };
    const row = detail.rows[0];
    if (!row) throw new Error('Missing fixture row');
    expect(
      (
        await request(`/imports/${id}/reject`, {
          row_ids: [row.id],
          reason: 'Source assertion not accepted',
        })
      ).status,
    ).toBe(200);
    const result = (await (await request(`/imports/${id}?category=REJECTED`)).json()) as {
      counts: Record<string, number>;
      rows: unknown[];
    };
    expect(result.counts.REJECTED).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(
      await h.env.DB.prepare('SELECT COUNT(*) AS n FROM member_qualification_events').first(),
    ).toEqual({ n: 0 });
  });
});
