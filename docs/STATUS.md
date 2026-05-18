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
| W14 | Task 11 / CI | Playwright "Full happy path" test skipped in CI — happy-path /lobby render after JWT cookie injection fails in CI but passes locally. Likely related to W10 (Next 15.0.3 + React 19 RC). Remove skip when /lobby is re-enabled with edge runtime + Next ≥ 15.2. | Plan 09 hardening |

---

<!-- New tasks append below as they complete. -->
