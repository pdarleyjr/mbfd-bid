# Operator sign-in recovery

The five-minute interactive sign-in requirement remains server enforced at exactly 300 seconds, with future timestamps rejected. Revalidating Hub authorization or refreshing a WebSocket ticket does not renew `fresh_auth_at`. Revoked, disabled, unlinked or changed-security-version identities still fail closed.

The console shows the remaining operator freshness and opens recovery when an authoritative request requires fresh authentication. An expired or unverified context does not forward an operator write. Recovery opens Hub sign-in in a separate tab, retains the original console and unfinished reason, and performs a no-store server status recheck. The status endpoint verifies the existing signed admin token, invokes Worker/Hub revalidation and verifies the returned signed token has the same Hub user, local member, security version and admin role. Its response contains timing and identity only; access credentials remain HttpOnly.

The same original operator may recover. A changed identity or security version blocks the retained console until it is reopened. Failure, cancellation or Hub unavailability preserves the draft and leaves writes blocked. Neither a successful sign-in nor the recheck submits or replays a command. Canonical state must refresh and the operator must deliberately review and confirm the next action with current sequence and the existing idempotency semantics.

Browser event contract in `apps/web/lib/operator-step-up.ts`:

- `BEFORE_OPERATOR_COMMAND` / `mbfd-before-operator-command`: cancelable local guard before a protected mutation. The canonical server remains authoritative.
- `OPERATOR_STEP_UP_REQUIRED` / `mbfd-operator-step-up-required`: recognized401 freshness/identity rejection opens recovery and blocks subsequent writes.
- `OPERATOR_REAUTH_STARTED` / `mbfd-operator-reauth-started`: emitted before opening Hub sign-in or beginning the recheck. Canonical UI listeners retain their earliest pending sequence for review across the recovery attempt.
- `OPERATOR_AUTH_REFRESHED` / `mbfd-operator-auth-refreshed`: emitted only after a successful same-identity server recheck and query invalidation. Consumers refresh their canonical state; they never issue a command on this event.

The shared CSRF wrapper handles clients that captured fetch before the provider mounted, checks freshness again after nonce acquisition and invalidates its nonce cache after recovery. The WebSocket hook closes the previous transport, obtains a freshly revalidated opaque ticket and resumes from the current store sequence. Generation guards discard late ticket responses and callbacks from the prior transport. No access JWT is put in the browser URL or WebSocket hello frame.

Validation uses synthetic identities and actual JWT signing/verification for the status route. It covers same-identity success, revocation, unavailable Hub, changed identities/versions, role downgrade, bad signatures, the unchanged freshness boundary, cancellation, draft retention, no replay, CSRF refresh and WebSocket reconnect races. Production browser acceptance remains a separate release gate.
