import { afterEach, expect, it, vi } from 'vitest';
import { publicWebOrigin } from '../../lib/public-web-origin';

afterEach(() => vi.unstubAllEnvs());

it('accepts the loopback rehearsal origin only in development staging', () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('MBFD_LOCAL_REHEARSAL_ORIGIN', 'http://127.0.0.1:3000');
  expect(publicWebOrigin('staging')).toBe('http://127.0.0.1:3000');
  expect(publicWebOrigin('production')).toBe('https://bid.mbfdhub.com');
  vi.stubEnv('NODE_ENV', 'production');
  expect(publicWebOrigin('staging')).toBe('https://staging.bid.mbfdhub.com');
});
