# Production configuration and secret inventory

This inventory lists names and ownership. It contains no credential values. The obsolete deployment and its provisioning helpers were retired on 2026-10-01; production values and identities are preserved.

| Name | Owner | Purpose |
| --- | --- | --- |
| `JWT_SIGNING_KEY` | Production API and Web Workers | Matching Bid JWT verification/signing material; rotations require a separately authorized paired change and fresh normal sign-in proof. |
| `PORTAL_BID_FEDERATION_TOKEN` | Production API Worker | Dedicated Hub authorization-code exchange and identity revalidation credential. |
| `TELESTAFF_HMAC_KEY` | Production API Worker | Dedicated stable source-reference HMAC key; never substitute the JWT key. |
| `AUDIT_SIGNING_PRIVKEY`, `AUDIT_SIGNING_PUBKEY` | Production API Worker | Existing audit-signature keys. |
| `PRINT_TOKEN_SECRET` | Production API Worker | Print-token authorization, with the existing explicit JWT fallback retained. |
| `PORTAL_BID_READER` | Optional production API integration | Read-only Hub bridge capability; it does not grant normal-human authentication or publication. |
| `PORTAL_BID_WRITER` | Must remain absent while writeback is disabled | Requires separate future authorization. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Authorized GitHub production jobs | Existing account-scoped release, read-only preflight and private backup operations. |

Web `WORKER_URL` and `WORKER_BASE_URL` remain `https://api.bid.mbfdhub.com`; Worker `WEB_BASE_URL` remains `https://bid.mbfdhub.com`; Worker `PORTAL_BASE_URL` remains `https://www.mbfdhub.com`. `NEXT_PUBLIC_WORKER_BASE` is an API build target, not a secret. Both deployed environments are explicitly `production`.

The access PIN remains canonical and KV-backed. No default PIN, local-admin password, copied environment credentials, automatic step-up refresh or invented identity is supplied. Command authority still requires the existing fresh five-minute Hub authentication.

Secret-name discovery alone does not prove compatible values or successful sign-in. Preserve the existing production values and verify normal authenticated acceptance after the authorized release.
