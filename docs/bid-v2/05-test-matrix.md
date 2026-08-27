# MBFD Bid v2 test matrix

## Baseline result

| Area | Current result | Required action |
| --- | --- | --- |
| Shared schemas and readiness contract | 18 files / 136 passing local tests, including `evaluateLiveReadiness`, the V2 assignment-reconciliation accounting contract, and the strict mock-command envelope. | Implement independently verified Worker fact providers before treating a report as ready; obtain an approved sanitized TeleStaff baseline before parser coverage. |
| Eligibility primitives | Passing; golden replay has opt-in skips | Add only policy-verified golden tests. |
| A-Day primitives | Passing | Add capacity/occupancy and role-specific edge cases. |
| Worker suite | Exact source `5ead0c7`: 688 Worker tests passed with 1 opt-in skip; five serial `unstable_dev` launcher files passed 26 tests. | Preserve separate launcher visibility rather than masking future startup failures. GitHub Actions were unavailable for this checkpoint, so no hosted result is claimed. |
| Web unit suite | Exact source `5ead0c7`: 106 tests passed, including same-origin guards for PIN/session finalization and the post-save canonical-PIN UI update. | Extend only with behavior-backed contracts. |
| OpenNext staging build | Clean Linux proof for exact `5ead0c7`: Node 22.22.1, pnpm 9.12.0, frozen install, lint, package builds, typecheck, OpenNext staging build, and local preview smoke all passed. The exact artifact was deployed to the staging custom-domain Worker. | Keep a clean Linux build as the deployment gate. Windows-native `sharp` bundling is not runtime proof. |
| Root unit/integration suite | Exact `5ead0c7`: frozen install, lint, typecheck, build, D1 preflight, `git diff --check`, and `pnpm test` passed (1,102 tests; 4 intentional opt-in skips). Exact-head production audit retains one unpatched high `extract-zip` advisory; no GitHub Actions result is available for this checkpoint. | Do not treat the dependency audit as waived; retain the production gate until a supported remediation or formal risk decision exists. |
| Live browser acceptance | Authenticated staging browser acceptance passed: canonical configured PIN 2300, staging-local admin login, same-origin session finalization, secure HTTP-only cookies, reload persistence, 13 implemented admin routes, a mock-board WebSocket state snapshot, audit-chain verification, audit-export retrieval, and portal-disabled `409` negative proof; the observed browser console and 5xx counts were zero. | Mock auto-bid made no pick because active rule book `2026.1` has three semantically invalid decoded positions. No authorized member identity was supplied, so member acceptance remains pending. |

## Required coverage matrix

| Test layer | Examples |
| --- | --- |
| Unit | Eligibility primitives, rank/seniority, credentials, A-Day constraints, temporal assignment resolver, event sanitization. |
| Integration | D1 migrations, source import/reconciliation, policy publication, snapshots, command authorization/idempotency, exports. |
| Realtime | Reconnect/no-send behavior, Durable Object recovery, concurrent clients, blank/pause/resume projections. |
| E2E | Admin readiness/start, mock isolation, member pick/reconnect, specialty interruption, public privacy, portal publication. |
| Infrastructure | Dedicated Bid isolation, backup/rollback, no Media Control resource modification, pre/post health. |

## Test data rule

Tests use synthetic identifiers and sanitized fixtures only. No raw TeleStaff/personnel data may be committed or emitted in test diagnostics.
