# MBFD Bid v2 baseline

**Captured:** 2026-08-26
**Scope:** Read-only local, GitHub, Cloudflare, and GMKtec discovery before Bid v2 changes.

## Starting point

- Local starting commit: `beed7412f608306ff411b7a9a603bc3b8d75cdb3`.
- Working tree was clean on `main`; implementation now uses local branch `feat/mbfd-bid-v2`.
- The baseline repository is a pnpm monorepo containing a Next.js web app, a Hono/Cloudflare Worker, and shared, eligibility, and A-Day packages.
- The active source has retired the former Workers AI feature. Reintroduction is neither implied nor authorized by this baseline.

## Local quality baseline

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Locked install | PASS | `pnpm install --frozen-lockfile` reported an up-to-date lockfile. |
| Lint | PASS | Current branch: `pnpm lint` checked 451 files with no fixes. |
| Typecheck | PASS | Current branch: `pnpm typecheck` passed for all five packages. |
| Unit/integration suite | PASS (local) | The first root run timed out in 5 Worker launcher files. The suite now runs standard Worker tests separately from the five serial launcher tests; the current `pnpm test` passed 152 files, 878 tests, with 4 intentional opt-in skips. CI evidence is still unobserved. See [05-test-matrix.md](05-test-matrix.md). |
| Build | PASS (local) | Current branch: `pnpm build` succeeded. Next emitted an informational Edge Runtime/static-generation warning. |
| Browser/E2E | NOT YET ACCEPTED | Existing E2E selectors are stale and the workflow is manual-only. |

## GitHub baseline

- The repository was observed public during discovery and was changed to **private** at 2026-08-26T11:37:21Z, then independently verified.
- `main` is the default branch. It has protections, but administrators may bypass them (`enforce_admins=false` at audit time).
- 29 pull requests were open at audit time.
- All 393 completed D1-backup workflow runs observed through 2026-08-26 had failed before the export/upload step because the Ubuntu runner had no `TEMP` value. No Actions-produced D1/R2 snapshot is proven usable.
- The scheduled dependency-audit workflow also fails on current advisories; do not infer that automation makes this acceptable.
- Code scanning and Dependabot findings were present. Their exact current counts must be re-queried before a release.

## Cloudflare baseline

- Authenticated read-only inspection found a Bid Worker, one related Pages project, and dedicated-looking D1, Durable Object, KV, Queue, R2, and Browser Rendering bindings.
- Worker binding details include secrets and are intentionally not recorded here.
- The staging Worker health endpoint and staging web origin returned HTTP 200 during passive checks. The intended production API/web hostnames did not resolve in the same check.
- Custom-domain/DNS and ownership evidence therefore remain incomplete. No routing change is authorized until the discrepancy is reconciled.
- No Cloudflare resource was mutated during this baseline.

## Server and Media Control baseline

- GMKtec was reachable read-only. It hosts many active Compose projects; Bid must not assume host exclusivity.
- Media Control's own Compose project and container were active. The container health check was `healthy`, it was running, and its existing version endpoint returned HTTP 200.
- The unverified `/api/health` candidate returned 404; it is not used as a health gate.
- No server, Docker, tunnel, DNS, GPU, or Media Control resource was changed.

## Immediate gates

1. Resolve the documented policy/fixture conflicts before using fixture rules as live policy.
2. Obtain CI evidence for the now-explicit Worker launcher-test isolation before accepting it as a release gate.
3. Prove an authorized staging D1 backup and disposable restore, then reconcile remaining dependency/code-security findings before staging or production work.
4. Complete a Cloudflare resource ownership map before any cloud mutation.
5. Keep all future host work isolated and require a Media Control pre/post check when it could share infrastructure.
