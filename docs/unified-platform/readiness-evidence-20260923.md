# 2026 readiness evidence addendum — 2026-09-23

This addendum records the sanitized result of the 2026-09-23 repository, source-file and production-state audit. It does not replace the final policy, mutate personnel, grant authority, start a Mock or Real run, or authorize Portal writeback. Exact personnel rows and private source paths remain outside Git.

## Release and production state

- Audited `origin/main` at `54bb472a1c7c49ea7581453510220858d73b1f2f`. Required lint/typecheck, unit/integration, CodeQL, dependency-audit, D1-recovery, staging-deploy and production-deploy workflows were green at that revision.
- Production's migration head is `0068_annual_bid_structure_clone_state.sql`; `PRAGMA quick_check` returned `ok`, and the foreign-key check returned no rows.
- Production retains zero Real sessions and zero Real awards. Portal writeback remains disabled and has no production queue binding.
- The 2026 definition head remains immutable version 2 with 228 positions and 223 active rules. It has 57 source decisions, 13 resolved and 44 open. Its executable `settings` and `policy` are absent, it has no live-action grants, and its template has no staffing bindings. It therefore remains authored but not executable.

## Source classification

| Evidence | Sanitized finding | Permitted use |
| --- | --- | --- |
| Final policy PDF, SHA-256 `a28e73c403fb2b8e5ece4559cf16324f9e4dfe56425d16ac6f1559080ec6befc` | Later revision than the supplied v3 DOCX and materially different in several specialty, A-Day, selection, result and vacancy provisions | Governing policy source under the existing manifest |
| Final master workbook, SHA-256 `0aa4441f03c13f93a1d48833581a9a9a370743b76f1f20198ed59cf58b33146a` | 228 enabled, uniquely identified positions: A 74, B 73, C 73 and D 8 | Final topology source; not an executable policy or personnel-tenure source |
| v3 policy DOCX, SHA-256 `39d65e651cec18328b50d88ebd086e24485d12078aa43cad0d2d45cb67f73a24` | Older draft whose wording differs materially from the final PDF | Comparison evidence only; cannot supersede the final PDF |
| Assignment HTML dated 2026-08-28 | 262 unique employee observations plus one structural blank row; no duplicate employee identifiers | Dated assignment observation only; not permanent assignment, tenure or tour-completion authority |
| Accepted staffing-reconciliation export | Matches the accepted 2026-08-28 production baseline and retains rejected unknown/incomplete rows explicitly | Import/reconciliation evidence only; not authority to invent missing mappings |
| Active-credential export dated 2026-09-07 | 6,892 unique employee-credential observations across 247 employees and 215 credential labels; no duplicate employee-credential rows | Candidate evidence for review; the export has no expiration, validity-history or specialty-equivalence facts |
| Three September 2026 roster PDFs | Daily snapshots containing overtime, leave and A-Day observations | Operational snapshot only; not permanent staffing or tenure authority |
| Three A-Day PDFs and three 2025 images | Labeled 2025 and contain visible total/formula/display defects | Legacy layout evidence only; never 2026 values or specialized-timeline authority |

The master workbook's cached Statistics output contains `#REF!` errors, its Manual still identifies 2025, and its Issues Log contains stale 2020 material. Those defects make the workbook's dashboard/reporting outputs unsuitable as executable truth even though its final position topology remains authoritative. The supplied final policy PDF also shows left-edge clipping in the current Poppler compatibility render; the publication copy should be visually confirmed or regenerated before distribution without changing its source precedence.

## New evidence that closes or narrows questions

- The four user-designated full-control operators match exact employee identifiers in the supplied master, assignment and credential sources and in production membership records. This establishes identity evidence only. Normal authenticated grants must still be saved in a complete successor definition; names and employee identifiers are intentionally not committed.
- The accepted assignment and credential imports are present in production and reconcile to their supplied reports. Re-importing them would not supply the missing expiration, tenure, relationship, deployability or permanent-staffing facts.
- The old A-Day artifacts do not provide the referenced Specialized Shift Positions Timeline. The daily rosters do not provide it either.

## Remaining finite authority/evidence bundle

The successor definition, participant preview and safe production Mock remain blocked until all affected fields are sourced together and saved through the normal immutable-version path:

1. Effective Specialized Shift Positions Timeline and the current Chief Marine supplement, or explicit authorized confirmation that the final policy is exhaustive for the latter.
2. Authoritative status or stable-identity correction for the one privately identified unmatched ordinal row.
3. Actual evaluation dates/basis, execution duration, turn timer, staffing effective date, contact-attempt policy, A-Day bounds, officer/DC capacity, Division Chief pre-Bid treatment and optional backup AirTech scope.
4. The twelve-action grants for the four designated operators in the complete successor policy.
5. Equivalent-seat allocations, rank/division contradiction decisions and approved effective/activation treatment for source-derived positions.
6. Current validity/equivalence evidence for affected qualifications and the affected tenure, tour, light-duty, relationship and SWAT training/deployability facts.
7. A current authoritative staffing baseline if the 2026-08-28 accepted baseline is no longer the intended Bid baseline.

No value in this bundle can be derived safely from rank, a daily roster, a current assignment, an active-only credential label, absence from a filtered export or a legacy 2025 schedule. Until the bundle is complete: do not create or advance a Real session, do not make Real selections, do not mutate personnel as a test, do not reset historical Mocks, and do not activate Portal writeback.

## Verification hardening in this release

- Browser impact assertions wait for the explicit calculated-result state for up to 30 seconds instead of relying on Playwright's five-second default. The isolated 521-member impact suite passed twice at desktop, tablet and phone dimensions after the change.
- Playwright E2E now runs automatically on pushes and pull requests with an ephemeral process-only signing key; it no longer depends on a protected staging secret or a manual workflow input.
- Two empty permanent-skip placeholders were removed. Their day-cycle and force-pick service behavior is covered by executable integration tests; the real authenticated force-pick browser scenario remains explicitly gated on an authorized test identity.
- Supported Node tooling is constrained to the validated 22.x line, and the existing package-manager declaration continues to pin pnpm 9.12.0 for Corepack and CI.
- Direct dependency declarations now match the already-patched Hono/Drizzle resolutions, and Vitest plus its coverage plugin are upgraded to the fixed 4.1.11 release so the source manifests and audit state agree.

