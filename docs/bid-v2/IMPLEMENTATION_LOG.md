# MBFD Bid v2 implementation log

## 2026-08-26 — Phase 0 baseline

- Captured local repository, GitHub, Cloudflare, GMKtec, and Media Control read-only baseline.
- Created local branch `feat/mbfd-bid-v2` from `beed7412f608306ff411b7a9a603bc3b8d75cdb3`.
- Recorded a clean locked install, lint, typecheck, build, and root test pass. The first Worker test run timed out in five launcher tests; the five launcher tests now run serially in a dedicated configuration while interactive watch retains coverage, and the current root test run passed 152 files, 878 tests, with 4 intentional opt-in skips. CI evidence remains unobserved.
- Changed the GitHub repository from public to private and verified the result.
- Created source, policy conflict, security, rollout, Cloudflare, test, and Media Control protection contracts.
- Identified the D1-backup CI root cause as an unset Ubuntu `TEMP` environment variable before any Cloudflare call; implemented a local-only cleanup-safe preflight and no-network regression test covering both successful and failed cleanup, and added that test to CI. A real staging backup and disposable restore remain unproven.
- Applied supported dependency updates on the isolated branch, reducing the current production audit from 31 advisories to 5. The remaining transitive advisories are explicitly retained as blockers.
- Fixed the bid reconnect path so a disconnected socket cannot create a false pending pick; added focused unit coverage for disconnected, rejected, and accepted send outcomes.
- Made no server, Docker, Media Control, Cloudflare, DNS, tunnel, D1, KV, R2, Queue, Worker, Pages, or deployment change.

## 2026-08-26 — readiness and dependency follow-up

- Added a pure shared readiness contract for the directive's 16 named checks. Missing, duplicated, and unknown runtime status facts fail closed; warnings remain visible without becoming an implicit block.
- Added a read-only per-session readiness report and changed the non-mock start route to return `409 readiness_blocked` before any D1 transition or audit write while the fact providers remain unconfigured. Mock rehearsals remain available only after a fresh-step-up, pre-start, no-picks designation; the route attempts a separate audit write afterward, so transactional audit coupling remains unproven. This is an interim safety control, not a complete canonical live-command path.
- Removed stale active-web references that advertised a retired AI advisory and stopped invalidating the retired query key on bid events. No AI service or infrastructure was introduced.
- Applied a locked `ip-address` override and verified a frozen install. The production audit now reports two high-severity transitive findings (`sharp` and `extract-zip`); a Next-only update is blocked by the deprecated Pages adapter's unsupported peer range.
- Added a typed persisted-rule decoder at Worker HTTP evaluation/mutation and rule-publication boundaries. It maps the authoritative `ops_all_6` serialization to an explicit all-operations Technician gate, normalizes outer whitespace only, and rejects malformed, conflicting, unmodeled, empty, or duplicate rule books. Draft mutations advance a revision precondition, so publication fails closed if a rule changes after full-book validation; the status swap avoids dependence on SQLite partial-index update order. Rule-book creation plus cloning now shares one D1 batch, so a predicted draft version cannot be published from a partial clone. Member eligibility binds to the active policy for its session year; an admin preview with no version now fails closed if multiple active annual books exist. It intentionally blocks the current `pre_bid_pool` source rows from publication until their semantics are authorized. The current Durable Object pick handler remains outside this guard and is explicitly blocked from live enablement.
- Worker verification passed locally: 100 deterministic files / 559 passed / 1 opt-in skip, plus 5 serial launcher files / 24 passed. Shared readiness tests passed 16 files / 129 tests; web unit tests passed 15 files / 64 tests; eligibility tests passed 84 with 3 intentional opt-in skips. The current root suite passed 156 files / 922 tests / 4 opt-in skips. Browser, CI, D1 backup/restore, Cloudflare, and operational acceptance remain unobserved.

## Next checkpoint

Obtain CI evidence for the local checkpoint. Before any D1-affecting deployment, obtain authorization for a staging backup and disposable restore; do not proceed while the production DNS/resource-ownership and policy blockers remain unresolved.
