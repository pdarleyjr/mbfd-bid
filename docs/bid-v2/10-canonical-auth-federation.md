# Canonical Hub authentication

The active Bid web flow redirects humans to MBFD Hub and never renders or submits a Hub password.

- `/api/auth/start` creates the random five-minute state transaction and selects the exact callback
  from the deployed Bid environment.
- `/api/auth/callback` validates and consumes state, sends only the opaque code and exact callback to
  the Bid Worker, verifies the returned Bid JWT, and installs the HTTP-only Bid session cookie.
- Worker `POST /api/auth/exchange` sends the code to Hub over the existing authenticated server bridge,
  requires Hub issuer and `bid` audience, and preserves Hub's current role decision without a local
  administrator override.
- Admin step-up redirects through the same canonical flow; it does not ask for credentials in Bid.

Bid no longer exposes the legacy Worker `/api/auth/login` route or uses Hub
`/api/v2/verify-credentials`. All human Bid authentication uses this
authorization-code exchange and the Hub revalidation contract.
