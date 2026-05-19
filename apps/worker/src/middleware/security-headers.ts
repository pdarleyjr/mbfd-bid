// Plan 09 Task 4 — Security headers applied to every Worker response.
//
// Wired in `apps/worker/src/index.ts` as a global Hono middleware so every
// API response (JSON, WS upgrade, error) carries the same defaults. The
// equivalent for the Pages frontend lives in `apps/web/public/_headers`.
//
// CSP is deliberately tight (`default-src 'none'`) because the Worker only
// serves application/json — there's no script, style, or image surface.
// `frame-ancestors 'none'` is repeated as a defense-in-depth alongside
// `x-frame-options: DENY` for older browsers.

export function applySecurityHeaders(h: Headers): void {
  h.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('referrer-policy', 'no-referrer');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('cross-origin-opener-policy', 'same-origin');
}
