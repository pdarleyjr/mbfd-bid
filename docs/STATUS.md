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

<!-- New tasks append below as they complete. -->
