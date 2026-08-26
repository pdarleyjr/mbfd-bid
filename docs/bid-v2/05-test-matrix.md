# MBFD Bid v2 test matrix

## Baseline result

| Area | Current result | Required action |
| --- | --- | --- |
| Shared schemas and readiness contract | 18 files / 136 passing local tests, including `evaluateLiveReadiness`, the V2 assignment-reconciliation accounting contract, and the strict mock-command envelope. | Implement independently verified Worker fact providers before treating a report as ready; obtain an approved sanitized TeleStaff baseline before parser coverage. |
| Eligibility primitives | Passing; golden replay has opt-in skips | Add only policy-verified golden tests. |
| A-Day primitives | Passing | Add capacity/occupancy and role-specific edge cases. |
| Worker suite | Current branch: 103 deterministic files, 595 passed, 1 opt-in skip; five serial `unstable_dev` launcher files, 24 passed. The suite includes 25 migration-0021 pristine-schema/adversarial tests, human-approval chronology, A/R-day terminology, opaque-reference tests, FK enforcement, and mock-command receipt/sequence/route-gate tests. | Obtain CI evidence for the updated source; preserve separate launcher visibility rather than masking future startup failures. |
| Web unit suite | Current branch: 15 files, 64 passed, including reconnect/no-send safety coverage and retired-AI reference checks. | Extend only with behavior-backed contracts. |
| OpenNext adapter spike | Isolated local spike: frozen install, workspace builds, web typecheck, 16 web files / 67 passing tests, regular Next 15.5.24 build, and Linux/WSL OpenNext Worker build passed. A fresh Windows-native no-route build again failed at `sharp` native-module bundling before preview/browser startup. | Run an independent clean Linux CI sequence before any no-route runtime deployment; do not count the spike as deployment or browser acceptance. |
| Root unit/integration suite | Current local `pnpm test`: 161 files, 965 passed, 4 opt-in skips; `pnpm build`, lint, and typecheck also completed with exit code 0. The build remains on Next 15.5.21. PR CI passed for the prior remote checkpoint; CodeQL upload was blocked by repository settings. | Push a reviewed follow-up source checkpoint to obtain CI evidence for this exact HEAD after resolving the CodeQL repository gate. |
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
