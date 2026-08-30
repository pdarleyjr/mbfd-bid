# Current state

- Branch: `feat/mbfd-bid-v2`
- Local base/head before checkpoint: `d0e895dbc8ef4c5fd23ee10f7880584c87e5b8a0`
- Preserved remote PR head: `774bc5248a801d51b4ebca385d66338fcb947c5a`
- Managed local D1 proofs: clean 0001-0037, staging-shaped 0023-0037, and stepwise 0024-0037 passed with 37 migration-ledger rows, `quick_check=ok`, and empty foreign-key checks.
- Current full-suite proof: eligibility 84 passed/3 skipped; shared 156; A-Day 62; worker 974 passed/1 skipped; Wrangler launchers 25; web 206.
- Native Linux proof: Node 22.22.1, pnpm 9.12.0; frozen install, lint, package build, typecheck, Next build, OpenNext build, and local Workerd root HTTP 200 passed.
- Known blocker/limitation: forced Durable Object eviction is not proven in the current `@cloudflare/vitest-pool-workers` 0.12.21 stack. Same-object authenticated WebSocket reconnect is proven.
- Portal publication remains disabled: `PORTAL_WRITEBACK_ENABLED=false`; portal bid writer absent; portal consumers zero.

NEXT_TICKET = Cloudflare Vitest modernization + true DO eviction/WebSocket recovery proof

Next exact action: perform the authorized read-only Terra High P0/P1 checkpoint review.
