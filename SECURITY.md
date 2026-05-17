# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this repository, please **do not
open a public issue**. Instead:

1. Email the maintainer directly: `pdarleyjr@gmail.com`
2. Include a description, reproduction steps, and impact assessment.
3. Allow a reasonable disclosure window (target: 30 days) before public
   disclosure.

We treat all reports confidentially and will acknowledge receipt within 48
hours.

## Scope

Critical surfaces:
- The PIN gate (no IDOR / bypass)
- Employee Portal SSO integration (`/api/auth/login`)
- Admin endpoints (every write must pass step-up auth)
- Audit log integrity (hash chain + signatures)
- WebSocket protocol on the BidSession Durable Object
- Portal write-back queue + payload

Out of scope (will be marked invalid):
- Findings against third-party services not under our control (Cloudflare, Anthropic)
- Issues requiring physical access to a privileged user's device
- Self-XSS / clickjacking on unauthenticated pages (PIN gate is the
  primary protection; defense in depth still applies to authenticated pages)

## Secrets handling

- **Never** commit secrets to this repository.
- All Cloudflare secrets must go through `wrangler secret put NAME --env <env>`.
- All CI secrets must be set in GitHub repository secrets via the Actions UI
  or `gh secret set`.
- Tokens that appear in commit history must be rotated immediately.
- The `.gitignore` blocks `.env`, `.dev.vars`, and similar; do not bypass.
- Push protection + secret scanning are enabled at the GitHub level.

## Authentication

- JWTs use HS256 with an 8-hour expiry and a `fresh_auth_at` claim.
- Admin writes require `fresh_auth_at` within 5 minutes (step-up).
- PIN gate cookie is HttpOnly, Secure, SameSite=Strict, 7-day TTL.
- CSRF: SameSite cookies + double-submit token on state-changing POST.

## Data protection

- The audit log is dual-written: D1 (queryable) + R2 hash-chained JSONL (legal).
- Member roster + cert data is imported from authoritative HR sources at the
  start of each bid year; the app is not the system of record.
- Portal write-back is one-way (bid app → portal); the portal owns its own
  data once written.

## Threat model

See [`docs/architecture.md`](docs/architecture.md) (forthcoming in Plan 01) for
the full threat model. Key threats:

1. Unauthorized member action on another member's behalf
2. Admin abuse of force-pick to subvert the bid
3. Audit log tampering after the fact
4. Compromised admin credentials
5. DO crash mid-bid leading to data loss

Each threat has a mapped mitigation in the spec and is verified by integration
tests in Plan 09 (Hardening).
