# MBFD Bid v2 test matrix

## Baseline result

| Area | Current result | Required action |
| --- | --- | --- |
| Shared schemas and readiness contract | `evaluateLiveReadiness` passes 7 focused synthetic tests: ready, warning, explicit block, missing fact, absent required fact, duplicate fact, and unknown runtime status. | Implement independently verified Worker fact providers before treating a report as ready. |
| Eligibility primitives | Passing; golden replay has opt-in skips | Add only policy-verified golden tests. |
| A-Day primitives | Passing | Add capacity/occupancy and role-specific edge cases. |
| Worker suite | Current branch: 100 deterministic files, 559 passed, 1 opt-in skip; five serial `unstable_dev` launcher files, 24 passed. The live-start guard, policy-book validation, revision-guarded publication, atomic clone creation, context-bound eligibility selection, mock-designation guard, and persisted-rule decoder are covered by synthetic integration/unit cases. | Obtain CI evidence; preserve separate launcher visibility rather than masking future startup failures. |
| Web unit suite | Current branch: 15 files, 64 passed, including reconnect/no-send safety coverage and retired-AI reference checks. | Extend only with behavior-backed contracts. |
| Root unit/integration suite | Current `pnpm test`: 156 files, 922 passed, 4 opt-in skips. | CI evidence remains required. |
| E2E | Stale selectors/manual workflow | Repair before operational acceptance. |

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
