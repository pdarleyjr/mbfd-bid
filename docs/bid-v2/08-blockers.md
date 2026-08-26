# MBFD Bid v2 blocker register

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| SEC-001 | History secret-pattern review incomplete | Release/security assurance | Open |
| SEC-002 | Current production dependency audit: 5 transitive advisories remain (3 high, 2 moderate), plus code-scanning findings | Release/security assurance | Open; investigate upstream-compatible remediation |
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
| UX-001 | Reconnect path could create a false pending pick | Live bid correctness | Fixed and unit-tested locally; operational acceptance pending |
| OPS-001 | Media Control shares an active multi-project host | Any host/Cloudflare shared change | Protected |

See [POLICY_CONFLICT_REGISTER.md](POLICY_CONFLICT_REGISTER.md) for the detailed policy items and [MEDIA_CONTROL_PROTECTION_REGISTER.md](MEDIA_CONTROL_PROTECTION_REGISTER.md) for the hard safety boundary.
