# MBFD Bid v2 test matrix

## Baseline result

| Area | Current result | Required action |
| --- | --- | --- |
| Shared schemas and readiness contract | 18 files / 136 passing local tests, including `evaluateLiveReadiness`, the V2 assignment-reconciliation accounting contract, and the strict mock-command envelope. | Implement independently verified Worker fact providers before treating a report as ready; obtain an approved sanitized TeleStaff baseline before parser coverage. |
| Eligibility primitives | Passing; golden replay has opt-in skips | Add only policy-verified golden tests. |
| Division Chief / POL-015 policy path | The full source-local suite passed (1,125 tests; 4 intentional opt-in skips), including migration 0023 constraints, clone → draft-only participation → targeted rule deletion → coverage/diff → publication, authoritative-assignment pool exclusion, vacancy behavior, frozen-session behavior, eligibility, board preview, rehearsal, REST controls, and DO guards. Staging recovery proof, migration `0023`, and the audited normal lifecycle produced valid draft `2026.2`: 229 expected/229 valid rules, only A211/B211/C211 changed. | Do not publish or run an ordinary mock until authoritative staging staffing positions, bindings, and member assignments exist to prove actual occupant exclusions. |
| A-Day primitives | Passing | Add capacity/occupancy and role-specific edge cases. |
| Worker suite | Current source-local Worker evidence: 120 deterministic files / 711 passed / 1 opt-in skip, plus five serial launcher files / 26 passed. | Preserve separate launcher visibility rather than masking future startup failures. GitHub Actions were unavailable for this checkpoint, so no hosted result is claimed. |
| Web unit suite | Current source-local Web evidence: 23 files / 106 passed, including same-origin guards for PIN/session finalization and the read-only rule-book coverage panel. | Extend only with behavior-backed contracts. |
| OpenNext staging build | Clean Linux Node 22.22.1 / pnpm 9.12.0 OpenNext build passed and its exact Web source was deployed to the existing staging custom-domain Worker as version `869f9cb8-ea5e-42d4-a00a-90d1857763f3`. | Keep a clean Linux build as the deployment gate. Windows-native `sharp` bundling is not runtime proof. |
| Root unit/integration suite | Frozen install, lint, package builds, typecheck, build, D1 preflight, `git diff --check`, and `pnpm test` passed (1,125 tests; 4 intentional opt-in skips). Exact-head production audit retains one unpatched high `extract-zip` advisory; no GitHub Actions result is available for this checkpoint. | Do not treat the dependency audit as waived; retain the production gate until a supported remediation or formal risk decision exists. |
| Live browser acceptance | Prior authenticated staging admin acceptance remains separately valid. After the new Web deployment, the public staging PIN gate rendered with zero observed console errors. Direct staging-local admin authentication and configured canonical member PIN state were verified without recording credentials. | Candidate `2026.2` remains draft, staging has no authoritative assignments, and no fresh mock/WebSocket/audit/export claim is made. |

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
