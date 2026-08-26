# MBFD Bid v2 test matrix

## Baseline result

| Area | Current result | Required action |
| --- | --- | --- |
| Shared schemas | Passing in baseline recursive suite | Retain and extend with synthetic import cases. |
| Eligibility primitives | Passing; golden replay has opt-in skips | Add only policy-verified golden tests. |
| A-Day primitives | Passing | Add capacity/occupancy and role-specific edge cases. |
| Worker suite | Current branch: 103 files, 551 passed, 1 opt-in skip. The five `unstable_dev` launcher files run serially in a dedicated Vitest configuration; interactive watch retains all launcher coverage. | Obtain CI evidence; preserve separate launcher visibility rather than masking future startup failures. |
| Web unit suite | Current branch: 14 files, 62 passed, including reconnect/no-send safety coverage. | Extend only with behavior-backed contracts. |
| Root unit/integration suite | Current branch: 152 files, 878 passed, 4 opt-in skips. | CI evidence remains required. |
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
