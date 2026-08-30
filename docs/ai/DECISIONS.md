# Durable decisions

- V3 session snapshots are materialized and immutable.
- A211/B211/C211 Division Chiefs are `ADMIN_ASSIGNED_NON_BIDDABLE`.
- Division Chief occupant exclusion is effective-assignment based, not rank-wide.
- Mock roster mutation is prohibited.
- Mock portal publication is prohibited.
- Migration 0036 is an additive receipt-recovery sidecar.
- Migration 0037 decomposes the fail-closed staffing-baseline trigger.
- An ambiguous pending receipt resolves to `recovery_required`.
- AI is advisory only; the deterministic engine remains authoritative.
- Workers Vitest runtime testing uses `@cloudflare/vitest-plugin` with Vitest 4.1; genuine Durable Object eviction is a release gate.
- BidSessionDO remains on the standard WebSocket API in this checkpoint; hibernation behavior is not claimed.
- Standard-WebSocket async message handlers must explicitly observe rejection, remove the affected client, and close that socket with 1011.
