import { expect, it } from 'vitest';
import { catalogDependencies } from '../../src/lib/credential-catalog.js';
import { seedSyntheticOfficialCompletion } from './helpers/synthetic-official-completion.js';
import { setupTestD1, teardownTestD1 } from './helpers/test-d1.js';

it('finds credential references inside serialized frozen rules without changing historical bytes', async () => {
  const h = await setupTestD1();
  try {
    h.sqlite.pragma('foreign_keys = ON');
    seedSyntheticOfficialCompletion(h, [
      {
        id: 'training',
        credential: 'Synthetic training',
        sourceRef: 'Synthetic approved test clause',
        deadline: {
          basis: 'FINAL_POSITION_AWARD',
          unit: 'CALENDAR_MONTHS',
          count: 3,
          timeZone: 'America/New_York',
        },
      },
    ]);
    h.sqlite.exec(
      "INSERT INTO credentials (id,name,fy_points_default) VALUES (901,'Synthetic training',0),(902,'Unreferenced synthetic credential',0)",
    );
    const original = h.sqlite
      .prepare('SELECT snapshot_json FROM bid_session_policy_snapshots')
      .all();
    h.sqlite.exec(`INSERT INTO member_qualification_events (id,member_id,credential_id,kind,effective_on,evidence_source,reason,actor_subject,idempotency_key,before_state,after_state,created_at)
      VALUES ('synthetic-qualification',99,901,'CERTIFICATION_GAINED','2027-01-01','synthetic-reviewed-source','Synthetic history fixture','99','synthetic-qualification','{}','{}',1)`);
    const found = await catalogDependencies(h.env.DB, 901);
    expect(found).toMatchObject({
      frozenSessionReferences: [{ sessionId: 'annual-real-2027', year: 2027, isMock: 0 }],
      retirementBlocked: false,
      memberReferences: 1,
      qualificationEventReferences: 1,
    });
    expect(await catalogDependencies(h.env.DB, 902)).toMatchObject({ frozenSessionReferences: [] });
    expect(
      h.sqlite.prepare('SELECT snapshot_json FROM bid_session_policy_snapshots').all(),
    ).toEqual(original);
    expect(h.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    await teardownTestD1(h);
  }
});
