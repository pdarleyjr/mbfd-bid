import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const session = 'synthetic-runtime-schema-0072';
const publication = `INSERT INTO final_portal_publications VALUES
  (?, '${session}', ?, 'result','workbook','manifest','{}','receipt',999072,0)`;
const outbox = `INSERT INTO final_portal_outbox VALUES
  (?, 'runtime-publication-0072', ?, ?, 'bid_award','{}','queued',0,0,NULL,NULL)`;

describe('final publication integrity on the Workers D1 runtime', () => {
  it('preserves all five triggers and rolls back a conflicting batch', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO bid_years(year,status) VALUES(2042,'configuring')"),
      env.DB.prepare(`INSERT INTO members
        (id,employee_id,first_name,last_name,rank,bid_category,rsc_seniority,is_probationary,employment_status,created_at,updated_at)
        VALUES(999072,'synthetic-runtime-0072','Synthetic','Schema','CHIEF','EXCLUDED',0,0,'inactive',0,0)`),
      env.DB.prepare(`INSERT INTO rule_books(version,effective_year,revision)
        VALUES('synthetic-runtime-0072',2042,0)`),
      env.DB.prepare(`INSERT INTO position_templates(version,effective_year)
        VALUES('synthetic-runtime-0072',2042)`),
      env.DB.prepare(`INSERT INTO bid_sessions(id,bid_year,started_at,current_phase,is_mock)
        VALUES('${session}',2042,0,'position_bid',0)`),
      env.DB.prepare(`INSERT INTO bid_session_policy_snapshots
        (bid_session_id,rule_book_version,position_template_version,rule_book_revision,snapshot_json,captured_at)
        VALUES('${session}','synthetic-runtime-0072','synthetic-runtime-0072',0,'{"v":3,"ruleBookRevision":0}',0)`),
      env.DB.prepare(`INSERT INTO canonical_bid_session_state
        (bid_session_id,current_seq,state_json,last_command_id,created_at,updated_at)
        VALUES('${session}',237,'{"bidSessionId":"${session}","lastSeq":237,"currentPhase":"complete"}','synthetic-complete',0,0)`),
    ]);
    await expect(env.DB.prepare(publication).bind('runtime-stale-0072', 236).run()).rejects.toThrow(
      'final_publication_stale_or_not_real_complete',
    );
    await env.DB.prepare(publication).bind('runtime-publication-0072', 237).run();
    await env.DB.prepare(outbox).bind('runtime-outbox-0072', 'synthetic-first', 'A101').run();
    await expect(
      env.DB.batch([
        env.DB.prepare(outbox).bind('runtime-rolled-back-0072', 'synthetic-second', 'A102'),
        env.DB.prepare(publication).bind('runtime-conflict-0072', 237),
      ]),
    ).rejects.toThrow('final_publication_revision_conflict');
    for (const sql of [
      "UPDATE final_portal_publications SET manifest_json='[]'",
      'DELETE FROM final_portal_publications',
    ]) {
      await expect(env.DB.prepare(sql).run()).rejects.toThrow('final_publication_immutable');
    }
    await expect(
      env.DB.prepare("UPDATE final_portal_outbox SET payload_json='[]'").run(),
    ).rejects.toThrow('final_outbox_source_immutable');
    await expect(env.DB.prepare('DELETE FROM final_portal_outbox').run()).rejects.toThrow(
      'final_outbox_history_retained',
    );
    await env.DB.prepare(
      "UPDATE final_portal_outbox SET status='done',attempts=1,synced_at=10",
    ).run();
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS n FROM final_portal_publications').first(),
    ).toEqual({ n: 1 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM final_portal_outbox').first()).toEqual({
      n: 1,
    });
    expect(
      await env.DB.prepare('SELECT payload_json,status,attempts FROM final_portal_outbox').first(),
    ).toEqual({ payload_json: '{}', status: 'done', attempts: 1 });
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});
