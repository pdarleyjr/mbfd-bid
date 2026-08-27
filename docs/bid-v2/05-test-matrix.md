# MBFD Bid v2 test matrix

## Baseline result

| Area | Current result | Required action |
| --- | --- | --- |
| Shared schemas and readiness contract | 18 files / 136 passing local tests, including `evaluateLiveReadiness`, the V2 assignment-reconciliation accounting contract, and the strict mock-command envelope. | Implement independently verified Worker fact providers before treating a report as ready; obtain an approved sanitized TeleStaff baseline before parser coverage. |
| Eligibility primitives | Passing; golden replay has opt-in skips | Add only policy-verified golden tests. |
| A-Day primitives | Passing | Add capacity/occupancy and role-specific edge cases. |
| Worker suite | Exact feature SHA `2275920`: 114 deterministic files, 679 passed, 1 opt-in skip; five serial `unstable_dev` launcher files, 26 passed. | Preserve separate launcher visibility rather than masking future startup failures; hosted exact-SHA CI remains independent evidence. |
| Web unit suite | Exact feature SHA `2275920`: 18 files, 71 passed, including reconnect/no-send safety, retired-AI reference checks, and the secure logout route cookie-clear contract. | Extend only with behavior-backed contracts. |
| OpenNext staging build | Clean Linux proof for exact `2275920`: frozen install, lint, typecheck, Next 15.5.24 / OpenNext 1.20.4 build, loopback Worker health, 1,514 emitted artifact files, zero native `.node` files, and no textual `extract-zip` or `@puppeteer/browsers` reference. The exact artifact passed a disposable Workers canary then deployed to the staging custom domain. | Keep a clean Linux build as the deployment gate. Windows-native `sharp` bundling is not runtime proof. |
| Root unit/integration suite | Exact `pnpm test`: 175 files, 1,058 passed, 4 opt-in skips; frozen install, lint, typecheck, build, D1 preflight, and `git diff --check` passed. The build uses Next 15.5.24. Exact-head production audit reports one unpatched high `extract-zip` advisory; hosted CI and CodeQL settings remain separate evidence. | Do not treat the dependency audit as waived; retain the production gate until a supported remediation or formal risk decision exists. |
| Live browser acceptance | Anonymous Playwright acceptance on `https://staging.bid.mbfdhub.com` passed: staging banner, PIN gate, anonymous admin redirect, static asset, logout `204`, and both auth-cookie clears; browser console had zero errors. | Authenticated admin/member, WebSocket, mock rehearsal, exports, and portal suppression require dedicated staging test credentials and remain unobserved. |

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
