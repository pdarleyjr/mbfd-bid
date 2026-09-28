import { expect, it } from 'vitest';
import { publicWebOrigin } from '../../src/lib/public-web-origin.js';

it('limits the loopback origin to the synthetic staging federation', () => {
  expect(
    publicWebOrigin({
      ENV: 'staging',
      PORTAL_BASE_URL: 'https://test.invalid',
      WEB_BASE_URL: 'http://127.0.0.1:3000',
    }),
  ).toBe('http://127.0.0.1:3000');
  expect(
    publicWebOrigin({
      ENV: 'staging',
      PORTAL_BASE_URL: 'https://staging.mbfdhub.com',
      WEB_BASE_URL: 'http://127.0.0.1:3000',
    }),
  ).toBe('https://staging.bid.mbfdhub.com');
  expect(
    publicWebOrigin({
      ENV: 'production',
      PORTAL_BASE_URL: 'https://test.invalid',
      WEB_BASE_URL: 'http://127.0.0.1:3000',
    }),
  ).toBe('https://bid.mbfdhub.com');
});
