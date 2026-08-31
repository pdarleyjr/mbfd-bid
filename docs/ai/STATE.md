# Current state

## 2026-08-31 controlled staging convergence

- **Annual data readiness / final rehearsal is blocked before mutation.** A read-only search of the authorized local Bid and Chief Abello shared-file sources found no current raw TeleStaff `(EX) Export Assignments` HTML report. The only current-looking export is an Excel XML workbook, `TELESTAFF (EX) Export All Records (9).xml`, last written 2026-05-27; the staging ingestion contract accepts only the unmodified HTML report with `Name`, `Emp ID`, `Shift`, `Division`, `Station`, `Unit`, `Position`, and `A R Day` semantic columns. It must not be converted, seeded, or represented as an accepted baseline. The companion 2026 vacation XML is not an assignment report.
- No annual configuration, rule-book designation, source import, assignment, accepted staffing baseline, or fresh mock was created. The user-authorized staging-rehearsal path remains available only after an operator supplies a current official TeleStaff HTML assignment export and completes the audited preview/reconciliation/review/apply/accepted-baseline workflow.
- The checked-in 2026 policy material is useful reference but is not fully determinate configuration authority: it expressly requires admin confirmation of Fire Investigator inclusion and leaves the Station 6 Marine FF/Post St.6 dashboard classification open. Those decisions must be recorded before a staging-only configuration can be designated from the documents. A211/B211/C211 remain occupant-specific authoritative-assignment exclusions, not rank-wide exclusions.
- Read-only Workers version inventory reconfirmed that API serving evidence remains the secret-only version `6d8ef44a-27e3-4399-9fb6-f844e6868cb6`; no secret was rotated in this annual-readiness assessment.
- Runtime candidate: `4779ae9308fb324e4f55971a4b2501cccceff258`; integrated release-evidence head: `8a6a042764801b3d4cf4e6968a3f2b5fae70cdd4`. The intervening commit changes only `docs/ai/**`; runtime paths are identical. PR #96 remains open draft against `main`.
- Staging D1 was migrated through `0037_staffing_baseline_trigger_decomposition.sql` by the isolated one-file Wrangler procedure. Final ledger count is 37; no migrations remain; `quick_check=ok`; foreign-key check is empty. The final recovery bookmark before the sequence is `00000160-00000000-000050d8-8f9f476d3b4d0791d15cd8df4f4c3b5f`.
- Two stale mock sessions were closed through the deployed audited `close-mock` API lifecycle; their bid/audit history is retained, readiness reports zero open mocks, and canonical staffing counts remain members=235, positions=233, assignments=0, non-mock bids=0.
- Private staging backup bucket `mbfd-bid-staging-backups` now has an independently retrieved hash-equality artifact: `d1/2026-08-31/mbfd-bid-staging-8a6a042-20260831-064238.sql` (1,078,788 bytes; SHA-256 retained in terminal evidence, not source).
- The exact detached Linux candidate was rebuilt with Node 22.22.1 / pnpm 9.12.0. Frozen install, lint, package builds, typecheck, 206 Web tests, production audit, OpenNext build (57 MiB/1,565 files) and loopback root HTTP 200 passed. Web is deployed as `b595f374-7624-4df1-b441-c015b5ea686f`; the API exact-candidate upload is `a56cfaa4-deab-4bac-b42f-9021920f05c5`, followed only by the serving staging-secret version `6d8ef44a-27e3-4399-9fb6-f844e6868cb6`.
- Fresh staging PIN/API/browser authentication was proven fail-closed and successful through the Admin Console. Staging-only admin/PIN values were rotated again after the acceptance run and are not retained.
- A fresh mock cannot be created through the approved UI: no designated annual configuration exists and the authoritative staffing baseline is not loaded. Existing stale mocks remain closed; no direct-D1 bypass was performed.
- Portal boundary remains intact: `PORTAL_WRITEBACK_ENABLED=false`; `PORTAL_BID_WRITER` is absent; queue consumers remain zero. No production resource was touched.

## Superseded pre-convergence baseline (historical context only)

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
