# MBFD Bid v2 blocker register

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| SEC-001 | History secret-pattern review incomplete | Release/security assurance | Open |
| SEC-002 | Current production dependency audit: 2 high-severity transitive advisories remain (`sharp`, `extract-zip`), plus code-scanning findings | Release/security assurance | Open; do not suppress or blindly override |
| SEC-004 | Deprecated `next-on-pages` adapter does not support the locked Next version; `sharp` remediation cannot safely be performed through a Next-only patch | Build/deployment/security assurance | Blocked pending a separately staged OpenNext/Workers migration |
| SEC-003 | Main-branch administrator bypass was enabled at audit time | Release governance | Review required |
| CI-001 | 393 observed D1-backup workflow runs failed before export/upload due to unset runner `TEMP` | Rollback proof | Source-only fix and no-network regression test complete locally; live staging backup/restore proof still blocked |
| CI-002 | Staging deploy applies remote D1 migrations without a proven pre-migration backup checkpoint | Migration safety | Blocked pending CI-001 live proof |
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
| LIVE-001 | Direct D1 start path is not yet a canonical Durable Object command and lacks immutable input snapshots | Live-state consistency | Guarded: non-mock starts fail closed; underlying command-path migration remains open |
| LIVE-002 | Durable Object member-pick handling currently uses an always-eligible placeholder instead of a decoded frozen rule book | Live policy enforcement | Blocked: do not wire or enable a live command path until the DO evaluates verified policy/snapshots or delegates to a guarded Worker command |
| UX-001 | Reconnect path could create a false pending pick | Live bid correctness | Fixed and unit-tested locally; operational acceptance pending |
| OPS-001 | Media Control shares an active multi-project host | Any host/Cloudflare shared change | Protected |

See [POLICY_CONFLICT_REGISTER.md](POLICY_CONFLICT_REGISTER.md) for the detailed policy items and [MEDIA_CONTROL_PROTECTION_REGISTER.md](MEDIA_CONTROL_PROTECTION_REGISTER.md) for the hard safety boundary.
