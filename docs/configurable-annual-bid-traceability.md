# Configurable annual Bid implementation evidence

## Source and authority

Analysis reference and verified implementation base: `9a3fbf09f543c73c0c0e0a0809ca61d8da65ef35`, tree `961ebb515d0cc99c6a2eecc0000be6b061f72ce7`.
Verified on 2026-09-06 against fetched `origin/main`, production deployment [34050041510](https://github.com/pdarleyjr/mbfd-bid/actions/runs/34050041510), and the completed Live/Mock release task's acceptance record. That record explicitly reports readiness for this implementation and no remaining release authority blocker. The shared checkout and its untracked diagnostics are preserved.

Implementation branch: `codex/configurable-annual-bid-20260906`. This document records ongoing work, not release acceptance.

Local source copies were located in Downloads. Their filename suffixes differ from the specification; confirmation of equivalence is requested. Neither raw documents nor personnel fixtures belong in this repository. Full local archive inventory and hashes are retained outside Git.

| Evidence | SHA-256 | Applicable use |
| --- | --- | --- |
| 2026 Bid Policy v3.docx | 39d65e651cec18328b50d88ebd086e24485d12078aa43cad0d2d45cb67f73a24 | Intended rules; approval and applicable period must be established |
| Archive policy DOCX | 5770b6e0413e58b6c588edebe6026d27afcb72a1f4214da2f60eadd7bc34ce3f | Identical extracted body hash; not a second textual revision |
| Daily staffing guidelines | 622837688a7ace9d11329d3ec1fc8b009bbdc75bdf2e3821db78d011b3202abe | Daily operations, not automatic annual eligibility |
| Assignments HTML | 85e44bfe271b1fed45bd22f974547200c2c6ff5015aa7c58878eca7aca520b39 | Staffing observation; incomplete topology |
| Dated XML staffing export | 1adb6c119dd08b3812b0b282647e37a04c2d85e60cb1dacb75fdbaaefcfc0354 | XML Spreadsheet despite .xls extension |
| Annual calculations workbook | 142daca35ff17403b63815b885b2ec97fa9df00b85c628e7095aec5146b3ee41 | 50 sheets; mixed historical rules, credential versions, formulas and caches |
| Master positions workbook | 29d77af9df3745054635341e4099024e423afaf09cf7c60724a9314cebce240e | 19 sheets; operational examples, not verified official completion |
| 2025 credential PDF | 6e2dcd2021af37fbfdc532f0da50f8f644c944000ea962cc54405480299115e1 | 57 pages of historical qualification evidence |
| A-Day PDF | 3f71d9a37dbea7c40b98ed24f1ee9a81157bed458e8dd52c56baee5584f778b4 | Dated 2025 calendar; printed headers control shift order |

## Requirement coverage

S = SOURCE-SUPPORTED, A = ARCHITECTURALLY REQUIRED. Mandatory items remain required until implemented and verified; a listed test target does not imply it has passed.

| Requirement | Class and evidence | Existing implementation / gap | Implementation and acceptance target |
| --- | --- | --- | --- |
| Stable credentials and display rename | A; specification 7, 11 | credentials.ts mutates the name consumed by rules | Add catalog display metadata; immutable legacy token; revision/receipt/rollback tests |
| Qualification dates and lifecycle | S; policy paragraphs 11, 92–109, 119–170 | qualification-lifecycle.ts already has dated evidence | Retain gains, expiry, revocation; add catalog lifecycle integration |
| Organization and seats | A; specification 7; policy 187–195 | staffing_positions has stable seats but no station identity | Persistent minimal catalog; Station 7 UI and effective-date fixtures |
| Guided annual preparation | A; specification 8 | BidSetupWorkspace uses special 2026 bootstrap | Extend bid_years designation; blank/resume/verified-source clone tests |
| Shared requirements and scoring | S/A; policy 83–107 and 119–163 | explicit rules exist; SO/MO pools and pairings are hard-coded | Typed authoring and compilation; configured scoring and frozen compatibility |
| Service, tenure, obligations | S; policy 9, 70, 168–170 | insufficient routine typed evidence evaluation | Narrow primitives; missing evidence remains unknown |
| Participation distinct from occupancy | S/A; policy 17, 43, 181, 187 | three seat participation states already exist | Preserve states and explicit manual exceptions |
| Readiness, source changes, impact | A; specification 8, 10 | coverage and preview exist; fragmented orchestration | Revision-bound counts, conflicts and evaluator-backed differences |
| Rehearse/freeze | A; specification 8, 11 | existing Mock, publication and snapshots | Reuse guarded lifecycle; partial failure/recovery and stale Mock tests |
| Previous board | A; specification 13 | canonical completion projection and adapter exist | Reuse verified completion and frozen topology; no current-name substitution |
| Current board | A; specification 13 | Current Roster shared screen/export projection exists | Extract/reuse dated projection; distinguish vacant/unmapped/temporary |
| Upcoming board | A; specification 13 | designated annual configuration exists | Exact designation; no occupant fields in response schema |
| Members explanations | A; policy 70 vs fixed inspector gate; 125 vs immediate diver gate | station-eligibility.ts is an unbound legacy filter | Explicit nonauthoritative labeling or bound evaluation |
| Admin navigation and refresh | A; specification 14 | shared QueryClient, focus disabled | Targeted invalidation, scoped cache, unsaved-form and responsive checks |
| Imports and exports | A; specification 15 | reviewed TeleStaff and streaming exports exist | Preserve provenance; revision/idempotency and formula-injection checks |
| Historical replay | A; specification 18I | opt-in test silently skips missing cases and has a pass placeholder | Fail missing requested fixtures/rules/members; hashed manifest and exact outcomes |
| Live/security/regression | A; specification 16, 18 | accepted canonical commands, grants, federation, deterministic Advisory | Existing suites plus unauthorized/concurrency tests; no Real acceptance operations |
| Controlled migration/release | A; specification 17, 19 | ordinary production workflow is D1 read-only | Fresh/upgrade compatibility, backup, controlled migration procedure, immutable deployment |
| Administrator Guide | A; specification 20 | task-oriented in-app guide exists | Update only after actual workflows are available and verified |

## Unresolved policy decisions

| Topic | Conflict / missing evidence | Required decision and activation consequence |
| --- | --- | --- |
| Technician credit | Paragraphs 83–89 and 107 describe two points plus an extra point after all Operations; older workbook formulas differ | Approved total versus incremental scoring and reviewed credential mapping; block affected new rules until recorded |
| Marine | Paragraphs 119–163 distinguish required Metal Craft roles, HazMat Awareness and preferred diver; 168 sets a three-month obligation; old helper requires diver immediately | Applicable approved prerequisites, credential IDs and post-award obligations; no inferred equivalences |
| Captain 5 | Paragraph 70 requires paramedic and 36 cumulative Rescue Division months; old helper requires inspector/instructor | Approved applicability and complete dated service evidence; unknown evidence cannot pass |
| Staffing conflict | Supplied sources disagree for the specification's identified employee | Authorized reviewed reconciliation; never infer a canonical seat or silently overwrite occupancy |
| Specialty timeline and separation SOG | Policy paragraphs 200 and 215 reference absent documents | Supply applicable approved constraints before their activation; no personal relationship inference |
| Historical normative replay | Observed awards do not prove every normative eligibility/scoring outcome | Reviewed fixture manifest distinguishes observations from expectations and documents exclusions |

## Additional local implementation evidence

- Freeze now includes accepted staffing-baseline provenance in Mock snapshots and in the exact rehearsal-material comparison. Two negative fixtures reject missing or changed baseline evidence without modifying historical snapshot bytes or publishing either artifact; all eighteen freeze cases passed. A Mock captured before this provenance was recorded must be rehearsed again for guided freeze.
- Credential dependency review now includes frozen snapshots (including serialized rule JSON), qualification-history event counts and distinct referenced members from both the legacy projection and evidence ledger. A synthetic historical fixture proves discovery of nested frozen requirements and preserves exact snapshot bytes. These references inform retirement; they never revoke historical evidence.
- Previous now resolves the latest verified completion separately from cached awards. Focus/reconnect checks the completion list; an explicit historical selection remains pinned. The localhost browser scenario passed discovery of a new completion and return to cached older awards, together with the real local web-proxy seat-creation response-loss retry. The guide documents the selector.
- Personnel changes, qualification lifecycle, staffing-seat creation, temporary overlay creation/end, and qualification review batch/stage/apply retain their request identities across response loss. Personnel edits invalidate the reviewed preview; the next submit must preview the changed payload before committing it. Focused component tests exercise these boundaries. The older personnel and qualification forms now use the existing CSRF bootstrap helper. Actual local streaming POST forwarding exposed and fixed the Node fetch duplex requirement without buffering uploads or weakening CSRF.
- Exact-base application testing against migrations through 0055 demonstrated a pre-write rollback incompatibility: credential creation and points changes worked, while policy-name rename was rejected by the new immutability trigger. The rollback remained atomic, but the old runtime is not a qualified recovery target. See [recovery boundaries](annual-candidate-recovery-boundaries.md).
- Guided existing-draft adoption retains designated rule/position identities, requires explicit annual dates, resets inherited participation review and binds the write to source/configuration revisions. Six integration cases cover exact retry, rollback, stale inputs, sharing, publication and Real-session exclusions.
- Annual seat review/removal, draft adoption, revision reconciliation and Mock response-loss retry have passed localhost browser checks. These use synthetic fixtures, not production accounts or accepted operational evidence.
- Impact now distinguishes policy-only and evidence/cohort effects, reports tied candidate priorities without inventing a tie-break, and accounts separately for added/removed members and rule positions. The UI provides filters, pagination and full review export.
- Migration 0055 adds immutable source-review evidence for comparison against the draft's last saved review. It does not introduce another active configuration or weaken freeze approval. Checkpoint rollback/retry/immutability tests passed locally. The migration suite also preserves a populated pre-0045 estate across twelve existing tables (personnel, catalog and qualifications, templates, books, rules, years, sessions, frozen snapshot, seats and assignments), with exact V1 snapshot bytes and foreign-key integrity. This is synthetic upgrade evidence; production backup/recovery and full runtime rollback qualification remain required.
- Grouped specialty scoring passed localhost browser tests at 390, 820 and 1440 pixels, retaining alternatives, prerequisites and multiple scoring channels through a lost-response retry. Service, tenure and post-award reconciliation browser tests passed after the retained-review panel changes.
- The shared unsaved-edit guard includes same-path year-query changes; the catalog uses that same guard. Initial catalog loading fetches all pages before seeding the query cache; a 501-entry fixture and an incomplete-page rejection test passed. Chromium Back cancellation passed with the supported cancellable Navigation API, retaining unsaved scoring edits; this is not a universal browser compatibility claim.
- Focus/reconnect catalog refresh preserves unsaved fields. Authenticated identity and security-version changes isolate protected query data through the actual Admin layout. Annual and staffing mutations invalidate their dependent working views without invalidating immutable Previous award evidence. Personnel, qualification, staffing-seat, TeleStaff apply and award-transition workflows now refresh their server projections after accepted changes. Browser board checks verify focus/reconnect refresh and retained successful data during failure, plus mobile first-link focus, Escape return and route-close behavior.
- The post-award editor supports an explicitly reviewed bid start date as well as the final accepted award date. This follows the rendered Marine training clause without inventing a start date. Calendar/schema, frozen projection, editor-state and browser late-completion/retry cases passed locally.
- The local implementation checkpoint `022c5ded87dd7c8394101c35c03642efbf38c093` has tree `0a8e2045aa63171cbfb4ebea6b0bce9dbe1b158d`. Its Worker suite passed 1,209 tests with one explicit optional source-file skip, plus all 25 launcher checks. Shared passed 166, A-Day 62, and eligibility passed 89 with historical replay skipped. The final web suite at that checkpoint passed 265 tests across 77 files. Typechecking and lint (815 files) passed. Later parser and replay-harness changes are recorded separately; these are local checkpoints, not hosted CI or release acceptance.
- Six combined localhost browser scenarios passed at the implementation checkpoint, exercising 390, 820 and 1440 pixel widths as applicable. Earlier cold initial-load assertions failed at five seconds; traces did not establish the exact hydration-delay cause. Initial data assertions now allow fifteen seconds. The annual workspace also withholds blank preparation controls until saved-plan lookup resolves. These checks establish tested functional behavior, not production latency or authenticated production acceptance.
- Linux frozen install, root build and OpenNext staging build passed from the 22:43 source copy, using the same fixed staging API base as CI. All 959 source-file hashes were verified in Linux, and the copy matched the local implementation checkpoint before commit. Native Windows bundling previously failed on Sharp's native module. The artifact was not deployed; later parser, harness and documentation changes require a refreshed exact-source artifact.
- Replay evidence accepts an explicit private fixture directory, checks expected priority groups without inventing tie-breaks and selects explicit rule versions for before/after amendment cases. Observed differences and approved-expectation failures are reported separately. An enabled historical run requires approved negative, ordering and amendment coverage. The updated eligibility suite passed 91 tests with historical replay explicitly skipped; harness tests are synthetic. No private historical fixture manifest has been accepted or replayed.
- Actual-source import format verification and the credential-import integration suite passed thirteen tests after the parser began explicitly rejecting sheets with no qualification headers. The pinned 2025 workbook is a narrative rule sheet with a separate vertical catalog; rejection is negative import coverage, not positive historical extraction or replay.
- [Workbook findings](annual-workbook-source-findings.md) record concrete table/formula conflicts and cache failures. Full substantive source reconciliation and meaningful historical replay remain incomplete.

Production has not been mutated by this implementation. No release, meaningful historical replay, or production UI acceptance is claimed by this ongoing record. Required source and release work remains outstanding.
