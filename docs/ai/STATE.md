# Current state

- Branch and remote head before remediation: `feat/mbfd-bid-v2` at `103f9dffbfb9abc34e4dfc72ab46b71ddf81c832`, divergence `0/0`; PR #96 is open draft against `main`.
- Staging D1 is read-only in this task: ledger last `0023_bid_position_participation.sql`; exactly `0024`–`0037` are pending; `quick_check=ok`; foreign-key check is empty.
- Current staging versions before any change: API `499bccc6-2681-45ab-b5ab-eada27d4ae6b`; Web `869f9cb8-ea5e-42d4-a00a-90d1857763f3`.
- Secret-name inventory shows API has `PRINT_TOKEN_SECRET` and `JWT_SIGNING_KEY` but lacks `TELESTAFF_HMAC_KEY`; Web has `JWT_SIGNING_KEY` but lacks `PRINT_TOKEN_SECRET`.
- `mbfd-bid-staging-backups` does not exist. Existing scheduled backup jobs are failing; none was in progress during the read-only baseline.
- Portal boundary remains intact: `PORTAL_WRITEBACK_ENABLED=false`; `PORTAL_BID_WRITER` absent; the staging queue has zero consumers.
- An active mock session remains in `position_bid`. No secret, R2, D1, application, route, DNS, or production mutation may proceed until the maintenance window is explicitly cleared.
- Ordinary staging deployment now runs `scripts/assert-staging-d1-migration-guard.mjs`, which compares the complete remote managed ledger with canonical migration names and fails closed. It never invokes migration apply.

## Preserved reliability checkpoint evidence

- Earlier branch checkpoint: `272f112b90a866bc628d50288bd64d72555ad730`; preserved remote PR head: `774bc5248a801d51b4ebca385d66338fcb947c5a`.
- Managed local D1 proofs covered clean `0001`–`0037`, staging-shaped `0023`–`0037`, and stepwise `0024`–`0037` with 37 migration-ledger rows, `quick_check=ok`, and empty foreign-key checks.
- The earlier full suite reported 260 files, 1,507 passed, 4 intentional skips, and zero failures. Tooling included `@cloudflare/vitest-plugin` 1.0.0, Vitest 4.1.0, Wrangler 4.125.0, and Workers types 5.20260820.1.
- Genuine named Durable Object eviction, durable specialty state/receipt reconstruction, exact-once resume, duplicate-resume rejection, and standard-WebSocket recovery with asynchronous rejection handling were proven locally.
- The earlier native Linux proof used disposable GMKtec portable Node 22.22.1 / pnpm 9.12.0 with 752-file SHA parity; frozen install, lint, package build, typecheck, Next/OpenNext build, loopback Workerd preview, and HTTP 200 passed. No host services or system packages changed.
