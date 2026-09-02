# Bid SSO completion candidate

Hub contract baseline: `a69489ef2583c6278d5ff5da867404a4e4d2cdcf`.

The only normal-human Bid sign-in flow is `/login` → `/api/auth/start` → Hub
`/auth/bid/authorize` → Bid callback → Worker code exchange.  Bid never
accepts, stores, logs, or forwards a human password.  `/api/auth/login` and
the staging local-admin/bootstrap path are removed.

## Identity model

| Claim | Meaning |
| --- | --- |
| `sub` and `hub_user_id` | Canonical Hub User identity. |
| `member_id` | Operational Bid member identity; all member and action-grant lookups use this field. |
| `emp` | Operational employee ID. |
| `role` | Current Hub-derived Bid base role. |
| `security_version` | Hub-owned session invalidation version. |
| `fresh_auth_at` | Last interactive Hub authentication or step-up. |
| `authz_checked_at` | Last confirmed Hub authorization/revocation check. |

Prior `sub` consumers were audited into three classes: Bid roster, policy and
action-grant uses now read `member_id`; audit/subject fields retain canonical
`sub`; and WebSocket tickets carry canonical `sub` plus explicit `member_id`.
This prevents a Hub User ID from being interpreted as an operational member.

## Federation and revalidation

Worker exchange and revalidation use only `PORTAL_BID_FEDERATION_TOKEN`.
`PORTAL_BID_READER`, if provisioned, is an optional read-only Hub-to-Bid
portal bridge credential and is never a fallback for exchange or revalidation.

The exchange validates Hub issuer, `audience: bid`, canonical user/member
fields, security version, role, and the exact environment callback. The
revalidation request is:

```json
{"hub_user_id": 1, "security_version": 1, "member_id": 1}
```

The Hub response is fail-closed for issuer, audience, canonical user, member,
employee ID, security version, and role. An administrator is reusable for
strictly less than 300 seconds; a member is reusable for strictly less than
900 seconds. A stale session is denied when Hub is unavailable or rejects its
identity. Successful revalidation replaces the short-lived session context
with updated role and `authz_checked_at`; admin proxies persist that refresh
only in the HttpOnly Bid cookie.

WebSocket tickets are one-minute, session-scoped, audience-bound credentials
issued only after forced Hub revalidation. They include canonical identity,
explicit member ID, role, and security version. The Worker accepts no query
credential and remains responsible for live mutation/action-grant checks.

## Browser safety and logout

The callback mapping is fixed to `https://bid.mbfdhub.com/api/auth/callback`
or `https://staging.bid.mbfdhub.com/api/auth/callback`; client and audience are
both `bid`. Deep links are local-path-only and cryptographically bound into the
short-lived federation-state cookie. Authentication routes and `login` loops,
schemes, scheme-relative URLs, and backslashes are rejected. Bid logout clears
only Bid first-party cookies; it does not log the user out of Hub.

## Remaining staging qualification

Provision or verify by name only: `PORTAL_BASE_URL`,
`PORTAL_BID_FEDERATION_TOKEN`, `JWT_SIGNING_KEY`, `ENV`, and the optional
read-only `PORTAL_BID_READER` where the Hub portal bridge remains enabled.
Validate real Hub exchange/revalidation, callback registration, cookie scope,
admin entitlement revocation, disabled/link-invalid users, security-version
invalidation, and live WebSocket reconnect behavior. No deployment, Hub
change, D1 mutation, portal writeback, or secret rotation is part of this
candidate.
