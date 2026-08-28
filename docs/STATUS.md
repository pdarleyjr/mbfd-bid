# Plan execution status + watch-items

## Current control-plane checkpoint — 2026-08-28

> This is the current MBFD Bid V2 readiness classification. Dated entries below
> preserve their point-in-time evidence; they do not override these states.

| Area | Current verified state | Remaining boundary |
| --- | --- | --- |
| PR and source | Draft PR [#96](https://github.com/pdarleyjr/mbfd-bid/pull/96) remains unmerged. The accepted staging credential-bridge source checkpoint is `d7dc0118991c38431c5afc876fa8daeeb185327a`. | Do not merge or deploy production. Follow-on control-plane work must remain reviewable, with one logical checkpoint at a time. |
| Staging auth bridge | `STAGING_AUTH_BRIDGE_READY=YES`. Staging uses `PORTAL_BASE_URL=https://www.mbfdhub.com`; the Hub reader-token bridge rejects invalid/no-bearer requests correctly, and the staging PIN remains `2300`. | `STAGING_MEMBER_VALID_LOGIN=PENDING_AUTHORIZED_TEST_IDENTITY`; no member identity was invented or reset for acceptance. |
| Staging readiness | `STAGING_ADMIN_UI_TEST_READY=YES`. `STAGING_FULL_BID_WORKFLOW_READY=NO_AUTHORITATIVE_STAFFING_BASELINE`. | The remaining full-workflow gate is a reviewed authoritative staffing baseline, bindings, and member assignments—not POL-015. |
| Division Chief policy | `POL-015` is resolved: A211/B211/C211 are administratively assigned, non-biddable staffing positions. Draft `2026.2` contains the valid 229-position candidate set and remains unpublished. | Do not publish the draft until reviewed staffing bindings and actual-occupant exclusion proof exist. Active `2026.1` remains untouched. |
| Production origin | Checked-in production configuration still references `https://portal.mbfdhub.com`. That hostname is known invalid. | `PRODUCTION_PORTAL_URL_BLOCKER_RECORDED=YES`. Before any production provisioning, production must use the verified MBFD Hub origin; this checkpoint makes no production-resource change. |
| Safety and validation | `PORTAL_WRITEBACK_ENABLED=false`; `PORTAL_BID_WRITER` is absent; no portal consumers exist. Frozen install, lint, package build, typecheck, Next build, D1 preflight, full tests (1,125 passed; 4 intended skips), clean-Linux OpenNext build/preview, and diff check passed at the accepted source checkpoint. | The known `extract-zip@2.0.1` high advisory remains unsuppressed. `GITHUB_ACTIONS_USED=NO`; no production, Media Control, GMKtec, Docker, tunnel, or unrelated DNS change occurred. |

## POL-015 staging-draft checkpoint — 2026-08-28

| Area | Current verified state | Remaining boundary |
| --- | --- | --- |
| Policy decision | **Resolved:** A211/B211/C211 are administratively assigned staffing positions outside ordinary Bid; `pre_bid_pool` is a superseded inaccurate fixture abstraction. | Active staging `2026.1` remains immutable at 232 rules. The corrected `2026.2` is a draft only; no active policy was changed. |
| Rule-book lifecycle | After a fresh private D1 Time Travel bookmark, managed migration `0023` was applied to staging. The normal admin API cloned `2026.1` to `2026.2`, set only A211/B211/C211 to `ADMIN_ASSIGNED_NON_BIDDABLE`, and deleted only their draft rules. Coverage is valid: 229 expected/229 valid, no invalid, missing, duplicate, non-biddable, or unexpected positions; the identifier-only diff contains only A211/B211/C211. | Do not publish `2026.2` until actual reviewed staffing positions, bindings, and assignments exist in staging and prove the required occupant exclusions. |
| Pool/session model | Reviewed authoritative staffing assignments exclude only their actual occupants; the normalized pool and order freeze with the session. Vacancy does not create a Bid opportunity. | Staging has zero staffing positions, zero position-to-staffing bindings, and zero member assignments. No staffing or employee data was invented or modified to force a proof. |
| Validation | Final source-local gate passed: frozen install, lint, package builds, workspace typecheck, Next build, D1 preflight, full suite (1,125 passed; 4 intentional opt-in skips), and diff check. The Web surface passed a clean Linux Node 22.22.1 / pnpm 9.12 OpenNext build and was deployed to the existing staging Web Worker as `869f9cb8-ea5e-42d4-a00a-90d1857763f3`. | The unsuppressed `extract-zip@2.0.1` high advisory remains; it is not waived. |
| Staging mock acceptance | Not attempted. A read-only investigation found no safe completely isolated synthetic rule-book/session scope, and the absent authoritative assignment data prevents a truthful ordinary-mock freeze/exclusion proof. | Do not create a synthetic or ordinary staging mock merely to force a pass. The full workflow remains unaccepted. |
| Safety | No GitHub Actions, production, Media Control, GMKtec, Docker, tunnel, unrelated DNS, portal publication, or portal writeback changed. Staging-only changes were migration `0023`, the audited `2026.2` draft lifecycle, the historical precursor API Worker `123264ad-e0ec-402b-87a3-e0366b11ee0d`, and the existing staging Web Worker deployment. The accepted credential-bridge repair supersedes the precursor API version and is recorded in the current checkpoint above. | Existing staging auth/UI acceptance remains separately valid; production remains blocked. |

## Historical staging final-auth checkpoint — 2026-08-27

> This checkpoint was superseded by the later 2026-08-28 staging policy lifecycle
> and credential-bridge checkpoints. It remains point-in-time authentication
> evidence, not current runtime or readiness metadata.

| Area | Verified current state | Remaining boundary |
| --- | --- | --- |
| Source and local verification | Exact Web source `5ead0c7`; frozen install, lint, typecheck, build, D1 preflight, diff check, and `pnpm test` passed (1,102 tests; 4 opt-in skips). | GitHub Actions were unavailable and no hosted result is claimed for this checkpoint. The unresolved `extract-zip` high advisory remains a production gate. |
| Web runtime | Exact clean-Linux Node 22.22.1 / pnpm 9.12.0 OpenNext artifact deployed as Worker `c1d49ee3-a9ab-4531-b65b-5275617345cc` on `staging.bid.mbfdhub.com`; local preview smoke passed before deployment. | Windows-native `sharp` bundling is not a runtime gate; production is not authorized. |
| API/data plane | API Worker secret-change version `aadd7371-417c-4a4c-9a01-d0a5dcccd4cf`; D1 remains through migration 0022 with no pending work and an empty FK check. | Policy, staffing/import, and non-mock command gates remain open. |
| Auth and PIN | Both staging Worker secret names include `JWT_SIGNING_KEY`; a fresh API-to-Web JWT session-finalization proof passed. The staging-local admin password was reset with a user-context DPAPI handoff. Canonical KV PIN 2300 was live-proven, temporarily rotated through the normal admin UI, then restored to 2300. | Secret-name listing is not a value comparison; fresh auth is the operational pair proof. No production local-admin credential exists. |
| Isolation | Staging R2 v2 audit/export bindings are active; portal writeback is disabled, writer secret absent, and the queue configuration has one producer with zero consumers. | No portal publication was attempted. Queue paused state and message depth were not independently observed. |
| Browser | Authenticated staging-local admin, same-origin PIN/session-finalize guards, secure cookies, reload persistence, 13 implemented admin routes, mock-board WebSocket state snapshot, audit-chain verification, export retrieval, and portal-disabled `409` negative acceptance passed with zero console errors and zero observed 5xx responses. | Mock auto-bid is correctly blocked by three semantically invalid active rule-book rows; successful picks require accountable rule-data correction. Member acceptance remains pending an authorized test identity. |
| Rollback/cleanup | Fresh private D1 recovery material was captured; disposable proof DBs, canary, and local export/proof files were deleted. The obsolete staging `PIN_HASH` secret and temporary PIN handoff were removed. Existing `mbfd-bid-web-staging` Pages project was retained as rollback material. | Removal is not a claim of physical-bit erasure. |
| Shared infrastructure | No production, GMKtec, Docker, tunnel, Media Control, or shared-host change. | Protected boundary remains in force. |

Updated as each task / plan completes. Watch-items are forward-looking
concerns surfaced by code review that need attention in later tasks
(not blocking the task that surfaced them).

---

## Plan 01 — Foundation

### Completed tasks

#### Task 1 — Initialize monorepo skeleton ✅
- Date: 2026-05-17
- Commit: `7229712`
- Reviews: spec ✅ · code quality ✅ (Ready to merge: Yes)
- Files added: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `pnpm-lock.yaml`

### Watch-items (forward-looking)

These were raised during Task 1 code review and need to be addressed by the
indicated future task / plan. Each is currently non-blocking.

| ID | Source | Watch-item | Action by |
|----|--------|------------|-----------|
| W1 | T1 review | `node-linker=isolated` may break OpenNext for Cloudflare resolution of `next`/`react`. If `opennextjs-cloudflare build` fails in Task 12, add `public-hoist-pattern[]` for `*next*`, `*react*` in `apps/web/.npmrc`. | Task 12 |
| W2 | T1 review | TypeScript / `@types/node` versions are duplicated across all sub-packages. Consider introducing pnpm `catalog:` in `pnpm-workspace.yaml` before drift starts. | Task 3 or follow-up |
| W3 | T1 review | `tsconfig.base.json` includes `DOM` in `lib`. The Worker (Task 4) must override `lib` to `["ES2022", "WebWorker"]` + `@cloudflare/workers-types` so accidentally referencing `window`/`document` fails to compile. | Task 4 |
| W4 | T1 review | No `tsconfig.json` at repo root — `tsc` from root will fail confusingly until project references exist. Consider adding a root tsconfig with `{ "files": [], "references": [...] }` once sub-packages exist. | Task 3 |
| W5 | T1 review | `engine-strict=true` is not set in `.npmrc`. `engines.node: ">=20.11.0"` is advisory. Add if you want local installs on Node 18 to **fail** rather than warn. | follow-up |
| W6 | T1 review | Add `.nvmrc` or `.tool-versions` pinning Node 20.11 for fnm/nvm/asdf users to keep local dev matched with CI. | follow-up |
| W10 | Task 11 | `runtime = 'edge'` removed from `/lobby` due to Next 15.0.3 + React 19 RC RSC consumer-manifest bug under pnpm. `/api/auth/session-finalize` keeps `runtime = 'edge'` (route handlers don't hit the same RSC bug). Re-add on `/lobby` when Next ≥ 15.2 or React 19 stable lands. | Plan 09 hardening |
| W11 | Final review | `safe-area-inset` not honored in `app/globals.css`. Viewport meta has `viewportFit: 'cover'` but no chrome consumes `env(safe-area-inset-*)`. Add when first real layout chrome lands. | Plan 04 |
| W12 | Historical, superseded | The former plain-text PIN fallback was retired. The current verifier uses only the explicit KV record and fails closed when it is unavailable. | Resolved 2026-08-27 |
| W13 | Final review | `reactCompiler` disabled in `next.config.mjs` because `babel-plugin-react-compiler` isn't auto-installed in Next 15.0.3. Re-enable when the plugin is added as a devDep. | Plan 09 hardening |
| W14 | Task 11 / CI | Playwright "Full happy path" test skipped in CI — happy-path /lobby render after JWT cookie injection fails in CI but passes locally. Likely related to W10 (Next 15.0.3 + React 19 RC). Remove skip when /lobby is re-enabled with edge runtime + Next ≥ 15.2. | Plan 09 hardening |
| W15 | Deploy-staging failure | `opennextjs-cloudflare build` rejects positional argument in 0.5.7. Workflow currently has `pnpm exec opennextjs-cloudflare build && pnpm exec opennextjs-cloudflare deploy --env staging` — first command fails. Use `pnpm deploy:staging` (the package script) instead, OR drop the explicit `build` since `deploy` builds implicitly. ALSO requires: Pages project created in CF dashboard, DNS record for `staging.bid.mbfdhub.com`. | Plan 09 / Plan 12 follow-up |

---

## Plan 01 — COMPLETED 2026-05-18

- Merged to `main` as squash commit `c7835c0` via PR #3 (admin merge — solo dev).
- 20 commits across 13 tasks (TDD, subagent-driven, full spec + quality reviews per task).
- All 5 CI checks green: Lint + Typecheck · Unit + Integration · Playwright E2E · Analyze javascript-typescript · CodeQL.
- Deploy-staging triggered automatically on merge to `main` (cold first run; web Pages deploy may need DNS + OpenNext config refinement — tracked separately).

**Tests landed:**
- `@mbfd/shared`: 19
- `@mbfd/worker`: 19 (incl. 9 CORS hardening tests against subdomain smuggling)
- `@mbfd/web`: 3 unit + 12 E2E specs × 2 browsers (1 skipped in CI per W14)

**Plan 02 should pick up from:** `c7835c0` on `main`. Open watch-items W1-W6, W10, W11-W14 are tracked above.

---

## Plan 02 — Data plane

### Completed tasks (PR #5, branch `plan-02-data-plane`)

24 commits in dependency order: `92a600a` (W15 fix) → `1bc0ca2` → `649384a` → `c3906a4` (Task 2 quality-review fixes) → `9853a20` → `34fe55d` → `552a574` → `7e38020` → `6bbac27` → `aeb772a` (Task 7 regression fix) → `cdbc694` → `cc8d08e` → `95f098b` → `28d6bbe` → `72aeeba` → `5a1ed2f` → `0843841` → `f94c955` → `3b8d715` → `5e4a473` → `6f01458` → `98b70ee` → `efa47a1` → `290a80f` (Task 20 revision: admin account replaces allow-list).

| # | Task | Commit |
|---|------|--------|
| 1 | Drizzle + papaparse + ulid install | `1bc0ca2` |
| 2 | Mig 0002 (members, credentials, member_credentials) | `649384a` + `c3906a4` |
| 3 | Mig 0003 (positions, rules) | `9853a20` |
| 4 | Mig 0004 (bid_*, audit, AI, snapshots, writeback) | `34fe55d` |
| 5 | Migs applied to local + remote D1 staging | `552a574` |
| 6 | Shared Zod schemas for CSV/XLSX imports | `7e38020` |
| 7 | CSV parser (papaparse + per-row Zod) | `6bbac27` + `aeb772a` |
| 8 | XLSX cred parser (SheetJS, normalized + legacy wide-matrix) | `cdbc694` |
| 9 | requireAdmin JWT middleware | `cc8d08e` |
| 10 | Worker `/api/admin/members/*` | `95f098b` |
| 11 | Worker `/api/admin/credentials/*` | `28d6bbe` |
| 12 | Worker `/api/admin/positions/*` + `/api/admin/rules/*` | `72aeeba` |
| 13 | Flat audit_log writer + mig 0005 (bid_session_id nullable) | `5a1ed2f` |
| 14 | Seed 2026 (233 positions, 57 credentials, 232 rules — live on staging) | `0843841` |
| 15 | Typed Hono RPC client + server helper | `f94c955` |
| 16 | Web `/admin` layout + dashboard | `3b8d715` |
| 17 | Web `/admin/members` viewer + member detail | `5e4a473` |
| 18 | Web `/admin/positions` + `/admin/rules` viewers | `6f01458` |
| 19 | Web import upload UIs (members + credentials) | `98b70ee` |
| 20 | Local admin account (`admin` / bcrypt hash); allow-list approach reverted | `efa47a1` + `290a80f` |
| 21 | Branch + PR + STATUS update | (this commit) |

### New watch-items raised in Plan 02

| ID | Source | Watch-item | Action by |
|----|--------|------------|-----------|
| W15 | Plan 01 follow-through | `opennextjs-cloudflare 0.5.7` rejects positional `build` arg. CI now uses `pnpm deploy:staging`. Still requires Pages project + DNS + R2:Edit-scoped token before staging deploy succeeds end-to-end. | Plan 09 / blocked on token re-scope |
| W16 | Task 2 fix | `drizzle-kit` auto-journal can desync when migrations are renamed by hand to preserve numbering. `apps/worker/migrations/README.md` documents the convention. | Re-eval when drizzle-kit ≥ 0.30 lands native rename support |
| W17 | Task 13 | `audit_log.bid_session_id` was made nullable in mig 0005 to support pre-session admin actions (imports, position clones). | Plan 08 hash-chain implementation must handle nullable session scope |
| W18 | Task 15 | Hono RPC type inference broken by pnpm `node-linker=isolated`; `WorkerClient` typed as `hc<any>`. Drops compile-time route + payload checks on the web side. | Re-evaluate after Hono 4.7+ or switching to `node-linker=hoisted` |
| W19 | Task 20 | Local admin account (`username=admin`, password verified vs `LOCAL_ADMIN_PASSWORD_HASH` bcrypt secret) is rehearsal scaffolding. No per-actor traceability beyond audit_log timestamp — all admin actions look identical. | Plan 05 admin console must replace with portal-sourced per-user admin roles |
| W20 | Task 14 | 182 of 232 rule entries are placeholder `{ max: 0, items: [] }` — only the 50 specialty positions have hand-curated rules. General-population Combat positions still need points/criteria filled in. | Admin review before live bid; Plan 03 (eligibility engine) blocked on this |
| W21 | Plan 01 follow-through | Cloudflare API token in environment lacks `Pages:Edit`, `Zone:DNS:Edit`, `R2:Edit`. Cannot autonomously create Pages project, manage `staging.bid.mbfdhub.com` DNS, or pre-seed R2 buckets. | User action: regenerate CF token with those three scopes added |

### Plan 02 — COMPLETED 2026-05-18

- **Tests landed:** `@mbfd/shared` 55 · `@mbfd/worker` 100 (1 skipped golden) · `@mbfd/web` 6 unit + 12 E2E
- **Remote D1 staging:** schema migrations 0002–0005 applied; seeded with 233 positions / 57 credentials / 232 rules
- **Wrangler secrets set on staging:** `LOCAL_ADMIN_PASSWORD_HASH` (bcrypt of the shared admin password); `ADMIN_EMPLOYEE_IDS` set to empty string (deprecated path)
- **PR:** https://github.com/pdarleyjr/mbfd-bid/pull/5

**Plan 03 should pick up from:** the `plan-02-data-plane` branch HEAD `290a80f` once PR #5 merges. Open watch-items W15–W21 above; legacy W1–W14 still tracked above the line.

---

<!-- New tasks append below as they complete. -->

## Plan 05 — Admin console (COMPLETED 2026-05-19)

### Completed tasks

| # | Task | Commit |
|---|------|--------|
| 1 | Step-up auth middleware (5-min `fresh_auth_at` window) | `1d18213` |
| 2 | Reason-code enum (shared) + action validity map (worker) | `9a63398` |
| 3 | `rule_books.status` + `nextVersion`/`parseVersion` helpers (mig 0008) | `f29feae` |
| 4 | Zod schemas for admin actions, rule-book, audit query, eligibility preview | `8b0d0f8` |
| 5 | Streaming RFC-4180 CSV serializer | `01dfc0f` |
| 6 | `/api/admin/rule-books` list, create, publish (atomic swap) | `a380ea3` |
| 7 | Bid-session lifecycle (start, pause, resume, day-end, day-start, config) | `ce364c3` |
| 8 | `/api/admin/bid-session/:id/force-pick` (eligibility bypass + audit) | `7986065` |
| 9 | `/api/admin/bid-session/:id/skip` (audit-only, no bid row) | `289cfd6` |
| 10 | `/api/admin/bid-session/:id/bid-for-member` (eligibility enforced) | `b7cd082` |
| 11 | `/api/admin/bid-session/:id/lock-position` (config-phase only) + mig 0009 | `e5da2f9` |
| 12 | `GET /api/admin/audit` (paginated, filtered) | `4e933c0` |
| 13 | `GET /api/admin/audit/export` (streamed CSV) | `c5213b3` |
| 14 | `POST /api/admin/eligibility/preview` | `925ab66` |
| 15 | `GET /api/admin/placements/export` (streamed CSV by session) + closure narrowing fix | `6a4f697` |
| 16 | `PATCH /api/admin/members/:id` (rank, category, seniority, creds) | `dbfc794` |
| 17 | `PATCH /api/admin/rules/:id` (step-up, drafts-only, audited) | `3c970a2` |
| 18 | Web: draft-storage + et-time utility modules | `7a6ae65` |
| 19 | Web: admin sidebar + dashboard links + Plan 05 stub pages | `1a48ffd` / `b2de473` |
| 20 | Web: `/admin/members/:id/edit` (form + draft autosave + PATCH) | `f25dcdf` |
| 21 | Web: `/admin/rule-books` list + detail + publish flow | `26cb3e4` |
| 22-24 | Web: bid-session console + audit log viewer + eligibility preview pages | `bca04b8` |
| 25 | Web: `/admin/positions/:id/edit` (rule editor + step-up handling) | `9155e66` |
| 26-27 | Web: session detail page + ForcePickSheet; E2E placeholders | `e46107b` |
| 28 | Verification + STATUS update | (this commit) |

### Deviations

- **Migration numbering:** Plan 05 body called for `0006_rule_book_status.sql` (Task 3) and `0008_bid_session_config.sql` (Task 11), but `0006` and `0007` were already taken by Plan 04. Reassigned to `0008_rule_book_status.sql` and `0009_bid_session_config.sql`. The plan briefing explicitly flagged this collision.
- **`bid_sessions` timestamp columns:** the Drizzle schema used `mode: 'timestamp'` (seconds) but the Plan 05 tests + new endpoints all use `Date.now()` (ms). Switched `startedAt / pausedAt / completedAt / currentTurnStartedAt / scheduledResumeAt / frozenAt` to `timestamp_ms` mode. Underlying SQLite columns unchanged (still INTEGER).
- **`evaluateEligibility` signature:** plan body called it as `(member, position, rule)`, but the actual `@mbfd/eligibility` API is `(member, rule)`. Adjusted Task 10 + Task 14 impls.
- **Test harness for D1:** added `apps/worker/tests/integration/helpers/test-d1.ts` — a better-sqlite3 adapter with FK pragma OFF (matches D1 default + lets the synthetic admin `sub: 0` `adminActorId` insert without seeding a sentinel members row). Comment lines in migration SQL are stripped before splitting on `;` so the multi-line `ALTER TABLE ... CHECK (...)` statement in mig 0008 is preserved across the parser.
- **Hono RPC client typing:** `rpc.api.admin.rule-books.$get()` etc. don't type-resolve because the web app's `hc<any>` doesn't carry the worker `AppType`. All Plan 05 server-component pages use raw `fetch(baseUrl + '/api/admin/...')` instead. Tracked against existing W18.
- **`react-hook-form` not added:** Task 20 spec called for `react-hook-form + @hookform/resolvers + zod` but those deps weren't already in `apps/web`. Implemented the form with native React `useState` + a debounced `useEffect` autosave to keep the dependency surface flat. Behavior matches the spec (autosave on change, restore banner on mount, PATCH on submit).
- **Next 15 typed routes:** new stub routes (`rule-books`, `sessions/new`, `audit`, `eligibility`) don't yet appear in `.next/types/...`. NAV_LINKS / QUICK_LINKS arrays in `AdminShell.tsx` and `app/admin/page.tsx` were retyped to `string` + cast to `Route` at the `<Link>` call site. Regenerate types via `next build` post-merge to restore strict typing.
- **Biome a11y rules:** `<dialog open>` used instead of `<div role="dialog">` (PublishButton, ForcePickSheet) per `useSemanticElements`; `<output>` used in place of `<div role="status">` per the same lint rule.
- **`jsdom` dependency added:** `apps/web` now depends on `jsdom` as a devDep so the draft-storage unit tests can drive `window.localStorage`. Pulled in via `pnpm --filter @mbfd/web add -D jsdom`.
- **E2E specs are placeholders (Tasks 26 + 27):** the plan body's E2E specs import from `./fixtures` (`loginAsAdmin`, `seedMember`, `seedBidSession`, `ensureBidYear`, `seedRuleBook`), none of which exist in this repo — existing E2E specs use `page.route()` mocking instead. The two new spec files are committed with a single `test.skip` per file and inline comments describing the intent, so a future hardening plan can flesh them out without losing the original requirements.

### Notes for Plan 06+

- `bid_sessions.config_json.position_locks` is written by `/lock-position` but no worker code consumes the array yet. Plan 04 must include an `applyLocksBeforeBid()` step in the bid-order generator.
- AI dissent log: `audit_log.ai_advisory_id` is `null` for every Plan 05 admin action. Plan 06 should retrofit a side-channel that links the dissent advisory to the audit entry after the fact (open question #1 in the plan).
- Idempotency-Key TTL: `bids.idempotency_key UNIQUE` has no expiry, so a retry days later would return a stale bid id. Plan 04 should add a TTL or per-session scoping.
- Dual-chief approval mode (spec D2): force-pick and rule-book publish are single-admin today. When chiefs enable D2, both endpoints will need a second-admin confirm token within 60s. Tracked as `plan-05-followup-dual-chief`.
- Day-end UI input: `SessionControls.tsx` posts to `/day-end` only via the dedicated form on the Task 22 page, not from the session detail panel. A `DayEndSheet` sibling of `ForcePickSheet` would close that gap.

### New watch-items

| ID | Source | Watch-item | Action by |
|----|--------|------------|-----------|
| W22 | Plan 05 T3, T11 | Migration numbers `0006` (rule_book_status) and `0008` (bid_session_config) in plan body collided with Plan 04. Both were renumbered (0008, 0009 respectively). Future plans must read `apps/worker/migrations/` before assigning numbers. | Plan 06 author |
| W23 | Plan 05 T7 | Switched `bid_sessions` timestamp columns from `timestamp` (seconds) to `timestamp_ms` (ms) to match `Date.now()` writes. Existing Plan 04 code reading these columns must be re-checked — any place that did `new Date(row.pausedAt)` previously got a Date from seconds; now it gets one from ms. | Plan 04 reviewer + Plan 06 |
| W24 | Plan 05 T20 | Member edit form skipped `react-hook-form`. If form validation grows beyond rank/category/seniority, swap to a real form library to avoid hand-rolled validation drift. | Plan 09 hardening |
| W25 | Plan 05 T19 | `AdminShell.tsx` NAV_LINKS and `app/admin/page.tsx` QUICK_LINKS cast new hrefs to `Route`. Once `next build` regenerates `.next/types/...`, restore `as const` typing on those entries. | Post-merge cleanup |
| W26 | Plan 05 T26, T27 | E2E specs `admin-bid-day-cycle.spec.ts` and `admin-force-pick-flow.spec.ts` are `test.skip` placeholders pending a real Playwright fixtures harness (`loginAsAdmin`, `seed*`). | Plan 09 hardening |

### Plan 05 — final tallies (2026-05-19)

- **Tests landed:** `@mbfd/worker` 43 files / 243 pass + 1 skip · `@mbfd/shared` 11 files / 100 pass · `@mbfd/web` 5 files / 21 pass · `@mbfd/eligibility` 13 files / 81 pass + 3 skip
- **Migrations applied locally:** `0008_rule_book_status.sql`, `0009_bid_session_config.sql`. Remote D1 not deployed in this work (per briefing: staging-only, not part of this scope).
- **Lint:** 0 errors, 3 pre-existing warnings (all `console.log` in `scripts/copy-staging-fixtures.mjs`)
- **Typecheck:** all 4 workspace packages green

## Plan 06 — AI Integration (retired 2026-08-04)

The AI advisor was fully removed from the active application after a legacy
Workers AI forecast cron generated unexpected neuron charges while the staging
site was idle. The retirement release removes the model binding, dedicated KV
binding, per-minute schedule, AI API routes, member/admin UI, rehearsal AI
strategy, prompt/evaluation code, cost polling, and advisory table. Migration
`0019_remove_ai_feature.sql` deletes the obsolete advisory rows. Historical
audit-log compatibility fields remain so existing signed audit records can
still be read; they cannot trigger inference.

---

## Plan 08 — Audit chain, exports, portal write-back — COMPLETED 2026-05-19

**Sub-systems shipped:**

- **A. R2 JSONL hash-chained audit log** with ed25519 signatures. Tamper detection verified by a 20-run random-byte mutation integration test plus truncation + middle-chunk deletion cases (`apps/worker/tests/integration/audit-tamper.test.ts`). 250-event replay performance test (`audit-replay-250.test.ts`) confirms verify completes in <1s and produces exactly 3 chunks (100+100+50).
- **B. Roster PDF (Cloudflare Browser Rendering, post-2026-05 swap) + audit CSV (papaparse + pako gzip)** exports stored in R2, accessible via AWS SigV4 signed URLs. Admin trigger + list endpoints under `/api/admin/exports/*`; print-token HMAC verifies on the web RSC side before the headless browser renders the page. (Originally shipped on the Browserless v2 HTTP API; swapped to the first-party `env.BROWSER` binding + `@cloudflare/puppeteer` once the project moved to the Workers Paid plan — no external token required.)
- **C. Cloudflare Queues portal write-back** with integer-safe 24-attempt / 24-hour exp-backoff retry; manual retry + portal-clear-year admin endpoints; daily reconciliation cron at 04:15 UTC.

### Final test counts (2026-05-19)

- `@mbfd/worker`: 89 files / 478 pass + 1 skip
- `@mbfd/shared`: 16 files / 123 pass
- `@mbfd/web`: 7 files / 38 pass
- `@mbfd/a-day`: 7 files / 62 pass

### New worker files

- `src/audit/{canonical-json,hash-chain,signer,types,jsonl-chunker,chain-emitter,chain-db-d1,verifier}.ts`
- `src/exports/{print-token,roster-pdf,audit-csv,audit-csv-db,signed-url}.ts`
- `src/portal-writeback/{payload-builder,retry-policy,portal-client,queue-producer,queue-consumer,queue-handler,reconciliation}.ts`
- `src/routes/admin/{exports,portal}.ts`
- `src/types/env.d.ts` extended with R2_AUDIT, R2_EXPORTS, PORTAL_QUEUE, AUDIT_SIGNING_*, PRINT_TOKEN_SECRET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, WEB_BASE_URL, BROWSER (Browser Rendering binding). BROWSERLESS_TOKEN is now optional + deprecated; retained for one release for backwards compat.

### New shared files

- `packages/shared/src/schemas/{audit-event,audit-chunk,portal-payload}.ts`
- `AUDIT_UNAVAILABLE` added to `PICK_REJECT_CODES` (§D10 enforcement)

### New web files

- `apps/web/app/admin/exports/render/roster/[shift]/[session_id]/{page,loading}.tsx` + `print.css`
- `apps/web/app/admin/exports/{page.tsx,_components/{ExportCard,ExportTriggerButton,PortalSyncStatus,ManualRetryButton}.tsx}`
- `apps/web/lib/print-token.ts`

### Migration

- `0013_audit_chain_bookkeeping.sql` (renumbered from the plan body's "0006" because 0006–0012 were already claimed by Plans 04–07). Adds `audit_chunks`, `audit_chain_state` tables and `audit_log.chunk_seq`, `audit_log.chunk_row_index` columns. The hardcoded migration lists in `audit.test.ts`, `admin-{members,positions,credentials,rules}.test.ts`, and `seed.test.ts` were extended to include 0013.

### Deviations from the plan

1. **Migration numbering** — the plan body said "0006_audit_chain"; renumbered to `0013_audit_chain_bookkeeping` per the explicit subagent constraint and the existing journal at 0012.
2. **Per-DO emitter** — the plan envisioned a Worker-level singleton `ChainEmitter` reachable from the `scheduled` handler's `flushStale()`. Implemented as per-DO instead (lazy in `BidSessionDO`) because Cloudflare DOs cannot be passed non-serializable handles from the Worker context. The 30-second cron flushStale path is effectively a no-op in this design; the 100-event threshold flush still fires synchronously from the DO. **W34 below.**
3. **§D10 strict variant scope** — the plan body's `emit()` call inside `.commit()` was generic; this implementation makes the strict variant (`emitPickToChain`) call out BEFORE state persists, with `pick_rejected/AUDIT_UNAVAILABLE` as the WS message on R2 failure. Force-pick uses the same strict path. Non-pick audits (skip, freeze) remain best-effort.
4. **Integration tests downscoped** — Task 11 (tamper), Task 23 (5xx/4xx), and Task 24 (admin retry) are exercised via in-process state-machine drivers rather than `unstable_dev` + Miniflare + test-only routes. The latter were out-of-scope for a single-session subagent run. All branches of the consumer state machine are covered.
5. **Web roster RSC fetch path** — the plan uses `workerRpc.exports.rosterData.$get(...)`; this implementation does a direct REST fetch since the corresponding worker endpoint (`/api/admin/exports/roster-data`) wasn't part of Task 14/17 and would need its own task. **W35 below.**
6. **Audit CSV signed-URL fallback** — when `R2_ACCESS_KEY_ID` et al. are absent, `signUrl` returns an `r2://bucket/key` placeholder rather than a presigned HTTPS URL. The handler logs a 503 from the dedicated `/url` GET endpoint instead. Plan 09 sets these secrets at deploy time.
7. **Playwright visual baseline** — `2025_A_Shift.pdf` visual baseline was not captured (no headless Chromium available in the subagent sandbox). The print stylesheet + RSC page are in place; the snapshot test will be added when staging is up. **W37 below.**
8. **`pnpm db:generate`** — hand-wrote `0013_audit_chain_bookkeeping.sql` per the explicit "drizzle-kit auto-gen is unsafe" constraint. `meta/` untouched.

### Cloudflare config items requiring Plan 09 deploy

| Type | Name | Where |
|---|---|---|
| R2 bucket | `mbfd-bid-audit-staging` / `mbfd-bid-audit-production` | `wrangler r2 bucket create` |
| R2 bucket | `mbfd-bid-exports-staging` / `mbfd-bid-exports-production` | `wrangler r2 bucket create` |
| Queue | `mbfd-portal-writebacks-staging` / `-production` + DLQ pair | `wrangler queues create` |
| Cron | `*/1 * * * *` (audit buffer flush) and `15 4 * * *` (portal reconciliation) | already in `wrangler.toml` |
| Secret | `AUDIT_SIGNING_PRIVKEY` + `AUDIT_SIGNING_PUBKEY` (ed25519, per env, per year) | `wrangler secret put` |
| ~~Secret~~ | ~~`BROWSERLESS_TOKEN`~~ — **DEPRECATED 2026-05-20**: replaced by the first-party Cloudflare Browser Rendering binding `[browser] / BROWSER`. Safe to `wrangler secret delete` after the next staging + production deploy. | n/a |
| Binding | `[browser] binding = "BROWSER"` — Cloudflare Browser Rendering, included on the Workers Paid plan. No token required. | `wrangler.toml` |
| Secret | `PRINT_TOKEN_SECRET` (HMAC for print-token authorized roster render URLs; falls back to JWT_SIGNING_KEY) | `wrangler secret put` |
| Secret | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` (for SigV4 download URLs) | `wrangler secret put` |
| Secret | `PORTAL_BID_WRITER` (bearer token for /bid-assignment POSTs) | `wrangler secret put` |
| Env var | `WEB_BASE_URL` (Browser Rendering target; staging vs production) | `wrangler.toml` `vars` |
| Migration | `pnpm db:migrate:remote` for both environments | Plan 09 deploy |

### New deps

- `@noble/hashes@^1.4` (worker + web) — SHA-256 + HMAC, Worker-safe pure-JS.
- `@noble/ed25519@^2.1` (worker) — chunk signature.
- `pako@^2.1` (worker) + `@types/pako@^2` (worker dev) — gzip in Worker (no Node `zlib`).

No new peer-dep warnings beyond the pre-existing Anthropic SDK / zod mismatch (W31) and the Wrangler 4.92 / workers-types pin in `apps/web`.

### New watch-items (Plan 08)

| ID | Source | Watch-item | Action by |
|----|--------|------------|-----------|
| W34 | Plan 08 deviation 2 | The 30-second cron flush of stale audit buffers is effectively a no-op because the ChainEmitter is per-DO (held in `BidSessionDO` memory) and the cron runs in the Worker-level isolate. For idle-but-active sessions the 30s flush guarantee is currently weaker than the spec's §D1. Options: (a) move flush trigger inside the DO via `state.setAlarm()`, (b) flush opportunistically on any incoming WS message. Recommend (a). | Plan 09 hardening |
| W35 | Plan 08 deviation 5 | `/api/admin/exports/roster-data?session_id&shift&token` endpoint is referenced by the web RSC roster render page but not yet implemented. Currently the RSC will 404 when the headless browser renders. Add the worker route that joins `bids` + `members` + `positions` for the shift and returns the roster JSON shape the RSC consumes. | Plan 09 deploy |
| W36 | Plan 08 §D10 enforcement | DO unit test for `pick_rejected/AUDIT_UNAVAILABLE` not added (would require constructing a DurableObjectState in tests). Smoke test in Plan 09 staging deploy must explicitly: kill R2 binding, attempt a pick, verify the WS client receives `pick_rejected` with code `AUDIT_UNAVAILABLE`. | Plan 09 rehearsal |
| W37 | Plan 08 Task 13 | Playwright visual snapshot baseline `roster-a-2025.png` not captured (no headless Chromium available). When staging is up, run `pnpm --filter @mbfd/web e2e --update-snapshots admin-export-roster-visual` and commit the new snapshot under `apps/web/tests/e2e/__snapshots__/`. | Plan 09 hardening |
| W38 | Plan 08 Task 25 | `handlePortalReconciliation.reEnqueue` derives `employeeId` from the persisted `payload.idempotency_key` by splitting on `_` and taking the last segment. This works for the current `bid_<session>_<member>_<position>` ID shape but is fragile. Add a `payload.employee_id` mirror field or look up via `bids.member_id → members.employee_id`. | Plan 09 hardening |
| W39 | Plan 08 Task 9 | Existing audit-pipe `writeAudit` now also calls `emitDraftToChain` best-effort for non-pick events. The emit failure is swallowed (logged) but if the chain becomes the legal record for non-pick audits too (e.g., skip/freeze/dissent), §D10 strictness should be expanded. Currently only `pick` + `forced_pick` are strict. | Plan 09 / spec clarification |
| W40 | Plan 08 deviation 4 | The Cloudflare Queue consumer happy path is tested via direct invocation; the real `queue.send → consumer.queue → message.ack/retry` cycle isn't exercised under Miniflare. Plan 09 must run a smoke test that drops a real message into the staging queue and verifies the bid row transitions. | Plan 09 rehearsal |
| W41 | Plan 08 Task 17 | `/api/admin/exports/audit-csv` returns 500 on D1 errors; the plan envisioned 502 for portal-style upstream failures. Behavior is fine but inconsistent with the roster route (502 on Browser Rendering failures). Normalize. | Follow-up cleanup |

---

## Rehearsal tooling (Plan 09 prequel) — 2026-05-19

Eleven-task burst (R1–R11) landing a complete mock-draft rehearsal flow on
`staging.bid.mbfdhub.com` so the admin can validate the system end-to-end
BEFORE Plan 09's prod cutover. Plan 09 itself stays scoped to the cutover;
this prequel is the safety harness that runs on staging.

### Endpoints landed

| Method + Path | Auth | Purpose |
|---|---|---|
| `POST /api/admin/rehearsal/:sessionId/mark-mock` | admin | Idempotently set `bid_sessions.is_mock=1`. 404 if session missing. |
| `POST /api/admin/rehearsal/:sessionId/reset-mock` | admin | Temporarily fail-closed: no rows or DO state are changed until a serialized, audited reset epoch exists. 403 unless `is_mock=1`; otherwise returns 409 `canonical_reset_requires_new_epoch`. |
| `POST /api/admin/rehearsal/:sessionId/auto-bid` | admin | Body `{ count, strategy: 'first_eligible' }`. Loops up to `count` deterministic picks; stops on `complete`, 5 consecutive `no_eligible`, or count exhaustion. Returns 200 with `{ picksMade, stoppedReason, detail? }`. 207 if `no_eligible` after some picks. 403 unless `is_mock=1`. |
| `POST /api/admin/rehearsal/findings` | admin | Body `{ bidSessionId, note, screenshotR2Key? }`. Inserts one row. 201 on success. 404 if session missing. |
| `GET  /api/admin/rehearsal/findings?session_id=…&limit=50` | admin | Per-session findings, newest-first. 400 if no `session_id`. |
| `GET  /api/admin/rehearsal/findings-recent?limit=50` | admin | All findings across mock sessions, newest-first. |
| `GET  /api/admin/rehearsal/sessions` | admin | List of mock sessions for the dashboard. |

### MockBanner contract

`apps/web/app/_components/MockBanner.tsx` is a Server Component:
- `MockBanner({ isMock: true, sessionId })` → sticky red banner across the top
  reading `MOCK SESSION — NOT LIVE — picks will not be exported to portal`
  with the session id pinned on the right.
- `MockBanner({ isMock: false, sessionId })` → returns `null` (no DOM).

Wired into `/bid` and `/admin/bid` pages, reading `is_mock` from the
`/api/board` response (which now joins `bid_sessions` to surface the flag).

### Portal write-back guard (Task R8)

`handlePortalQueueBatch` in `apps/worker/src/portal-writeback/queue-handler.ts`
now consults D1 at the top of every message. If the bid's session has
`is_mock=1`, the message is `ack()`'d without calling the portal HTTP
client. A missing bid row is also acked (treated as mock) so the queue
can't loop forever after a `reset-mock`. Defence-in-depth: the producer
should also skip mock sessions, but the consumer enforces it
unconditionally.

### Cutover safety check Plan 09 MUST add

Before promoting staging → production, Plan 09's deploy script needs to
refuse to cut over if any session row is BOTH `is_mock=1` and not
terminal. The simplest SQL form, runnable via `pnpm db:exec`:

```sql
SELECT id, current_phase, started_at
FROM bid_sessions
WHERE is_mock = 1
  AND current_phase NOT IN ('complete', 'archived');
```

If this returns any rows the deploy must abort — either complete or
archive the rehearsal first (audit chain stays intact regardless). The
production environment should also have a Worker-side guard that fails
the readiness probe when this query is non-empty.

### How to run a full rehearsal flow

1. As admin, create a normal bid session via `POST /api/admin/bid-session`.
2. Mark it mock: `POST /api/admin/rehearsal/<id>/mark-mock`.
3. Open `/admin/bid?session=<id>` — the red MockBanner appears across the top.
4. Start the session (`POST /api/admin/bid-session/<id>/start`).
5. From `/admin/rehearsal`, click **Auto-bid 10 picks (first-eligible)** or
   **Auto-bid 10 picks (AI)** to drive picks. The dashboard shows AI
   cost per session in the rightmost column.
6. Hit **Verify Audit Chain** — confirms the chain is intact across all
   picks made during the rehearsal.
7. Capture observations via **Submit Finding** (right rail) — text + an
   optional R2 key of a screenshot uploaded out-of-band.
8. **Reset** is unavailable until a serialized, audited reset epoch is
   implemented. Start a new mock session to rehearse again; do not expect any
   existing rehearsal data to be deleted.
9. When satisfied, complete or archive the session so the Plan 09 cutover
   check (above) does not block the deploy.

### Migrations

- `0014_is_mock_column.sql` — `ALTER TABLE bid_sessions ADD COLUMN is_mock integer NOT NULL DEFAULT 0;`
- `0015_rehearsal_findings.sql` — new `rehearsal_findings` table + index, FKs to `bid_sessions(ON DELETE CASCADE)` and `members(ON DELETE SET NULL)`.

Run on staging before deploying the rehearsal burst:
`pnpm --filter @mbfd/worker db:migrate:remote --env staging`.

### Verification snapshot at the end of the burst

- `@mbfd/worker`: 97 test files, 501 tests + 1 skip — all green.
- `@mbfd/web`: 9 test files, 43 tests — all green.
- `pnpm lint` — exit 0 (7 pre-existing eligibility-script `noConsole` warnings).

### New watch-items (Rehearsal burst)

| ID | Source | Watch-item | Action by |
|----|--------|------------|-----------|
| W43 | Task R4 | Reset-mock is intentionally disabled until a serialized, audited reset epoch can prevent a destructive race with canonical commands. | Plan 09 rehearsal |
| W44 | Task R5 | The auto-bid endpoint inserts bids directly into D1 (mirroring `bid-for-member`) rather than going through the BidSession DO. That keeps the rehearsal loop testable, but the DO's in-memory `fills` map and the D1 `bids` table will drift during a rehearsal. Reset-mock is intentionally unavailable until an audited reset epoch exists, so Plan 09 should validate this with a real WS-connected admin browser and treat a new mock session as the safe retry path. | Plan 09 rehearsal |
| W45 | Task R8 | The portal write-back guard re-queries D1 per message. For batches of 100 messages this is 100 D1 reads. If batches grow, batch the `is_mock` lookup with `IN (...)`. | Follow-up cleanup |
| W47 | Task R7 | MockBanner reads `is_mock` from `/api/board`, which is the DO snapshot enriched with one D1 query. For sessions that don't yet have a DO instance (mark-mock before start), the snapshot fetch may 404 — the banner falls back to `isMock=false`. Symptom: the banner doesn't appear until after `/start`. Either always-read D1 for `is_mock` OR have `mark-mock` initialise the DO. Recommend the former. | Plan 09 hardening |
