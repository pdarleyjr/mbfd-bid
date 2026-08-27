# Staging Cloudflare Resources — One-Time Setup

> Current staging checkpoint: 2026-08-27. The active staging Worker uses the
> v2 R2 audit/export buckets and a Worker custom domain. Historical Plan 01
> material below is not an instruction to recreate or detach existing resources.

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
| `mbfd-bid-audit-staging-v2` | Active `R2_AUDIT` binding for staging audit chunks |
| `mbfd-bid-exports-staging-v2` | Active `R2_EXPORTS` binding for staging exports |

R2 jurisdiction-specific S3-compatible endpoint:
```
https://265122b6d6f29457b0ca950c55f3ac6e.r2.cloudflarestorage.com
```

`wrangler.toml` snippet:
```toml
[[env.staging.r2_buckets]]
binding = "R2_AUDIT"
bucket_name = "mbfd-bid-audit-staging-v2"

[[env.staging.r2_buckets]]
binding = "R2_EXPORTS"
bucket_name = "mbfd-bid-exports-staging-v2"

# The existing `[env.staging]` inline `vars` map includes:
# R2_EXPORTS_BUCKET_NAME = "mbfd-bid-exports-staging-v2"
```

## Production setup (when ready)

Repeat the same `wrangler d1 create`, `wrangler kv namespace create`, and
`wrangler r2 bucket create` commands swapping `staging` → `production`.
Capture IDs in `docs/setup-production.md`.

## Secrets

Wrangler secrets are bound per-worker. The staging Worker already exists; do
not rotate or recreate secrets during a routine deployment. Use the approved
secret-management workflow only when a value change is authorized.

```bash
./scripts/setup-cf-secrets.sh staging
```

That script prompts for each secret value (hidden input) and writes via
`wrangler secret put`. No values touch source. It is not part of the 2026-08-27
staging deployment procedure.

Required secrets (per env):

| Name | Purpose | Plan |
|------|---------|------|
| `JWT_SIGNING_KEY` | HS256 JWT signing (32-byte hex) | 01 |
| `LOCAL_ADMIN_PASSWORD_HASH` | bcrypt digest for the staging-only `admin` login; never document the plaintext password | 02 |
| `PORTAL_BID_READER` | Portal `/verify-credentials` service token | 01 |
| `AUDIT_SIGNING_PRIVKEY` | ed25519 private key for R2 audit chunks | 08 |

`PORTAL_BID_WRITER` is intentionally absent from staging while
`PORTAL_WRITEBACK_ENABLED=false`. Retired AI configuration is not a required
staging secret.

The member access PIN is not a Wrangler secret. It is the single KV record
`settings:member_bid_pin`, initialized or rotated only through an authenticated
staging Bid admin settings request. When the record is absent, the staging-only
`/admin-bootstrap` page uses the separately managed local-admin credential to
initialize it. Then enter that newly set PIN and sign in before using the Bid
Access PIN settings page for later rotation. There is no
environment-secret fallback and no default PIN:
when the record is missing, malformed, or unavailable, verification returns
`PIN_NOT_CONFIGURED` with HTTP 503. Generate or receive any staging-only PIN
through the approved secret channel; never put it in source, shell history,
documentation, screenshots, or test artifacts.

Generators:

```bash
# JWT_SIGNING_KEY (32-byte hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

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
| `staging.bid.mbfdhub.com` | Worker custom domain | `mbfd-bid-web-staging-opennext` | n/a | Active staging Web Worker; do not detach/recreate the mapping. The `mbfd-bid-web-staging` Pages project is retained only as rollback material. |
| `api.staging.bid.mbfdhub.com` | Worker route | `mbfd-bid-worker-staging` | n/a | Set in wrangler.toml |
| `bid.mbfdhub.com` | CNAME | `<pages-project>.pages.dev` | yes | Production |
| `api.bid.mbfdhub.com` | Worker route | `mbfd-bid-worker-production` | n/a | Production |
