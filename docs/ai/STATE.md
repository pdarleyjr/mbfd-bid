# Current state

## 2026-08-31 controlled staging convergence

- Candidate branch/head: `feat/mbfd-bid-v2` / `4779ae9308fb324e4f55971a4b2501cccceff258`; PR #96 remains open draft against `main`.
- Staging D1 was migrated through `0037_staffing_baseline_trigger_decomposition.sql` by the isolated one-file Wrangler procedure. Final ledger count is 37; no migrations remain; `quick_check=ok`; foreign-key check is empty. The final recovery bookmark before the sequence is `00000160-00000000-000050d8-8f9f476d3b4d0791d15cd8df4f4c3b5f`.
- Two stale mock sessions were closed through the deployed audited `close-mock` API lifecycle; their bid/audit history is retained, readiness reports zero open mocks, and canonical staffing counts remain members=235, positions=233, assignments=0, non-mock bids=0.
- Private staging backup bucket `mbfd-bid-staging-backups` now exists. The repository backup script exported a 998086-byte D1 artifact and uploaded `d1/2026-08-31/mbfd-bid-staging-2026-08-31-0615.sql`. Retrieval/integrity comparison remains to be independently completed.
- API staging version is `a5f22d5f-8789-47f9-9de8-8bf301a729a2`, with staging-only JWT, print, and TeleStaff HMAC secret names installed. Web has JWT/print secret names, but remains on prior version `71de896c-55d8-4669-9639-fba28b3bae6d` pending an exact-candidate Linux/OpenNext build/deploy.
- Portal boundary remains intact: `PORTAL_WRITEBACK_ENABLED=false`; `PORTAL_BID_WRITER` is absent; queue consumers remain zero. No production resource was touched.

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
