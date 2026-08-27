import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../src/index.js';
import type { WorkerEnv } from '../src/types/env.js';

describe('scheduled handler', () => {
  let env: WorkerEnv;
  let d1Prepare: ReturnType<typeof vi.fn>;
  let portalAll: ReturnType<typeof vi.fn>;
  let outboxAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    portalAll = vi.fn().mockResolvedValue({ results: [] });
    outboxAll = vi.fn().mockResolvedValue({ results: [] });
    const makeStatement = (all: ReturnType<typeof vi.fn>) => ({
      bind: vi.fn().mockReturnThis(),
      all,
      raw: vi.fn().mockResolvedValue([]),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    });
    const portalStatement = makeStatement(portalAll);
    const outboxStatement = makeStatement(outboxAll);
    d1Prepare = vi.fn((query: string) =>
      query.includes('bid_audit_outbox') ? outboxStatement : portalStatement,
    );
    env = {
      ENV: 'production',
      PORTAL_BASE_URL: 'https://portal.example',
      PORTAL_WRITEBACK_ENABLED: 'true',
      PORTAL_WRITEBACK_BASE_URL: 'https://portal-writeback.example',
      PORTAL_BID_WRITER: 'test-writer',
      DB: { prepare: d1Prepare } as never,
      PORTAL_QUEUE: { send: vi.fn() } as never,
    } as unknown as WorkerEnv;
  });

  it('ignores the retired per-minute AI forecast cron', async () => {
    await handler.scheduled({ cron: '*/1 * * * *' } as ScheduledEvent, env, {} as ExecutionContext);
    expect(d1Prepare).not.toHaveBeenCalled();
    expect(env.PORTAL_QUEUE.send).not.toHaveBeenCalled();
  });

  it('preserves the daily portal reconciliation cron', async () => {
    await handler.scheduled({ cron: '15 4 * * *' } as ScheduledEvent, env, {} as ExecutionContext);
    expect(d1Prepare).toHaveBeenCalled();
    expect(env.PORTAL_QUEUE.send).not.toHaveBeenCalled();
  });

  it('repairs due canonical audit archives on the retained daily cron when R2 is bound', async () => {
    env.PORTAL_QUEUE = {} as never;
    env.R2_AUDIT = { put: vi.fn() } as never;

    await handler.scheduled({ cron: '15 4 * * *' } as ScheduledEvent, env, {} as ExecutionContext);

    expect(d1Prepare).toHaveBeenCalled();
    expect(env.R2_AUDIT.put).not.toHaveBeenCalled();
  });

  it('repairs canonical audit archives even when portal reconciliation fails', async () => {
    env.R2_AUDIT = { put: vi.fn() } as never;
    d1Prepare.mockImplementation((query: string) => {
      if (query.includes('portal_writeback_queue')) {
        throw new Error('simulated portal reconciliation failure');
      }
      return query.includes('bid_audit_outbox')
        ? {
            bind: vi.fn().mockReturnThis(),
            all: outboxAll,
            raw: vi.fn().mockResolvedValue([]),
            first: vi.fn().mockResolvedValue(null),
            run: vi.fn().mockResolvedValue({ success: true }),
          }
        : undefined;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      handler.scheduled({ cron: '15 4 * * *' } as ScheduledEvent, env, {} as ExecutionContext),
    ).resolves.toBeUndefined();

    expect(outboxAll).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
