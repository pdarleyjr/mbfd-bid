import { expect, it } from 'vitest';
import { publicWebOrigin } from '../../src/lib/public-web-origin.js';

it('limits the loopback origin to the explicitly synthetic federation', () => {
  expect(
    publicWebOrigin({
      ENV: 'test',
      PORTAL_BASE_URL: 'https://test.invalid',
      WEB_BASE_URL: 'http://127.0.0.1:3000',
    }),
  ).toBe('http://127.0.0.1:3000');
  expect(
    publicWebOrigin({
      ENV: 'test',
      PORTAL_BASE_URL: 'https://hub.test.invalid',
      WEB_BASE_URL: 'http://127.0.0.1:3000',
    }),
  ).toBe('https://bid.test.invalid');
  expect(
    publicWebOrigin({
      ENV: 'production',
      PORTAL_BASE_URL: 'https://test.invalid',
      WEB_BASE_URL: 'http://127.0.0.1:3000',
    }),
  ).toBe('https://bid.mbfdhub.com');
});
