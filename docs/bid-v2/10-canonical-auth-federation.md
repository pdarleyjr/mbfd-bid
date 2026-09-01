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

The legacy Worker `/api/auth/login` and Hub `/api/v2/verify-credentials` endpoints are retained for a
safe deployment transition. They are not called by the active Bid web or step-up path. Retire them only
after Hub is deployed first, Bid is deployed second, and production evidence shows zero legacy use.
