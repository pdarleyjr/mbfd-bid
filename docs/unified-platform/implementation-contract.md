# Unified Department and adaptive Bid implementation contract

## Recorded starting state — 2026-09-12

- Repository: `pdarleyjr/mbfd-bid`; fetched `origin/main`.
- Starting SHA: `ec4087a2166cffdfa8f4c96cb66d0db5ddc8ca0c`.
- Starting tree: `ef056f6f38e8a27324d37a562402a2a914a6ba45`.
- No commits since the supplied baseline. Recent merged PRs 110–116 retain credential import resilience, compact navigation and roster identity colors.
- Branch: `codex/unified-department-adaptive-bid-20260912`, isolated from the older shared checkout and its unrelated files.
- GitHub reports main unprotected. All implementation uses reviewed PRs and exact candidate validation.
- Local runtime: Node 22.22.3, pnpm 9.12.0, Codex CLI 0.154.0-alpha.6.2, desktop 26.908.4834.0. Fresh local model catalog lists GPT-6 Astra and Max support. These facts establish compatibility; no claim that every installation is the latest release.
- Production health responds 200 (`env=production`); that endpoint does not identify source SHA. Runtime identity remains a separate release gate.
- Four visual reference images were not included in the supplied attachment directory. The written product contract and existing MBFD visual system guide implementation until references are available.

## Final 2026 source authority — verified 2026-09-19

The final extracted package has been independently hash-verified. Its governing
authority supersedes the earlier historical-only implementation context:

1. `2026 Bid Policy.pdf`, July 2026: governing policy semantics.
2. `MASTER 2026 Bid Positions Selection V2.xlsx`: organization and position plan.
3. `2026 Annual Bid Calculations v3.xlsx`: subordinate calculation and ranking oracle.
4. `(EX) Export Assignments - 2026-08-24.xls`: dated Department assignment snapshot.

Existing software and earlier operational descriptions cannot override the PDF.
See the sanitized final-source manifest; original files and personnel analysis
remain private, read-only, and excluded from Git. Spreadsheet formula defects
are intentional parity divergences where the PDF provides contrary requirements.

The user authorizes guarded software release, rehearsed migrations, exact-source
deployment and a new canonical final Current Bid version after release gates pass.
Real session creation/start, real selections, real force actions, personnel test
mutations and historical Mock deletion are excluded from acceptance. Portal
writeback remains disabled. This contract records authorization, not completion.

The desired software semantics are **edit → Save → new version** with automatic
actor/time recording and optional change note/impact preview. Earlier versions
remain immutable and Restore creates a new version. These are implementation
requirements, not permission to bypass source review, policy publication, or
runtime authorization. Existing runs retain their pinned version and evidence.

Source reconciliation may expose directly supported configuration and explicit
unresolved questions, but must never invent a qualification, identity, service
record, expected result, or approval. Missing, contradictory, or unverified
source facts remain fail-closed.

## Ownership and invariants

The principal agent owns all architectural choices. Bounded inventories, regression tests, migration review, accessibility and UI QA may be delegated. Department, Bid policy and execution must not become independently designed systems.

Preserve Hub federation and role gates, canonical commands, Durable Object coordination, D1 atomic batches, idempotency receipts, append-only personnel and qualification evidence, source provenance, audit, Mock/Live isolation, run snapshots and disabled portal writeback. Do not test by starting/advancing Real Bids, changing real people, deleting Mocks, or altering completed evidence. The authorized final policy configuration must be a new canonical version, never a rewrite of history.

## Authoritative seams

1. **Department**: extract the effective-dated staffing query from `routes/admin/current-roster.ts` into one policy-free projection. Department/Today consume it. The legacy current-roster API remains a compatibility adapter which adds explicitly selected annual participation metadata for Bid consumers. No separate rosters or occupancy logic in the browser.
2. **Personnel and organization**: reuse `personnel-lifecycle.ts`, personnel preview/commit routes, qualification lifecycle, and versioned organization identities/parents/links. Existing SQL fallback can leak mutable rank/status before the first lifecycle event; characterize and align with the existing `derivePersonnelMemberAsOf` before claiming historical parity. Organization links must supply effective-dated topology, not independently edited station labels.
3. **Bid**: wrap existing annual configuration, source evidence and typed rule profiles in a product facade. Semantic saves require optimistic concurrency, deterministic hashes, immutable versions and restore-as-new. Runs continue to pin the required configuration and Department context. Never silently retarget an active run.
4. **Evaluation**: reuse `compileAnnualRules`, `evaluateEligibility`, comparison and A-Day services. The current `bidYear === 2026` stage-order branch must become characterized configuration, not disappear without equivalent validation. New primitives must be reusable and strongly validated.
5. **Blueprint**: locally authored draft relationships and separately returned server evaluation facts retain distinct provenance. Rendering contains relationships and presentation only; it does not imply that draft data was server-reviewed. The current package and lockfile have no compatible graph renderer, so the implementation uses a small custom SVG relationship layer with native focusable node controls, a selected-node inspector and an equivalent structured list rather than adding a runtime dependency. Keep projections lens-bounded, measure keyboard access and large projections, and never move policy calculation into the renderer.

## Reviewable delivery sequence

| Slice | Scope | Acceptance |
| --- | --- | --- |
| 1 | Policy-free Department read model and characterization | Legacy roster parity; no annual-policy queries; effective dates; read-only requests; auth |
| 2 | Today staffing workspace | Dynamic shifts/topology; explicit adaptive pages; no desktop document/main/roster scrolling at 1857×970 and 1440×900; every record reachable |
| 3 | Department workspace | Person detail and one Update Member workflow; dated roster/topology preview; credentials and both imports; automatic refresh |
| 4 | Unified Bid facade and semantic versions | Immutable history; no-op suppression; restore-as-new; active-run pinning |
| 5 | Configurable evaluation and golden fixtures | 2026 parity and representative policy changes; invalid configuration fails visibly |
| 6 | Draft impact and Blueprint | No writes; authoritative traces/counts/source links; accessible renderer and configured walkthrough |
| 7 | Edit, Mock, Live, Results and History integration | Same determinations; canonical authority preserved; usable workspace flows |
| 8 | Legacy retirement and release | Replacement parity, route/manual sync, full build/tests/E2E/accessibility, hosted CI and CodeQL, recovery and exact-SHA release |

Slices are checkpoints, not permission to report the whole platform finished. Track actual evidence separately from this design.

Phase 4 starts with [typed Bid content and consistent source capture](bid-definition-content.md).
This foundation preserves existing rule material and establishes canonical hashing;
automatic versions, transactional Save/Restore and run pins remain separate integration gates.

## UX and documentation

Top-level navigation converges on Today, Department, Bid and History, with Docs & Manual and Settings secondary. Existing navy, semantic tokens, installed fonts, Base UI controls and roster identity are authoritative. Desktop Today measures usable main space and lays out explicit pages; mobile scrolls naturally. No hidden overflow, tiny type, truncation or fixed six-station assumption may substitute for paging.

The in-app guide and downloadable manual share `guide-content.ts`. Extend existing guide-route and manifest tests to cover canonical workspace routes and changed labels. Retire legacy navigation once the replacement is functional and documented; retain necessary deep-link adapters until consumers migrate.

## Validation and release

Use frozen dependency install, lint, internal package builds, typecheck, full unit/Worker/Web/integration/migration suites, eligibility/A-Day coverage, production and OpenNext builds, backup/deployment guards, Playwright and accessibility checks. Inspect actual main-container overflow, not merely document bounds (the existing fixed body can conceal scrolling).

Before production DB changes: exact SHA/tree, green CI and CodeQL, migration rehearsal, fresh private export/recovery receipt, current D1 Time Travel bookmark, verified recovery procedure and exact-SHA deployment. Never rehearse Time Travel against production. Automated test success, deployed identity and actual browser acceptance are separate evidence.

## Retirement criteria

The current-roster compatibility adapter can retire only when Bid board/history/print/export consumers explicitly consume Department data plus Bid context and golden behavior remains equivalent. Existing rule-book/configuration internals can remain as immutable provenance; their standalone editing/freeze screens retire only after unified semantic saves, run pinning and recovery work. No duplicate rules engine or permanently duplicated roster may be introduced.
