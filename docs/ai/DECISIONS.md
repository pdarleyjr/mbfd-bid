# Durable decisions

- Ordinary staging deployment must not run `wrangler d1 migrations apply`. The controlled per-migration Release Captain procedure is the only authorized migration path.
- On 2026-08-31, a stale mock-session precondition blocked controlled migration because the app only exposed a fail-closed reset. The scoped `close-mock` lifecycle closes legacy mocks with fresh admin authentication, preserves rehearsal history, audits the disposition, and refuses canonical-command state. It was deployed only to staging.
- The normal deploy workflow fails closed when the remote D1 managed ledger does not exactly match the canonical migration directory. It performs a read-only ledger query only.
- Cloudflare secret handling must use versioned secret preparation (`wrangler versions secret bulk` or equivalent) followed by deliberate version deployment. Ordinary `wrangler secret put` is excluded because it immediately deploys a new Worker version.
- API and Web JWT/print secrets must be generated once per staging rotation and installed as paired values; secret names, never values, are the only configuration evidence retained in repository documentation.
- A nonterminal mock `position_bid` session is an operational maintenance-window blocker. Do not infer idle status from age alone or invalidate staging sessions until an operator clears the window.
- Exact source deployment may use a disposable detached Linux checkout when an old Linux worktree is stale; that condition is not a human blocker. The 2026-08-31 Web deployment used this method. A subsequent API redeploy was limited to correcting a concrete authentication failure and used the same exact candidate.
- Staging access PIN and local-admin values are rotated only as ephemeral acceptance material. Store bcrypt secret input without a trailing line terminator; a byte-preserving Wrangler bulk-secret payload was required for valid bcrypt verification.
- Do not bypass the absence of a designated annual configuration or authoritative staffing baseline with direct D1 writes merely to manufacture a fresh mock acceptance flow.
- A current-looking Excel XML TeleStaff export is not a supported raw TeleStaff Assignments HTML source. Do not convert, reinterpret, or use it as a baseline; obtain the original current official HTML export and retain only its approved provenance/hash records through the operator workflow.
- A staging-only annual configuration may be created only after the official baseline is accepted and the configuration policy is fully determined. The checked-in 2026 documents leave Fire Investigator inclusion and Station 6 Marine FF/Post St.6 dashboard classification for explicit operator confirmation; no default may be silently chosen.

## Preserved reliability decisions

- V3 session snapshots are materialized and immutable. A211/B211/C211 Division Chiefs are `ADMIN_ASSIGNED_NON_BIDDABLE`; Division Chief occupant exclusion is effective-assignment based, not rank-wide.
- Mock roster mutation and mock portal publication are prohibited. Migration `0036` is an additive receipt-recovery sidecar; migration `0037` decomposes the fail-closed staffing-baseline trigger; an ambiguous pending receipt resolves to `recovery_required`.
- AI is advisory only; the deterministic engine remains authoritative. Workers Vitest runtime testing uses `@cloudflare/vitest-plugin` with Vitest 4.1; genuine Durable Object eviction is a release gate.
- BidSessionDO remains on the standard WebSocket API in this checkpoint; hibernation behavior is not claimed. Standard-WebSocket asynchronous message handlers must explicitly observe rejection, remove the affected client, and close that socket with 1011.
