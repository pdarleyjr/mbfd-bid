# Production-gate remediation ledger

## Status

This is an in-progress remediation ledger, not a release record. No release
candidate SHA is frozen and no Bid production deployment is authorized by this
file. The exact-SHA security scans and final staging acceptance remain required
after source changes stop.

## CodeQL entitlement decision

GitHub Code Security is not licensed for this private repository. Hosted CodeQL
therefore fails during result upload and is recorded as **unavailable due to
repository entitlement**, not as a passing security result. It is formally
waived for this release only in favor of the approved frozen-SHA alternative
gate below.

At candidate freeze, record in this table the immutable SHA, scanner versions,
commands, findings, suppressions, and rationale. P0/P1 findings must be zero.

| Gate | Command / evidence required on the frozen SHA | Status |
| --- | --- | --- |
| Semgrep OWASP/static analysis | `semgrep --config p/owasp-top-ten --config p/security-audit .` and `semgrep --version` | Pending frozen SHA |
| Production dependency audit | `pnpm audit --prod --audit-level=high` | Pending frozen SHA |
| OSV repository and lockfile scan | `osv-scanner scan source . --lockfile=pnpm-lock.yaml` and `osv-scanner --version` | Pending scanner availability and frozen SHA |
| Secret scan | `gitleaks detect --source . --no-git` and `gitleaks version` | Pending frozen SHA |
| Adversarial security tests | Authentication, authorization, CSRF/origin, JWT, WebSocket tickets, admin-only routes, mock/live isolation, portal/writeback, and material mutation audit tests | In progress |

No CodeQL result may be reported as passing while the entitlement remains
unavailable.

## G-04 non-DO mutation inventory

The authoritative boundary is one of: a single D1 transaction containing the
state and audit record; an audit-before-state receipt that fails closed; or the
canonical command/event/outbox transaction. `audit_log` alone is not evidence
when written after a material mutation.

| Material surface and exact non-DO route(s) | Boundary | Current treatment |
| --- | --- | --- |
| Session lifecycle: `POST /api/admin/bid-session`, `/:id/start`, `/:id/pause`, `/:id/resume`, `/:id/day-end`, `/:id/day-start`, `PATCH /:id/config` | Admin D1 | Same-batch state and audit receipt |
| Bid commands: `POST /api/admin/bid-session/:id/force-pick`, `/:id/bid-for-member`, `/:id/lock-position`, and `/api/admin/bid-session/:id/force-a-day` | Admin D1 | Same-batch state and audit receipt |
| Bid configuration: `PUT /api/admin/bid-configuration/:year` | Admin D1 | Same-batch state and audit receipt |
| Rules and books: `PATCH`/`DELETE /api/admin/rules/:id`, `POST`/`PUT`/`POST .../publish` `/api/admin/rule-books/*` | Admin D1 | Same-batch state and audit receipt |
| Positions: `POST /api/admin/positions/clone-from-year/:src_version`, `/reconcile-station-six` | Admin D1 | Same-batch state and audit receipt, including existing-template binding recovery |
| Credentials and manual order: `POST /api/admin/credentials/import`, `PATCH /api/admin/members/bid-order` | Admin D1 | Same-batch state and audit receipt |
| Personnel, qualifications, and award transition: `POST /api/admin/personnel/changes`, `/qualification-lifecycle/events`, `/bid-award-transition/:sessionId/apply` | Admin D1 | Existing event ledger plus same-batch audit/receipt evidence |
| TeleStaff: `POST /api/admin/telestaff/imports`, `/resolve-safe-exceptions`, `/certify-deterministic-staffing`, `/apply`, `/baseline-acceptance`; `PATCH .../rows/:rowId/review` | Admin D1 | Existing D1 batch with authoritative source/lifecycle evidence and audit receipt |
| Legacy mock state: `POST /api/admin/rehearsal/:sessionId/mark-mock`, `/:sessionId/close-mock` | Legacy Admin D1 | Fail-closed audit-before-state receipt |
| Rehearsal findings: `POST /api/admin/rehearsal/findings` | Admin D1 | Same-batch finding and audit receipt |
| Canonical mock and specialty commands: rehearsal `/commands/freeze`, `/auto-bid`, `/manual-pick`; specialty-adjudication `POST` command routes | Durable Object + D1 | Atomic command receipt, event, audit, and replayable outbox |
| R2 exports: `POST /api/admin/exports/roster/:shift`, `/audit-csv` | R2 exports | Fail-closed authoritative audit receipt before the renderer/R2 write begins |
| Member PIN: `PUT /api/admin/settings/bid-pin`, `PUT /api/portal/admin/bid-pin` | KV authentication setting | Fail-closed, redacted authoritative audit receipt before the KV write begins |
| Portal delivery: queue consumer after a committed live-bid outbox message | Queue consumer D1 updates and portal publication | Fail-closed audit-before-state/audit-before-publication receipts for attempt and outcome transitions |
| Portal repair: `POST /api/admin/portal-retry/:bid_id`, `/api/admin/portal-clear-year` | Admin D1 / writeback queue | Fail-closed audit-before-state receipt; runtime publication remains production-only and explicitly opt-in |
| Deprecated member import, direct member patch, credential toggle, synthesis seed | Admin HTTP | Retired before parsing or database access |
| `POST /api/admin/bid-session/:id/skip` | Admin HTTP | Audit-only notification; it has no durable non-DO domain mutation |
| Read-only or non-material POSTs: AI explain, eligibility preview, TeleStaff preview, print-token, readiness preview, reset-mock fail-closed response | No durable domain state | Inventory reviewed; excluded because no mutation succeeds |
| Infrastructure bookkeeping: rate-limit KV counters, audit-chain persistence, audit archive outbox | Infrastructure-owned state | Not a business mutation; audit chain/outbox has its own durable replay and integrity controls |

Failure injection coverage is required for every material class above before a
candidate can freeze. Existing focused coverage includes rules, rule-book
publish/participation, credentials import, manual bid-order override, portal
retry, mock designation, mock close, rehearsal findings, and both R2 export
classes, and both member-PIN write surfaces. Remaining classes must be verified on
the eventual frozen SHA; a focused suite is not a release gate by itself.
