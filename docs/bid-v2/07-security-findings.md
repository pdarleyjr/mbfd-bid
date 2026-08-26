# MBFD Bid v2 security findings

## Critical finding resolved in this pass

The repository was public during audit. On 2026-08-26 it was changed to private and read-back verification confirmed `private=true`. No history rewrite was attempted.

## Remaining security gates

| Finding | Status | Required response |
| --- | --- | --- |
| Heuristic secret-pattern matches in Git history | Reviewed | A full reachable-history gitleaks scan found 7 generic-pattern test hits, all classified `FALSE_POSITIVE`. No raw values are recorded and no history rewrite was attempted. |
| Personnel/certification material | BLOCKED FROM COMMIT | Use synthetic fixtures. Confirm the privacy/source register before any import. |
| Main-branch administrator bypass | REVIEW REQUIRED | Branch protection existed at audit time, but administrators could bypass it. Review protection policy before a release. |
| Remaining dependency/code-scanning findings | OPEN | A tested, locked override for `ip-address` reduced the current production dependency audit from 31 advisories (12 high, 18 moderate, 1 low) to 2 high-severity transitive advisories: `sharp` and unpatched upstream `extract-zip`. Do not suppress either finding. |
| Obsolete Pages build adapter | BLOCKED | `@cloudflare/next-on-pages` is deprecated and cannot carry the patched Next 15.5.24 path safely. An isolated OpenNext/Workers spike passed its Linux build gate, while Windows-native bundling failed at `sharp`; it remains unmerged and runtime-unproven. Vinext's 94% source scan is not a suitable substitute because its target is a Next 16 migration. |
| CodeQL upload | BLOCKED | The PR workflow completed CodeQL analysis, but GitHub refused result upload because code scanning is disabled for this private repository. This is a repository-setting gate, not a clean CodeQL result. |
| Failing backup workflow | OPEN | 393 observed completed backup runs failed before any D1 export/R2 upload due to an unset Ubuntu `TEMP` variable. Fix/test locally, then prove an authorized staging backup and disposable restore. |
| Failing dependency-audit workflow | OPEN | The audit correctly reports current advisories but does not block merges. Patch supported versions in a separate tested change; do not suppress findings. |
| Attached access credentials | SENSITIVE | Keep only in transient process scope; never commit, log, quote, or place in documentation. Rotate if compromise is confirmed or suspected. |

## Controls observed

- GitHub secret scanning and push protection were enabled while the repository was public; current visibility changes which security-analysis fields are returned through the API.
- The Worker configuration declares secret bindings but no secret values are stored in this documentation.
- Public/watch views must receive a sanitized projection, never raw staffing, credentials, or personnel source data.
