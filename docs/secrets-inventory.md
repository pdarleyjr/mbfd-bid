# Secrets inventory — staging → production

Updated: 2026-05-19 (Plan 09 Phase A — Task 5).

Source-of-truth list of every secret bound to the Worker + Pages surfaces
and whether the value is reused or rotated for production. **No raw secret
values are stored in this file.** All values are generated outside the repo
(see § D5 in Plan 09's decisions preamble) and set via
`wrangler secret put` / `wrangler pages secret put` over stdin.

## Worker secrets (`apps/worker`)

| Secret name | Staging set? | Prod requires fresh value? | Source / generator |
|---|---|---|---|
| `JWT_SIGNING_KEY` | yes | **YES** | `openssl rand -base64 32` — different key per environment |
| `PORTAL_BID_FEDERATION_TOKEN` | yes | **YES** | Hub federation service token for exchange and revalidation |
| `PORTAL_BID_READER` | optional | **YES when portal bridge is enabled** | read-only Hub-to-Bid bridge credential; never a human-login or federation credential |
| `PORTAL_BID_WRITER` | **no — must remain absent** | separate future authorization | portal write capability is intentionally disabled in staging |
| `AUDIT_SIGNING_PRIVKEY` | yes | **YES** | `openssl genpkey -algorithm Ed25519` — per-year / per-env |
| `AUDIT_SIGNING_PUBKEY` | yes (vars) | **YES** | derived from new privkey; non-secret, set as `vars` |
| `ANTHROPIC_API_KEY` | yes | NO (same key, separate AI Gateway env) | reused — Cloudflare AI Gateway namespaces traffic per env |
| ~~`BROWSERLESS_TOKEN`~~ | ~~yes~~ | **DEPRECATED 2026-05-20** | Replaced by Cloudflare Browser Rendering (`[browser] / BROWSER` wrangler binding). Workers Paid plan includes Browser Rendering — no token required. Existing staging secret can be `wrangler secret delete`d after the next deploy. |
| `PRINT_TOKEN_SECRET` | optional | **YES** | `openssl rand -base64 32` if set explicitly; otherwise falls back to `JWT_SIGNING_KEY` (also rotated) |
| `R2_ACCESS_KEY_ID` | yes | **YES** | new R2 API token scoped to `mbfd-bid-exports-production` |
| `R2_SECRET_ACCESS_KEY` | yes | **YES** | paired secret for the new R2 token |
| `R2_ACCOUNT_ID` | yes (vars) | NO | same CF account — non-secret, set as `vars` |
| `R2_EXPORTS_BUCKET_NAME` | yes (vars) | NO (different name per env) | derived per env in `apps/worker/src/routes/admin/exports.ts` |
| `WEB_BASE_URL` | yes (vars) | NO (different per env) | `https://bid.mbfdhub.com` vs `https://staging.bid.mbfdhub.com` |

## Pages secrets (`apps/web` — set on the Pages project `mbfd-bid-web-prod`)

| Secret name | Surface | Staging set? | Prod requires fresh value? | Source |
|---|---|---|---|---|
| `NEXT_PUBLIC_WORKER_BASE` | env var (not secret) | `https://api.staging.bid.mbfdhub.com` | `https://api.bid.mbfdhub.com` | static |
| `PRINT_TOKEN_SECRET` | secret (verifies print tokens server-side) | yes | **YES** — must match the worker's value | rotate together with the worker secret |

> **Pages secret deploy lag (Plan 09 § D6):** `wrangler pages secret put` does
> NOT push to the running deployment. Every prod Pages secret rotation MUST
> be followed by a `wrangler pages deploy --project-name=mbfd-bid-web-prod`
> in the same task to pick up the new value.

## Generator dry-runs (sanity check the toolchain — no values saved)

```powershell
# Random 32-byte base64 (JWT_SIGNING_KEY, PRINT_TOKEN_SECRET):
openssl rand -base64 32 | Out-Null

# Ed25519 keypair (AUDIT_SIGNING_PRIVKEY / _PUBKEY):
openssl genpkey -algorithm Ed25519 -out $env:TEMP\dryrun.pem
openssl pkey -in $env:TEMP\dryrun.pem -pubout -out $env:TEMP\dryrun.pub.pem
Remove-Item $env:TEMP\dryrun.pem, $env:TEMP\dryrun.pub.pem

```

> Both commands succeed on a clean Node 22 + OpenSSL 3.x box. Confirmed
> 2026-05-19 on the dev machine.

## Pre-cutover checklist

Run these checks before any prod-deployment task in Plan 09 Phase B:

1. **Confirm staging is healthy** — visit `https://staging.bid.mbfdhub.com`
   + run a smoke pick. Staging stays alive throughout the cutover (D1).
2. **Generate every "Prod requires fresh value? YES" secret** in a
   `mkdtemp` directory outside the repo, set via `wrangler secret put NAME
   --env production` over stdin, delete the temp file in the same line.
3. **Set the matching Pages secret** via
   `wrangler pages secret put NAME --project-name=mbfd-bid-web-prod`, then
   immediately `wrangler pages deploy --project-name=mbfd-bid-web-prod`.
4. **Verify** each prod value is non-empty + DIFFERENT from staging via:
   ```powershell
   wrangler secret list --env production
   wrangler pages secret list --project-name=mbfd-bid-web-prod
   ```
5. **Document** the rotation in `docs/post-cutover-monitoring.md` (audit log
   for the operations chief).

## Post-event rotation (D3 cadence)

Within 7 days of A-Day completion, rotate the following secrets again:

- `JWT_SIGNING_KEY`
- `AUDIT_SIGNING_PRIVKEY` (start a new chain; archive the 2026 chunks)
- `PRINT_TOKEN_SECRET`

Other secrets (portal tokens, R2 tokens) are rotated on the portal team's
schedule and only need an emergency rotation on suspected compromise.
