# Plan execution status + watch-items

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
| W12 | Final review | `/api/pin` accepts `PIN_PLAIN` plain-text fallback (`process.env.PIN_PLAIN ?? '2300'`). Swap to bcrypt verify against `PIN_HASH` + add rate-limiting (per-IP + per-cookie). | Plan 09 hardening |
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
