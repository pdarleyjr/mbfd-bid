# Staging remediation QA

## 2026-08-31 controlled convergence evidence

- PASS — focused mock-close TDD regression (14 tests), Worker lint/typecheck, Worker suite (978 passed, 1 skipped), and Wrangler launcher tests (25 passed).
- PASS — R2 backup create/upload/retrieve/hash equality: 1,078,788-byte staging export uploaded under an 8a6a042-scoped key and retrieved byte-for-byte (SHA-256 equality).
- PASS — controlled one-at-a-time D1 migration sequence `0024` through `0037`; every post-step ledger/integrity/protected-count gate passed. Final remote guard reports `STAGING_D1_MIGRATION_GUARD_PASS`.
- PASS — exact detached Linux checkout `8a6a042` (Node 22.22.1 / pnpm 9.12.0): frozen install, lint, package builds, full workspace typecheck, 206 Web tests, and production dependency audit (no known vulnerabilities).
- PASS — OpenNext staging build and loopback preview root HTTP 200; artifact contained 1,565 files / 57 MiB. Exact web deployed as `b595f374-7624-4df1-b441-c015b5ea686f`.
- PASS — fresh staging PIN and admin authentication: invalid login and PIN failed closed, valid API auth and PIN succeeded, and a clean browser reached `/admin` with no console errors. API candidate upload `a56cfaa4-deab-4bac-b42f-9021920f05c5` followed the observed auth failure; its current serving version is secret-only `6d8ef44a-27e3-4399-9fb6-f844e6868cb6`.
- BLOCKED (real configuration gate, not a source/deploy failure) — fresh mock lifecycle, staffing, print, and WebSocket end-to-end flow require a designated annual configuration and authoritative staffing baseline. The UI explicitly reports both absent; direct D1 seeding was not authorized.

- Read-only D1 baseline: ledger ends at `0023_bid_position_participation.sql`; pending is exactly `0024`–`0037`; `PRAGMA quick_check` returned `ok`; `PRAGMA foreign_key_check` returned no rows; reported D1 writes: zero.
- Deployment-guard red test: before the workflow change, the static test failed because `deploy-staging.yml` invoked `wrangler d1 migrations apply`.
- Deployment-guard green test: `node scripts/test-deploy-staging-migration-guard.mjs` passes after the change.
- Live negative test: `node scripts/assert-staging-d1-migration-guard.mjs` correctly blocks ordinary deployment while the remote ledger ends at `0023` and canonical source ends at `0037`.
- Local deterministic validation passed: frozen install; Biome lint; workspace typecheck; eligibility `84` passed / `3` intentional skips; shared `156` passed; A-Day `62` passed; Web `206` passed; Worker deterministic `974` passed / `1` skip; Worker launchers `25` passed; D1 backup preflight; production dependency audit; and diff/credential-pattern scans.
- Windows Next/OpenNext compilation completed through the Next compile phase, but OpenNext explicitly warns that Windows is not a fully compatible runtime. The final Linux/OpenNext runtime gate was not rerun for this configuration-only change.
- Remaining remote acceptance is blocked, not passed: paired JWT/print-secret rotation, TeleStaff configuration preview, fresh authentication, private R2 backup create/upload/retrieval, and controlled version rollback verification require a confirmed quiet staging window.

## Preserved reliability checkpoint review

- Independent read-only review found P0=0 and P1=0. Its P2 was the intentional Worker test-tool migration refreshing transitive lockfile entries; direct dependency changes were scoped to the required Cloudflare test stack.
- It recorded deterministic frozen install, lint, package build, typecheck, workspace suite, production build, production audit, D1 backup preflight, and dedicated runtime eviction matrix evidence.
- Its clean Linux/OpenNext evidence used a disposable GMKtec portable Node 22.22.1 and pnpm 9.12.0 root with 752-file SHA parity, frozen install, lint, package build, typecheck, Next/OpenNext build, loopback preview, and HTTP 200. The validation root and processes were removed.
- Its remaining blocker was staging D1 migration progression, requiring a separate high-risk per-migration strategy and verification review.
