/**
 * Exact browser origins trusted for credentialed, state-changing Web routes.
 * Do not derive this from Host/request.url because the application runs behind
 * the Cloudflare edge proxy.
 */
export function publicWebOrigin(env: string | undefined): string | null {
  if (env === 'production') return 'https://bid.mbfdhub.com';
  if (env === 'staging') return 'https://staging.bid.mbfdhub.com';
  return null;
}

export function isExpectedPublicWebOrigin(env: string | undefined, origin: string | null): boolean {
  const expected = publicWebOrigin(env);
  return expected !== null && origin === expected;
}
