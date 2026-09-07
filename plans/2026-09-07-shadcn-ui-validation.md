# MBFD UI modernization validation record

## Source and scope

Implementation base: main a04d30fa6e3d97602c85a21eb681a462cc516894, tree f34a78464e15b574d204a2d0616aad459133d0b1. Branch: codex/shadcn-enterprise-modernization-20260907. The original feat/mbfd-bid-v2 checkout and its untracked diagnostics were preserved. No Worker, API route, auth client, domain schema, migration, binding, secret, DNS, or deployment workflow source changed.

## Design and component decisions

Manual existing-project shadcn integration with Base UI 1.8.0. Tailwind 3.4.19 and tailwind-merge 2.5.4 retained. The shared COLORS.ui palette supplies RGB variables through the existing Tailwind plugin. Navy navigation, matte light content, restrained red actions, cream station headers, explicit green/blue/red A/B/C labels. Self-hosted Plus Jakarta Sans Variable, Source Sans 3 Variable and JetBrains Mono retained with corrected family names. Canonical 6/8/12px radii, compact rows and 44px form/action foundation.

KEEP: server authorization, APIs, schemas, payloads, query keys, retained edits, idempotency, CSRF, step-up, live stores/sockets, specialized editors, print markup. WRAP: native form controls, labels, semantic tables, existing TanStack v8 sorting. REFACTOR: AdminLayoutShell/AdminSideNav, Dashboard, BoardSeats, DataTable presentation. REPLACE: six nonmodal native-dialog overlays with Base UI focus-managed dialogs; mobile navigation with modal sheet; live shift navigation with Base UI keyboard tabs. Native selects/dates/details intentionally remain native. Board source navigation retains independent URL/query semantics. No fake global search, date, metric, GR assignment, station, or user data was added.

Primitives used: Button, Input, Textarea, NativeSelect, Label, Card, Badge, Alert, Table, Skeleton, Dialog/confirmation composition, Collapsible, Tabs; one shared cn utility. Native checkbox/radio inputs preserve event/form contracts.

## Official research

See components/ui/README.md for provenance and future-generation cautions. Official installation/monorepo/components.json, complete component catalogue, changelog and Tailwind migration guidance were reviewed, together with Base UI dialog/collapsible/tabs APIs. Current upstream Tailwind 4 shortcuts and cn placeholders were adapted for this existing Tailwind 3 project rather than copied blindly.

## Dependencies

Added direct: @base-ui/react 1.8.0 (MIT; React 19 peers) for accessible interactive primitives. Removed direct: unused @radix-ui/react-slot 1.1.0. Added transitive: @babel/runtime 7.29.7; @base-ui/utils 0.4.0; @floating-ui/core 1.8.0, dom 1.8.0, react-dom 2.1.9, utils 0.2.12; reselect 5.3.0; use-sync-external-store 1.6.0. Removed transitive: @radix-ui/react-compose-refs 1.1.0. Zustand remains 5.0.0; its optional use-sync-external-store peer is now resolved. No date-fns, Tailwind 4, new framework, or table-engine major update.

## Temporary local CI validation

GitHub Actions: availability must be established by the new PR runs; a historical minutes-limit claim is not current proof. Existing workflows remain unchanged. Reviewed CI, CodeQL, Dependency audit, Deploy staging, Deploy production and D1 backup.

PASS — pnpm install --frozen-lockfile.
PASS — pnpm lint (834 files, no fixes).
PASS — pnpm typecheck (includes internal package builds).
PASS — pnpm build (optimized Next build; local browser artifact built with NEXT_PUBLIC_WORKER_BASE=http://127.0.0.1:31987).
PASS — pnpm test: eligibility 91 pass/1 skip; shared 166 pass; A-Day 62 pass; Worker 1,210 pass/1 skip; Wrangler launchers 25 pass; web 288 pass. Total 1,842 pass, two existing skips.
PASS — pnpm audit --prod --audit-level=high (no known vulnerabilities at execution).
PASS — ./scripts/test-d1-backup-preflight.ps1.
PASS — node scripts/test-deploy-staging-migration-guard.mjs.
PASS — node scripts/test-deploy-production-migration-guard.mjs.
PASS — git diff --check.

PASS — Linux Node 22.22.1 / pnpm 9.12 frozen install and NEXT_PUBLIC_WORKER_BASE=https://api.staging.bid.mbfdhub.com pnpm --filter @mbfd/web build:opennext:staging. Exact source tree 5343d0ca5cc919a2cb09d994d37a6b365985b98e; apps/web subtree 7e42548fe3bab8eaea655ed89a562bf989c60ff3. The resulting .open-next/worker.js SHA-256 is d05223bf4d44c84108a102ab62aa3bc9c5568f0c3ac2064c37be5cc65c64bc45 (entry file, not a hash of the complete artifact directory). Final report-only changes do not alter the validated application subtree. This is a build, not a deployment.

Final UI follow-up: web unit tests (288), lint and typecheck were rerun after the streaming boundary correction. Next reports 103 kB shared first-load JavaScript, Dashboard 106 kB and Board 158 kB; these are build metrics, not a real-device performance certification.

### Browser checks

PASS — JWT_SIGNING_KEY=<isolated synthetic test key> E2E_USE_BUILT_WEB=1 pnpm --filter @mbfd/web exec playwright test design-system-modernization admin-specialty-scoring admin-members admin-positions-rules admin-imports admin-bid-board admin-annual-preparation admin-catalog-import admin-evidence-workflows admin-staffing-retry annual-product-convergence --project=desktop --workers=1 --timeout=120000 --output=test-results/accepted-source

20 tests passed in 30.7 seconds on the final application source. This runs the optimized local Next server and loopback Worker, not shared staging. Synthetic identities/rows are test fixtures only. It covers all three Board sources and retained refresh data; 46-seat dynamic groups, disclosure/search and overlays; sidebar trapping/Escape/navigation focus; override cancel with zero commands; shift arrows and Enter/Space; PIN disabled/error/labels, reduced motion and touch dimensions; current reviewed catalog layouts, errors and exact retries; member list/detail/404; configured positions/rules; grouped specialty scoring and exact retry; tenure/post-award evidence retention; annual seat conflict/review and exact mock-creation retry; staffing identity retention; audience OFF/LIVE/HOLD and frozen specialty dispatch state.

The older member/position/rule browser mocks could not intercept Server Component fetches and used outdated response fields/unbound URLs. Their fixtures now run in the existing loopback Worker, use current camelCase response contracts and explicit configuration links. The two legacy import tests now assert the current preview/review/commit workflow and invalid-preview block. No production endpoint was changed to satisfy a test. Initial development-server timing failures were resolved and rerun against the optimized artifact.

### Responsive and accessibility evidence

Dense Board: 390, 820, 1024, 1440, 1920px; Dashboard: 390, 820, 1440px; annual/catalog/evidence/specialty/override/PIN flows: 390, 820, 1440px. Screenshots are ignored local artifacts under apps/web/test-results/accepted-source; baseline images remain under their original test-result folders. Tested no horizontal shell overflow at these widths. Semantic tables preserve contained horizontal scrolling where necessary.

23 color tests: semantic text pairs meet WCAG AA normal-text contrast, with separate focus non-text checks. Keyboard and focus assertions cover sheet/modal traps, return focus, accepted route focus, disclosure and manual tab activation. PIN controls measure at least 44x44px; reduced-motion computed transition duration is zero. This is Chromium automation and visual inspection, not a whole-site screen-reader certification or physical iPhone/iPad acceptance.

### Streaming hydration regression

Optimized browser stress checks exposed intermittent React HTML hydration mismatch #418. Diagnostic instrumentation captured main completing with no attached child while its DOM still held a streamed page placeholder. Moving/lazily mounting the mobile portal alone did not resolve it. The final shell adds an explicit Suspense boundary around routed content, retaining server authorization, streaming and the existing page handlers. Closed mobile navigation uses the default lazy portal after main. No hydration warning suppression or error-assertion removal was added.

PASS — E2E_USE_BUILT_WEB=1 pnpm --filter @mbfd/web exec playwright test admin-bid-board admin-evidence-workflows admin-annual-preparation admin-catalog-import design-system-modernization --project=desktop --workers=1 --timeout=120000 --repeat-each=5 --max-failures=1 --output=test-results/stream-visible (35 passed). A synthetic local signing key was set for this isolated run. The React diagnostic chunk was restored byte-for-byte before rebuilding and validation (SHA-256 655580b9e4ab4530700ede76a77aef03be8119fcab7bd93b29dfd3a8681c91e6).

Streaming temporarily retains hidden HTML copies. Browser form/text selectors are scoped to the visible main landmark, and catalog/evidence tests add unique-field assertions before filling. Tab tests select the visible accessible tab and explicitly assert its stable ID. Existing behavior/error assertions remain. An earlier attempt to repeat the entire stateful suite reused staffing fixtures and produced duplicate synthetic seats; final validation runs that suite once with a fresh server and repeats independent rendering tests separately.

### Optional coverage shortfalls (unchanged source)

FAIL — pnpm --filter @mbfd/eligibility test:coverage: tests pass, lines/statements/functions 100%, branches 99.14%; existing threshold is 100%.
FAIL — pnpm --filter @mbfd/a-day test:coverage: tests pass, lines/statements 95.4%, branches 89.21%, functions 88.23%; existing thresholds are 100%.

These packages, tests and thresholds are identical to main. Required CI does not invoke these optional coverage scripts. Thresholds were not lowered. Web/Worker-wide instrumented coverage and hosted CodeQL are not claimed from local unit-test counts.

## Integration preservation matrix

| Boundary | Evidence | Remaining runtime gate |
|---|---|---|
| PIN/auth/roles/logout/Hub | Existing web and Worker auth tests; unchanged guards, cookies, federation handlers; isolated PIN UI test | Real authenticated staging federation/logout |
| Workers/D1/R2/queues/DO | Full Worker/integration/launcher tests; unchanged backend/bindings/schema | Hosted staged services and authenticated evidence/export operations |
| Cloudflare/OpenNext | Optimized Next build and Linux staging artifact; deployment-guard tests | Exact hosted deployment and runtime identity |
| Current/historical/upcoming | Independent-source Board E2E, unchanged schema/query/cache selection | Actual staging source data |
| Live/mock/eligibility/awards | Full deterministic package/Worker tests; isolated live UI, mock exact retry and read-only display tests | Authorized live acceptance; no real pick/award manufactured |
| Configuration/personnel/TeleStaff | Preserved domain handlers, identity keys, retained edits, source provenance and refresh; existing suites plus representative E2E | Authenticated staging source intake and policy approval |
| Audits/exports/print | Existing tests; unchanged endpoints, R2 and print renderer markup | Real generated export/physical print review |

## Release and rollback

No remote deployment has been performed at this report snapshot. The existing guarded staging workflow must run only after candidate gates. Production requires the existing immutable SHA/backup-evidence workflow, environment gates and authenticated staging acceptance. No migrations are required by this change. Rollback uses an approved source/artifact revert through existing workflow. Never roll back D1 for this presentation change. PR checks and deployment outcomes belong to the final release follow-up.

## Complete route/surface inventory

Every page below inherits the shared foundation; direct workspaces/controls and intentionally preserved print surfaces are detailed in 2026-09-07-ui-inventory.md. Route inventory is not a claim that every authenticated production page was exercised.

- /login
- /admin/annual-plan
- /admin/annual-policy
- /admin/audit
- /admin/award-transition
- /admin/bid-board
- /admin/bid-setup
- /admin/bid
- /admin/credentials/import
- /admin/credentials
- /admin/current-rosters
- /admin/current-rosters/print — print markup preserved
- /admin/eligibility
- /admin/exports
- /admin/exports/render/roster/[shift]/[session_id] — print markup preserved
- /admin/guide
- /admin/members/[id]/edit
- /admin/members/[id]
- /admin/members/eligible/[station]
- /admin/members/import
- /admin/members
- /admin/members/roster
- /admin/organization
- /admin
- /admin/personnel/obligations
- /admin/personnel/operations
- /admin/personnel
- /admin/personnel/qualifications
- /admin/personnel/readiness
- /admin/personnel/reviews
- /admin/personnel/service-evidence
- /admin/personnel/tenure
- /admin/positions/[id]/edit
- /admin/positions
- /admin/rehearsal
- /admin/rule-books/[version]
- /admin/rule-books
- /admin/rules
- /admin/sessions/[id]
- /admin/sessions/new
- /admin/settings/bid-pin
- /admin/specialty-adjudication
- /admin/staffing-structure
- /admin/system
- /admin/telestaff
- /bid
- /live
- /lobby
- /

## Changed files by purpose

### Foundation

- apps/web/app/globals.css
- apps/web/components.json
- apps/web/components/ui/README.md
- apps/web/components/ui/alert.tsx
- apps/web/components/ui/badge.tsx
- apps/web/components/ui/button.tsx
- apps/web/components/ui/card.tsx
- apps/web/components/ui/collapsible.tsx
- apps/web/components/ui/dialog.tsx
- apps/web/components/ui/input.tsx
- apps/web/components/ui/label.tsx
- apps/web/components/ui/native-select.tsx
- apps/web/components/ui/skeleton.tsx
- apps/web/components/ui/table.tsx
- apps/web/components/ui/tabs.tsx
- apps/web/components/ui/textarea.tsx
- apps/web/lib/utils.ts
- apps/web/package.json
- apps/web/tailwind.config.ts
- packages/shared/src/constants/design-tokens.ts
- pnpm-lock.yaml

### Shell

- apps/web/app/admin/_components/AdminLayoutShell.tsx
- apps/web/app/admin/layout.tsx
- apps/web/components/BrandHeader.tsx
- apps/web/components/LogoutButton.tsx
- apps/web/components/admin/AdminShell.tsx

### Dashboard

- apps/web/app/admin/page.tsx

### Board

- apps/web/app/admin/bid-board/BidBoardWorkspace.tsx
- apps/web/app/admin/bid-board/BoardSeats.tsx

### Workflows

- apps/web/app/admin/annual-plan/AnnualPlanFreeze.tsx
- apps/web/app/admin/annual-plan/AnnualPlanParticipants.tsx
- apps/web/app/admin/annual-plan/AnnualPlanProfiles.tsx
- apps/web/app/admin/annual-plan/AnnualPlanReview.tsx
- apps/web/app/admin/annual-plan/AnnualPlanSeats.tsx
- apps/web/app/admin/annual-plan/AnnualPlanWorkspace.tsx
- apps/web/app/admin/annual-plan/annual-plan-client.ts
- apps/web/app/admin/annual-policy/AnnualPolicyPublishGate.tsx
- apps/web/app/admin/annual-policy/AnnualPolicyWorkspace.tsx
- apps/web/app/admin/audit/page.tsx
- apps/web/app/admin/award-transition/AwardTransitionWorkspace.tsx
- apps/web/app/admin/bid-setup/BidSetupWorkspace.tsx
- apps/web/app/admin/bid-setup/page.tsx
- apps/web/app/admin/bid/_components/AnnualLiveControls.tsx
- apps/web/app/admin/bid/_components/AnnualOperationsStatus.tsx
- apps/web/app/admin/bid/_components/BidAdvisoryPanel.tsx
- apps/web/app/admin/bid/_components/BidRoster.tsx
- apps/web/app/admin/bid/_components/FreezeConfirmDialog.tsx
- apps/web/app/admin/bid/_components/LiveCommandBar.tsx
- apps/web/app/admin/bid/_components/ManualPickBar.tsx
- apps/web/app/admin/bid/_components/MockFreezeButton.tsx
- apps/web/app/admin/bid/_components/OverrideDialog.tsx
- apps/web/app/admin/bid/page.tsx
- apps/web/app/admin/credentials/CredentialsCatalogWorkspace.tsx
- apps/web/app/admin/credentials/import/CredentialImportWorkspace.tsx
- apps/web/app/admin/credentials/page.tsx
- apps/web/app/admin/current-rosters/CurrentRostersWorkspace.tsx
- apps/web/app/admin/current-rosters/page.tsx
- apps/web/app/admin/eligibility/EligibilityPreviewForm.tsx
- apps/web/app/admin/eligibility/page.tsx
- apps/web/app/admin/error.tsx
- apps/web/app/admin/exports/_components/DirectCsvExports.tsx
- apps/web/app/admin/exports/_components/ExportCard.tsx
- apps/web/app/admin/exports/_components/ExportTriggerButton.tsx
- apps/web/app/admin/exports/_components/ManualRetryButton.tsx
- apps/web/app/admin/exports/_components/PortalSyncStatus.tsx
- apps/web/app/admin/exports/_components/SessionSelectionPanel.tsx
- apps/web/app/admin/exports/page.tsx
- apps/web/app/admin/guide/AdministratorGuideWorkspace.tsx
- apps/web/app/admin/members/[id]/edit/EditForm.tsx
- apps/web/app/admin/members/[id]/edit/page.tsx
- apps/web/app/admin/members/[id]/loading.tsx
- apps/web/app/admin/members/[id]/not-found.tsx
- apps/web/app/admin/members/[id]/page.tsx
- apps/web/app/admin/members/_lib/station-info.ts
- apps/web/app/admin/members/eligible/[station]/EligiblePillCluster.tsx
- apps/web/app/admin/members/eligible/[station]/page.tsx
- apps/web/app/admin/members/import/RetiredMemberImportPanel.tsx
- apps/web/app/admin/members/loading.tsx
- apps/web/app/admin/members/page.tsx
- apps/web/app/admin/members/roster/RosterClient.tsx
- apps/web/app/admin/members/roster/page.tsx
- apps/web/app/admin/organization/OrganizationSeatLinks.tsx
- apps/web/app/admin/organization/OrganizationWorkspace.tsx
- apps/web/app/admin/personnel/PersonnelWorkspace.tsx
- apps/web/app/admin/personnel/obligations/ObligationsWorkspace.tsx
- apps/web/app/admin/personnel/operations/page.tsx
- apps/web/app/admin/personnel/page.tsx
- apps/web/app/admin/personnel/qualifications/QualificationLifecycleWorkspace.tsx
- apps/web/app/admin/personnel/qualifications/page.tsx
- apps/web/app/admin/personnel/readiness/ReadinessWorkspace.tsx
- apps/web/app/admin/personnel/readiness/page.tsx
- apps/web/app/admin/personnel/reviews/QualificationReviewWorkspace.tsx
- apps/web/app/admin/personnel/reviews/page.tsx
- apps/web/app/admin/personnel/service-evidence/ServiceEvidenceWorkspace.tsx
- apps/web/app/admin/personnel/tenure/TenureWorkspace.tsx
- apps/web/app/admin/positions/[id]/edit/ConfiguredScoringEditor.tsx
- apps/web/app/admin/positions/[id]/edit/RuleEditor.tsx
- apps/web/app/admin/positions/[id]/edit/page.tsx
- apps/web/app/admin/positions/loading.tsx
- apps/web/app/admin/positions/page.tsx
- apps/web/app/admin/rehearsal/_components/AutoBidButton.tsx
- apps/web/app/admin/rehearsal/_components/CloseStaleMockButton.tsx
- apps/web/app/admin/rehearsal/_components/FindingsList.tsx
- apps/web/app/admin/rehearsal/_components/MockSessionsTable.tsx
- apps/web/app/admin/rehearsal/_components/NewFindingForm.tsx
- apps/web/app/admin/rehearsal/_components/ResetMockButton.tsx
- apps/web/app/admin/rehearsal/_components/VerifyAuditButton.tsx
- apps/web/app/admin/rehearsal/page.tsx
- apps/web/app/admin/rule-books/RuleBookCreateForm.tsx
- apps/web/app/admin/rule-books/[version]/PublishButton.tsx
- apps/web/app/admin/rule-books/[version]/page.tsx
- apps/web/app/admin/rule-books/page.tsx
- apps/web/app/admin/rules/loading.tsx
- apps/web/app/admin/rules/page.tsx
- apps/web/app/admin/sessions/[id]/ForcePickSheet.tsx
- apps/web/app/admin/sessions/[id]/SessionControls.tsx
- apps/web/app/admin/sessions/[id]/SessionOperatorLinks.tsx
- apps/web/app/admin/sessions/[id]/page.tsx
- apps/web/app/admin/sessions/new/NewSessionForm.tsx
- apps/web/app/admin/sessions/new/page.tsx
- apps/web/app/admin/settings/bid-pin/BidPinForm.tsx
- apps/web/app/admin/settings/bid-pin/page.tsx
- apps/web/app/admin/specialty-adjudication/SpecialtyAdjudicationWorkspace.tsx
- apps/web/app/admin/staffing-structure/StaffingStructureWorkspace.tsx
- apps/web/app/admin/staffing-structure/page.tsx
- apps/web/app/admin/system/page.tsx
- apps/web/app/admin/telestaff/TeleStaffOperatorWorkspace.tsx
- apps/web/app/admin/telestaff/page.tsx
- apps/web/components/admin/DataTable.tsx
- apps/web/components/admin/ImportResults.tsx
- apps/web/components/admin/MembersTable.tsx
- apps/web/components/admin/PositionGroup.tsx
- apps/web/components/admin/PostAwardObligationsEditor.tsx
- apps/web/components/admin/QualificationAlternativesEditor.tsx
- apps/web/components/admin/RetainedEvidenceReview.tsx
- apps/web/components/admin/RuleNode.tsx
- apps/web/components/admin/ServiceRequirementsEditor.tsx
- apps/web/components/admin/UploadForm.tsx

### Public

- apps/web/app/(auth)/login/page.tsx
- apps/web/app/_components/bid/BidderCard.tsx
- apps/web/app/_components/bid/OnDeckQueue.tsx
- apps/web/app/_components/bid/RichPositionCell.tsx
- apps/web/app/_components/bid/ShiftTabs.tsx
- apps/web/app/_components/bid/StationGroupedGrid.tsx
- apps/web/app/bid/_components/ADayCapacityMeter.tsx
- apps/web/app/bid/_components/ADayPicker.tsx
- apps/web/app/bid/_components/BoardHeader.tsx
- apps/web/app/bid/_components/EligibleList.tsx
- apps/web/app/bid/_components/ErrorToast.tsx
- apps/web/app/bid/_components/YourTurnPanel.tsx
- apps/web/app/bid/loading.tsx
- apps/web/app/bid/page.tsx
- apps/web/app/layout.tsx
- apps/web/app/live/PresentationView.tsx
- apps/web/app/lobby/loading.tsx
- apps/web/app/lobby/page.tsx
- apps/web/app/page.tsx
- apps/web/components/PinForm.tsx

### Tests

- apps/web/tests/e2e/admin-annual-preparation.spec.ts
- apps/web/tests/e2e/admin-bid-board.spec.ts
- apps/web/tests/e2e/admin-specialty-scoring.spec.ts
- apps/web/tests/e2e/admin-staffing-retry.spec.ts
- apps/web/tests/e2e/annual-product-convergence.spec.ts

- apps/web/tests/e2e/admin-catalog-import.spec.ts
- apps/web/tests/e2e/admin-evidence-workflows.spec.ts
- apps/web/tests/e2e/admin-imports.spec.ts
- apps/web/tests/e2e/admin-members.spec.ts
- apps/web/tests/e2e/admin-positions-rules.spec.ts
- apps/web/tests/e2e/annual-local-worker.mjs
- apps/web/tests/e2e/design-system-modernization.spec.ts
- apps/web/tests/e2e/synthetic-admin-read-fixtures.mjs
- apps/web/tests/unit/LiveCommandBar.test.tsx
- apps/web/tests/unit/admin-mobile-navigation.test.tsx
- apps/web/tests/unit/annual-policy-publish-gate.test.tsx
- apps/web/tests/unit/design-token-contrast.test.ts

### Documentation

- plans/2026-09-07-shadcn-ui-validation.md
- .impeccable.md
- plans/2026-09-07-shadcn-ui-enterprise-modernization.md
- plans/2026-09-07-ui-inventory.md
