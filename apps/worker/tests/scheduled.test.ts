import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../src/index.js';
import type { WorkerEnv } from '../src/types/env.js';

describe('scheduled handler', () => {
  let env: WorkerEnv;
  let d1Prepare: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const statement = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn().mockResolvedValue({ results: [] }),
      raw: vi.fn().mockResolvedValue([]),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    d1Prepare = vi.fn(() => statement);
    env = {
      ENV: 'staging',
      PORTAL_BASE_URL: 'https://portal.example',
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
});
