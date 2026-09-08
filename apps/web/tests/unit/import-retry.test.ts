import { expect, it, vi } from 'vitest';
import { AnnualRequestError } from '../../app/admin/annual-plan/annual-plan-client';
import { retryImportGroup } from '../../app/admin/targetsolutions/import-retry';

it.each([429, 503])('recovers from temporary %s without changing the command', async (status) => {
  const command = { key: 'same-reviewed-command', safe: true };
  const sendCommand = vi
    .fn()
    .mockRejectedValueOnce(new AnnualRequestError(status, 'authorization_unavailable', 'Hub busy'))
    .mockResolvedValue({ processed: 20 });
  const wait = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  const result = await retryImportGroup(
    () => sendCommand(command),
    new AbortController().signal,
    vi.fn(),
    wait,
  );
  expect(result).toEqual({ processed: 20 });
  expect(sendCommand.mock.calls).toEqual([[command], [command]]);
  expect(wait).toHaveBeenCalledTimes(1);
});

it.each([
  [401, 'step_up_required'],
  [403, 'invalid_identity'],
  [409, 'stale_review'],
  [503, 'misconfigured'],
])('never retries %s %s', async (status, code) => {
  const failure = new AnnualRequestError(Number(status), String(code), 'Review needed');
  const send = vi.fn().mockRejectedValue(failure);
  await expect(retryImportGroup(send, new AbortController().signal, vi.fn(), vi.fn())).rejects.toBe(
    failure,
  );
  expect(send).toHaveBeenCalledTimes(1);
});

it('stops during backoff without issuing another command', async () => {
  const controller = new AbortController();
  const send = vi
    .fn()
    .mockRejectedValue(new AnnualRequestError(503, 'authorization_unavailable', 'Hub busy'));
  const retrying = retryImportGroup(send, controller.signal, () => controller.abort());
  expect(await retrying).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
});

it('bounds retries during a prolonged outage', async () => {
  const failure = new AnnualRequestError(503, 'authorization_unavailable', 'Hub unavailable');
  const send = vi.fn().mockRejectedValue(failure);
  const wait = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  await expect(retryImportGroup(send, new AbortController().signal, vi.fn(), wait)).rejects.toBe(
    failure,
  );
  expect(send).toHaveBeenCalledTimes(6);
  expect(wait.mock.calls.map((call) => call[0])).toEqual([5000, 10000, 20000, 40000, 60000]);
});
