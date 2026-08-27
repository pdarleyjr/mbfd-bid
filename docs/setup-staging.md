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
# Non-JWT API-worker bootstrap only.
./scripts/setup-cf-secrets.sh staging
```

That script prompts for each secret value (hidden input) and writes via
`wrangler secret put`. No values touch source. It intentionally cannot rotate
`JWT_SIGNING_KEY`; it is not part of the 2026-08-27 staging deployment
procedure.

Required secrets (per env):

| Name | Purpose | Plan |
|------|---------|------|
| `JWT_SIGNING_KEY` | HS256 JWT signing (32-byte hex) | 01 |
| `LOCAL_ADMIN_PASSWORD_HASH` | bcrypt digest for the staging-only `admin` login; never document the plaintext password | 02 |
| `PORTAL_BID_READER` | Portal `/verify-credentials` service token | 01 |
| `AUDIT_SIGNING_PRIVKEY` | ed25519 private key for R2 audit chunks | 08 |

The OpenNext Web Worker is a separate Worker and must also have its own
`JWT_SIGNING_KEY` staging secret with the same approved staging value as the
API Worker. It verifies the API-issued JWT server-side for session finalization
and protected pages. Treat either Worker missing that secret as a staging auth
misconfiguration, not as an invalid user credential. Check secret names only;
never retrieve, print, or copy an existing secret value. A permitted secret
rotation must update the two staging Workers together through the approved
staging-only helper:

```bash
bash ./scripts/rotate-staging-jwt-pair.sh --confirm-staging-jwt-rotation
```

The helper accepts no environment selector and targets only
`mbfd-bid-worker-staging` and `mbfd-bid-web-staging-opennext`. It generates the
one shared replacement value in memory, never retrieves or prints a value, and
verifies secret names after each write. Any failure after a write attempt is
`PARTIAL_OR_INDETERMINATE` and requires a deliberate recovery decision rather
than an automatic retry. Secret writes create staging Worker versions; they do
not require a source deployment or a D1 migration.

`PORTAL_BID_WRITER` is intentionally absent from staging while
`PORTAL_WRITEBACK_ENABLED=false`. Retired AI configuration is not a required
staging secret.

The member access PIN is not a Wrangler secret. It is the single canonical KV
record `settings:member_bid_pin`, initialized or rotated only through an
authenticated staging Bid admin settings request. The current staging value is
**2300**. It is an explicitly configured value, never a source-code default or
fallback. When the record is missing, malformed, or unavailable, verification
returns `PIN_NOT_CONFIGURED` with HTTP 503. The application does not restore or
assume 2300.

Administrators change the PIN through **Admin → Settings → Bid Access PIN**.
The newly saved valid 4–8 digit value becomes canonical immediately; a prior
value (including 2300) must fail. `/admin-bootstrap` may only perform the
staging one-time recovery path and returns `PIN_ALREADY_CONFIGURED` without
overwriting a valid record.

Generator for the non-JWT audit signing key:

```bash
# AUDIT_SIGNING_PRIVKEY (ed25519)
openssl genpkey -algorithm Ed25519 | head -c -1
```

## GitHub Actions status

GitHub Actions are unavailable through approximately 2026-09-01. Do not
invoke, dispatch, rerun, wait for, configure, or rely on Actions for this
staging procedure. Use the documented local validation and direct,
authenticated Cloudflare staging operations instead.

## DNS (manual setup — when ready to deploy)

Add these in the `mbfdhub.com` zone via Cloudflare dashboard or `wrangler`:

| Hostname | Type | Target | Proxied | Notes |
|----------|------|--------|---------|-------|
| `staging.bid.mbfdhub.com` | Worker custom domain | `mbfd-bid-web-staging-opennext` | n/a | Active staging OpenNext Web Worker; do not detach or recreate the mapping. The legacy `mbfd-bid-web-staging` Pages project is rollback material only and is never a routine staging deployment target. |
| `api.staging.bid.mbfdhub.com` | Worker route | `mbfd-bid-worker-staging` | n/a | Set in wrangler.toml |
| `bid.mbfdhub.com` | CNAME | `<pages-project>.pages.dev` | yes | Production |
| `api.bid.mbfdhub.com` | Worker route | `mbfd-bid-worker-production` | n/a | Production |
