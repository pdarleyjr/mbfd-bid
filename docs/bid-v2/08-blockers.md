# MBFD Bid v2 blocker register

| ID | Blocker | Impact | State |
| --- | --- | --- | --- |
| SEC-001 | History secret-pattern review | Release/security assurance | Resolved for the scanned reachable history: 7 generic-pattern hits were classified `FALSE_POSITIVE` test material; no active secret was confirmed. GitHub-side alerts remain subject to repository settings. |
| SEC-002 | Current production dependency audit: one high-severity transitive advisory remains (`extract-zip`) | Release/security assurance | Open for production promotion: exact-head `pnpm audit --prod --audit-level=high` reports `@cloudflare/puppeteer@1.1.0 → @puppeteer/browsers@2.2.4 → extract-zip@2.0.1`, with no patched version published. The exact staging Worker and OpenNext artifacts contain no textual `extract-zip` or `@puppeteer/browsers` reference; that reachability evidence does not replace the dependency audit. |
| SEC-005 | CodeQL result upload is disabled at the GitHub repository level | Release/security assurance | Open: analysis ran, but GitHub rejected upload because code scanning is disabled. Requires an authorized repository-settings decision. |
| SEC-004 | Deprecated `next-on-pages` adapter did not support a patched Next 15 path | Build/deployment/security assurance | Resolved for staging: the exact source was built with Next 15.5.24 and OpenNext 1.20.4 in a clean Linux environment, canary-validated, then deployed to the staging custom-domain Worker. Windows-native `sharp` bundling remains a development-environment limitation; production remains a separate gate. |
| SEC-003 | Main-branch administrator bypass was enabled at audit time | Release governance | Review required |
| CI-001 | D1 backup/recovery proof | Rollback proof | Resolved for staging: a private Time Travel bookmark and full export were captured, a disposable Bid-only database completed managed migrations 0001–0022, export/import count and FK comparisons, and proof-only Time Travel restoration. The disposable proof databases and all 16 local proof files were deleted after deployment. No claim of physical-bit erasure or long-lived R2 backup is made. |
| CI-002 | Staging deploy applies remote D1 migrations without a proven staging-derived managed-migration checkpoint | Migration safety | Resolved for this staging deployment: a fresh private Time Travel bookmark preceded managed application of additive migration `0023_bid_position_participation.sql`. The live database was not reset, restored, seeded, or given a synthetic migration. |
| D1-001 | Staging D1 migration ledger | Migration safety | Resolved for staging: the remote ledger contains migration `0023_bid_position_participation.sql`, `migrations list` reports no pending work, and `PRAGMA foreign_key_check` is empty. |
| D1-002 | Forward migration `0026_authoritative_staffing_baseline.sql` adds unique source-accounting and annual-baseline indexes | Remote migration safety | Open: before any future staging apply, capture a fresh recoverable D1 checkpoint and perform a read-only preflight against the exact target schema/ledger. Confirm that the prerequisite migrations are present and that no duplicate `(import_id, row_fingerprint)`, non-null `(import_id, member_reference_hmac)`, or cross-year `assignment_import_id` baseline records would make the additive indexes fail. Do not edit historical rows to force a result. This continuation did not contact, migrate, or otherwise change remote D1. |
| QA-001 | Five Worker integration tests timed out during the first root run; launcher tests are now isolated and serial | Baseline test reliability | Resolved locally. GitHub Actions were unavailable for the 2026-08-27 final staging-auth checkpoint, so no hosted result is claimed for it. |
| CF-001 | Worker/Pages/domain/DNS ownership evidence conflicts | Cloudflare topology mutation | Resolved for staging: `api.staging.bid.mbfdhub.com` serves `mbfd-bid-worker-staging`; `staging.bid.mbfdhub.com` serves `mbfd-bid-web-staging-opennext` as a Worker custom domain. The existing `mbfd-bid-web-staging` Pages project was retained as rollback material and its domain/DNS attachment was not detached or recreated. |
| CF-002 | Intended production Bid API/web hostnames did not resolve during passive audit | Production route/acceptance | Open |
| PROD-001 | Production D1/KV values in checked-in configuration are placeholders | Production deployment | Blocked |
| POLICY-001 | 2026 policy delta is external but untracked | Policy completeness | Open |
| POLICY-002 | Seed/fixture topology and code conflict with policy requirements | Live rules | Open |
| POLICY-003 | Specialty scoring/tie-break and other named policy gaps | Dependent configuration | Open |
| POLICY-004 | Persisted rule serialization bypassed the all-six Operations Technician gate and silently ignored unsupported custom criteria | Eligibility correctness | Worker HTTP evaluation/mutation and publication reject malformed, empty, duplicate, or unsupported-custom books. The new frozen policy guard blocks excluded members and non-biddable positions in DO selection, but the legacy DO's individual eligibility evaluator remains a separate live-command blocker. |
| POLICY-005 | Rule-book coverage contract must be applied to an approved annual template | Policy completeness | Source-local coverage now proves the exact `BIDDABLE` set for a rule book and rejects missing, duplicate, non-biddable, and unexpected rules. The independent source-topology conflict remains open; do not infer its resolution from this mechanism. |
| POLICY-006 | Historical active staging rule book `2026.1` contains the three legacy `pre_bid_pool` fixture rows | Rehearsal policy execution | **Policy decision resolved:** A211/B211/C211 are administratively assigned non-biddable Division Chief staffing positions, not a custom Bid semantic. After recovery proof and managed migration `0023`, the normal lifecycle created valid 229-rule draft `2026.2` with only those positions removed from the biddable set. Active `2026.1` remains unchanged. Publishing and fresh mock acceptance are blocked only by the absent reviewed authoritative staffing positions, bindings, and assignments needed to prove actual-occupant exclusion; no data was invented to force that proof. |
| AUDIT-001 | State mutation and audit-log writing are separate operations | Audit completeness | Open: a successful guarded mutation can remain committed if its subsequent audit write fails; transactional command-plus-audit evidence and chain verification are not established. |
| LIVE-001 | Direct D1 start path is not yet a canonical Durable Object command | Live-state consistency | Source-local sessions now atomically capture an immutable normalized policy snapshot and materialize the exact frozen order. Non-mock starts remain fail closed; command/audit atomicity and a complete live-command path are still not established. |
| LIVE-002 | Durable Object individual eligibility evaluator is still a placeholder | Live policy enforcement | Source-local DO guards now resolve every selection against the frozen snapshot and decoded rule book, blocking excluded members and non-biddable positions. That does not make the placeholder individual eligibility evaluation a safe live path; do not enable it for non-mock use. |
| TEL-001 | Approved sanitized 2026-08-24 TeleStaff assignment baseline is absent from this repository | Staffing/import evidence | Blocked: the existing 233-row positions fixture is topology-only and cannot validate the required 262-row distribution or Station 6 pattern. |
| TEL-002 | TeleStaff staging/reconciliation/approval/commit flow is not operational | Staffing/import correctness | Open: source-local code now has a versioned semantic HTML adapter, sanitized staged-source persistence boundary, immutable format/count provenance, duplicate protections, explicit incomplete-topology evidence, annual accepted-manifest ledger, aggregate admin validation, and fail-closed publication preflight. Only an externally governed `official` source designation can become an accepted baseline; the value is a control classification, not repository proof of authority. A `synthetic_test` source cannot map to MBFD staffing or materialize an observation; `legacy_unclassified` fails closed. There is still no authenticated upload/apply endpoint, real TeleStaff access, real authoritative baseline designation, mapping/review workflow, or authorized commit lifecycle. A source-effective-date and source-version/hash compatibility policy is still required before mapping selection can be automated. Do not reuse the legacy direct member importer. |
| DATA-001 | Temporary staging SQL export on the local host | Privacy/data handling | Resolved: the exact dedicated proof directory was verified, its 16 named files were removed, then the empty directory was removed. Do not interpret this as a claim of physical-bit erasure. |
| UX-001 | Reconnect path could create a false pending pick | Live bid correctness | Fixed and unit-tested locally; operational acceptance pending |
| UX-002 | Authenticated staging browser, WebSocket, rehearsal, export, and portal-writeback acceptance | Operational acceptance | Partially resolved: prior authenticated staging-local admin acceptance remains valid. The updated OpenNext Web Worker rendered the staging PIN gate with zero observed console errors; direct staging-local admin authentication verified the API and canonical member PIN configuration. The POL-015 API/migration and read-only Web review surface are deployed, but candidate `2026.2` is deliberately not active. A completely isolated staging synthetic rule-book/session remains unsafe, and zero authoritative assignment data prevents a fresh ordinary mock, WebSocket, audit, or export proof. |
| OPS-001 | Media Control shares an active multi-project host | Any host/Cloudflare shared change | Protected |

See [POLICY_CONFLICT_REGISTER.md](POLICY_CONFLICT_REGISTER.md) for the detailed policy items and [MEDIA_CONTROL_PROTECTION_REGISTER.md](MEDIA_CONTROL_PROTECTION_REGISTER.md) for the hard safety boundary.

## D1-002 future migration preflight

This is an operator-gated, read-only procedure for a future authorized staging
migration. It is not a command to run during this source-local checkpoint.
First confirm the target's migration ledger and prerequisite tables, then
capture the required recoverable checkpoint. Before applying `0026`, run the
following aggregate-only checks against the exact target database. They return
only import identifiers and counts—not fingerprints or HMAC values—and must
return zero rows before its two indexes over existing `assignment_import_rows`
data are attempted. `bid_year_staffing_baselines` is created by `0026` and
therefore starts empty; its one-year-per-import index has no historic rows to
preflight.

```sql
SELECT import_id, COUNT(*) AS duplicate_groups, SUM(n) AS duplicate_rows
FROM (
  SELECT import_id, row_fingerprint, COUNT(*) AS n
  FROM assignment_import_rows
  GROUP BY import_id, row_fingerprint
  HAVING COUNT(*) > 1
)
GROUP BY import_id;

SELECT import_id, COUNT(*) AS duplicate_groups, SUM(n) AS duplicate_rows
FROM (
  SELECT import_id, member_reference_hmac, COUNT(*) AS n
  FROM assignment_import_rows
  WHERE member_reference_hmac IS NOT NULL
  GROUP BY import_id, member_reference_hmac
  HAVING COUNT(*) > 1
)
GROUP BY import_id;

```

Any returned row is a stop condition for policy-owner and migration-owner
review. Do not delete, merge, reclassify, or otherwise alter historic data to
make the preflight pass.
