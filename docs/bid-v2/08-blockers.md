# MBFD Bid v2 blocker register

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| SEC-001 | History secret-pattern review | Release/security assurance | Resolved for the scanned reachable history: 7 generic-pattern hits were classified `FALSE_POSITIVE` test material; no active secret was confirmed. GitHub-side alerts remain subject to repository settings. |
| SEC-002 | Current production dependency audit: 2 high-severity transitive advisories remain (`sharp`, `extract-zip`) | Release/security assurance | Open; do not suppress or blindly override |
| SEC-005 | CodeQL result upload is disabled at the GitHub repository level | Release/security assurance | Open: analysis ran, but GitHub rejected upload because code scanning is disabled. Requires an authorized repository-settings decision. |
| SEC-004 | Deprecated `next-on-pages` adapter does not support a patched Next 15 path; `sharp` remediation cannot safely be performed through a Next-only patch | Build/deployment/security assurance | OpenNext is selected as the Next 15 candidate after a Linux/WSL local build pass. The spike is unmerged, lacks independent Linux CI and Bid-only runtime proof, and must not be built/deployed from Windows. |
| SEC-003 | Main-branch administrator bypass was enabled at audit time | Release governance | Review required |
| CI-001 | D1 backup/recovery proof | Rollback proof | Disposable recovery proof completed from a staging export and a captured Time Travel bookmark. A sensitive temporary export still needs manual secure deletion; no long-lived Bid-only R2 backup was created. |
| CI-002 | Staging deploy applies remote D1 migrations without a proven managed-migration checkpoint | Migration safety | Blocked: migration 0020 was exercised only by raw SQL on a disposable D1, which did not advance Wrangler's migration ledger. Do not apply it to staging. |
| D1-001 | Staging D1 has 19 managed migrations; migration 0020 remains pending | Migration safety | Open: raw disposable execution validated schema effect only, not managed migration behavior. |
| QA-001 | Five Worker integration tests timed out during the first root run; launcher tests are now isolated and serial | Baseline test reliability | Resolved locally; CI evidence remains unobserved |
| CF-001 | Worker/Pages/domain/DNS ownership evidence conflicts | Cloudflare topology mutation | Open |
| CF-002 | Intended production Bid API/web hostnames did not resolve during passive audit | Production route/acceptance | Open |
| PROD-001 | Production D1/KV values in checked-in configuration are placeholders | Production deployment | Blocked |
| POLICY-001 | 2026 policy delta is external but untracked | Policy completeness | Open |
| POLICY-002 | Seed/fixture topology and code conflict with policy requirements | Live rules | Open |
| POLICY-003 | Specialty scoring/tie-break and other named policy gaps | Dependent configuration | Open |
| POLICY-004 | Persisted rule serialization bypassed the all-six Operations Technician gate and silently ignored unsupported custom criteria | Eligibility correctness | Worker HTTP evaluation/mutation and publication now reject malformed, empty, or duplicate rule books; unresolved source semantics still block publication. The DO pick path is not covered. |
| POLICY-005 | There is no authoritative expected-position coverage contract for a rule book | Policy completeness | Publication rejects empty and duplicate books, but cannot prove complete policy coverage without reconciled source topology |
| AUDIT-001 | State mutation and audit-log writing are separate operations | Audit completeness | Open: a successful guarded mutation can remain committed if its subsequent audit write fails; transactional command-plus-audit evidence and chain verification are not established. |
| LIVE-001 | Direct D1 start path is not yet a canonical Durable Object command and lacks immutable input snapshots | Live-state consistency | Guarded: non-mock starts fail closed. A separate mock-only command proof now has typed idempotency, expected-sequence, and DO-local receipt semantics, but it does not change any live path. |
| LIVE-002 | Durable Object member-pick handling currently uses an always-eligible placeholder instead of a decoded frozen rule book | Live policy enforcement | Blocked: do not wire or enable a live command path until the DO evaluates verified policy/snapshots or delegates to a guarded Worker command |
| TEL-001 | Approved sanitized 2026-08-24 TeleStaff assignment baseline is absent from this repository | Staffing/import evidence | Blocked: the existing 233-row positions fixture is topology-only and cannot validate the required 262-row distribution or Station 6 pattern. |
| TEL-002 | TeleStaff staging/reconciliation/approval/commit flow is not implemented | Staffing/import correctness | Open: additive source-only storage and reconciliation contract exist; do not reuse the legacy direct member importer. |
| DATA-001 | Temporary staging SQL export remains on the local host | Privacy/data handling | Open: exact scoped deletion was refused by this environment before execution; manually delete it from the verified temporary location using an approved secure process. |
| UX-001 | Reconnect path could create a false pending pick | Live bid correctness | Fixed and unit-tested locally; operational acceptance pending |
| OPS-001 | Media Control shares an active multi-project host | Any host/Cloudflare shared change | Protected |

See [POLICY_CONFLICT_REGISTER.md](POLICY_CONFLICT_REGISTER.md) for the detailed policy items and [MEDIA_CONTROL_PROTECTION_REGISTER.md](MEDIA_CONTROL_PROTECTION_REGISTER.md) for the hard safety boundary.
