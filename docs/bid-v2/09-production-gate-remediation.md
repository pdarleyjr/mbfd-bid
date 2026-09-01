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

| Material surface | Boundary | Current treatment |
| --- | --- | --- |
| Session creation/start/pause/resume/day transitions | Admin D1 | Same-batch state and audit receipt |
| Bid configuration, forced pick, bid-for-member, lock, force A-Day | Admin D1 | Same-batch state and audit receipt |
| Rule edit/delete, rule-book participation/publish, template clone | Admin D1 | Same-batch state and audit receipt |
| Station Six reconciliation, including existing-template binding recovery | Admin D1 | Same-batch state and audit receipt |
| Credential import and manual bid-order overrides | Admin D1 | Same-batch state and audit receipt |
| Mock designation and close | Legacy Admin D1 | Fail-closed audit-before-state receipt |
| Portal retry and clear-year | Admin D1 / writeback queue | Fail-closed audit-before-state receipt; runtime publication remains production-only and explicitly opt-in |
| TeleStaff import/review/exception/certify/apply/baseline acceptance | Admin D1 | Existing D1 batch with authoritative source/lifecycle evidence and audit receipt |
| Personnel and qualification lifecycle; bid-award transition | Admin D1 | Existing event ledger plus same-batch audit/receipt evidence |
| Canonical mock and specialty commands | Durable Object + D1 | Atomic command receipt, event, audit, and replayable outbox |
| Deprecated member import, direct member patch, credential toggle, synthesis seed | Admin HTTP | Retired before parsing or database access |
| Legacy `skip` endpoint | Admin HTTP | Audit-only notification; it has no durable non-DO domain mutation |

Failure injection coverage is required for every material class above before a
candidate can freeze. Existing focused coverage includes rules, rule-book
publish/participation, credentials import, manual bid-order override, portal
retry, mock designation, and mock close. Remaining classes must be verified on
the eventual frozen SHA; a focused suite is not a release gate by itself.
