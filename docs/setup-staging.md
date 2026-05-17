# Staging Cloudflare Resources — One-Time Setup

> Provisioned 2026-05-17. Values below are the resource IDs to paste into
> `apps/worker/wrangler.toml` when Plan 01 Task 4 builds the worker.

## Account

| | |
|---|---|
| Account name | `Pdarleyjr@gmail.com's Account` |
| Account ID | `265122b6d6f29457b0ca950c55f3ac6e` |
| Email | `pdarleyjr@gmail.com` |

## D1

| | |
|---|---|
| Database name | `mbfd-bid-staging` |
| Database ID | `6dd16e65-5cb6-4c19-aff2-ec2706e72d50` |
| Region | ENAM |
| Wrangler binding | `DB` |

`wrangler.toml` snippet:
```toml
[[env.staging.d1_databases]]
binding = "DB"
database_name = "mbfd-bid-staging"
database_id = "6dd16e65-5cb6-4c19-aff2-ec2706e72d50"
migrations_dir = "./migrations"
```

## KV

| | |
|---|---|
| Namespace name | `mbfd-bid-kv` |
| Namespace ID | `ce8afe4605464683a51bf6ae9c042c01` |
| Wrangler binding | `KV` |

`wrangler.toml` snippet:
```toml
[[env.staging.kv_namespaces]]
binding = "KV"
id = "ce8afe4605464683a51bf6ae9c042c01"
```

## R2 buckets

| Name | Purpose |
|------|---------|
| `mbfd-bid-audit` | Hash-chained immutable audit log JSONL chunks (Plan 08) |
| `mbfd-bid-imports` | Admin CSV/PDF uploads (Plan 02) |
| `mbfd-bid-exports` | Generated roster PDFs + audit CSV exports (Plan 08) |
| `mbfd-bid-logs` | Logpush sink (Plan 09) |

R2 jurisdiction-specific S3-compatible endpoint:
```
https://265122b6d6f29457b0ca950c55f3ac6e.r2.cloudflarestorage.com
```

`wrangler.toml` snippet:
```toml
[[env.staging.r2_buckets]]
binding = "AUDIT"
bucket_name = "mbfd-bid-audit"

[[env.staging.r2_buckets]]
binding = "IMPORTS"
bucket_name = "mbfd-bid-imports"

[[env.staging.r2_buckets]]
binding = "EXPORTS"
bucket_name = "mbfd-bid-exports"

[[env.staging.r2_buckets]]
binding = "LOGS"
bucket_name = "mbfd-bid-logs"
```

## Production setup (when ready)

Repeat the same `wrangler d1 create`, `wrangler kv namespace create`, and
`wrangler r2 bucket create` commands swapping `staging` → `production`.
Capture IDs in `docs/setup-production.md`.

## Secrets

Wrangler secrets are bound per-worker. The worker doesn't exist yet (created
in Plan 01 Task 4). When you reach Plan 01 Task 12 (Deploy), run:

```bash
./scripts/setup-cf-secrets.sh staging
```

That script prompts for each secret value (hidden input) and writes via
`wrangler secret put`. No values touch source.

Required secrets (per env):

| Name | Purpose | Plan |
|------|---------|------|
| `JWT_SIGNING_KEY` | HS256 JWT signing (32-byte hex) | 01 |
| `PIN_HASH` | bcrypt of access PIN (default 2300) | 01 |
| `PORTAL_BID_READER` | Portal `/verify-credentials` service token | 01 |
| `PORTAL_BID_WRITER` | Portal `/bid-assignment` service token | 08 |
| `ANTHROPIC_API_KEY` | AI Gateway → Anthropic | 06 |
| `AUDIT_SIGNING_PRIVKEY` | ed25519 private key for R2 audit chunks | 08 |

Generators:

```bash
# JWT_SIGNING_KEY (32-byte hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# PIN_HASH (bcrypt of "2300")
node -e "require('bcryptjs').then?.(b=>b.hash('2300',12).then(console.log)) || console.log(require('bcryptjs').hashSync('2300',12))"

# AUDIT_SIGNING_PRIVKEY (ed25519)
openssl genpkey -algorithm Ed25519 | head -c -1
```

## GitHub Actions secrets

Already configured (2026-05-17). To list:

```bash
gh secret list --repo pdarleyjr/mbfd-bid --app actions
```

Configured:
- `CLOUDFLARE_API_TOKEN` (Wrangler API token)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_R2_TOKEN`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `E2E_JWT_SIGNING_KEY` (generated fresh during setup)

To rotate any of these:
```bash
echo "NEW_VALUE" | gh secret set NAME --repo pdarleyjr/mbfd-bid --app actions
```

## DNS (manual setup — when ready to deploy)

Add these in the `mbfdhub.com` zone via Cloudflare dashboard or `wrangler`:

| Hostname | Type | Target | Proxied | Notes |
|----------|------|--------|---------|-------|
| `staging.bid.mbfdhub.com` | CNAME | `<pages-project>.pages.dev` | yes | After first `pages deploy` |
| `api.staging.bid.mbfdhub.com` | Worker route | `mbfd-bid-worker-staging` | n/a | Set in wrangler.toml |
| `bid.mbfdhub.com` | CNAME | `<pages-project>.pages.dev` | yes | Production |
| `api.bid.mbfdhub.com` | Worker route | `mbfd-bid-worker-production` | n/a | Production |
