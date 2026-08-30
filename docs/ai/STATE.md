# Current state

- Branch: `feat/mbfd-bid-v2`
- Starting checkpoint: `272f112b90a866bc628d50288bd64d72555ad730`
- Preserved remote PR head: `774bc5248a801d51b4ebca385d66338fcb947c5a`
- Managed local D1 proofs: clean 0001-0037, staging-shaped 0023-0037, and stepwise 0024-0037 passed with 37 migration-ledger rows, `quick_check=ok`, and empty foreign-key checks.
- Current full-suite proof: 260 files, 1,507 passed, 4 intentional skips, zero failures.
- Reliability tooling: `@cloudflare/vitest-plugin` 1.0.0, Vitest 4.1.0, Wrangler 4.125.0, and Workers types 5.20260820.1.
- Genuine named Durable Object eviction is proven: in-memory sentinel reset, durable specialty state/receipt reconstruction, exact-once resume, and duplicate-resume rejection.
- Standard-WebSocket recovery is proven with a fresh ticket/new socket after eviction. The synchronous listener observes rejected async handlers, removes the client, and closes the affected socket with 1011.
- Native Linux proof used disposable GMKtec portable Node 22.22.1 / pnpm 9.12.0 with 752-file SHA parity; frozen install, lint, package build, typecheck, Next/OpenNext build, loopback Workerd preview, and HTTP 200 passed. No host services or system packages changed.
- Portal publication remains disabled: `PORTAL_WRITEBACK_ENABLED=false`; portal bid writer absent; portal consumers zero.

NEXT_TICKET = staging D1 migration-risk architecture review

Next exact action: design an approved per-migration staging verification and rollback procedure; do not deploy or migrate staging yet.
