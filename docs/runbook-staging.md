# Staging Runbook

## Domains

- Web: https://staging.bid.mbfdhub.com (after DNS configured)
- API:  https://api.staging.bid.mbfdhub.com (after DNS configured)

## How to deploy

Automatic on push to `main` via `.github/workflows/deploy-staging.yml`.
Manual: `gh workflow run deploy-staging.yml`.

Two parallel jobs:
1. `deploy-worker` — applies D1 migrations, then `wrangler deploy --env staging`.
2. `deploy-web` — `opennextjs-cloudflare build && deploy --env staging`.

## How to rotate the PIN

```bash
cd apps/worker
# Generate a sha256 hash of the new PIN locally (or bcrypt — see security plan)
node -e "console.log(require('crypto').createHash('sha256').update('NEW_PIN').digest('hex'))"
# Pipe to wrangler
pnpm dlx wrangler secret put PIN_HASH --env staging
# Redeploy
gh workflow run deploy-staging.yml
```

## How to rotate the JWT signing key

```bash
# Generate a 64-char hex key (32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Pipe to wrangler
pnpm dlx wrangler secret put JWT_SIGNING_KEY --env staging
# Also update the Pages env var via Cloudflare dashboard (Pages → mbfd-bid → Settings → Environment variables)
gh workflow run deploy-staging.yml
```

After rotation, all existing sessions are invalidated. Members re-login.

## How to view logs

```bash
pnpm dlx wrangler tail mbfd-bid-worker-staging --env staging
```

## How to wipe staging D1

```bash
pnpm dlx wrangler d1 execute mbfd-bid-staging --remote --env staging --command \
  "DELETE FROM schema_meta; INSERT INTO schema_meta(key,value) VALUES ('plan','01'),('schema_version','0001');"
```

For full Plan 02+ schema wipe, drop tables and re-run migrations.

## How to verify staging is healthy

```bash
curl https://api.staging.bid.mbfdhub.com/api/health
# Expect: {"ok":true,"env":"staging","ts":...}

curl -I https://staging.bid.mbfdhub.com/
# Expect: 200 OK, returns the PIN form HTML
```

## Common failure modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Worker deploy fails with `Couldn't find D1 DB` | Migration step needs `--env staging` flag | Verify `apps/worker/wrangler.toml` has `[[env.staging.d1_databases]]` |
| Pages deploy fails with module resolution errors | pnpm `node-linker=isolated` issue with OpenNext | Add `public-hoist-pattern[]` for `*next*`, `*react*` in `apps/web/.npmrc` |
| `/lobby` returns 500 in dev | Known Next 15.0.3 + React 19 RC RSC bug | Already mitigated — `runtime = 'edge'` removed (W10) |
| E2E happy-path skipped | `JWT_SIGNING_KEY` not set | Set in `apps/web/.env.test` for local, in GitHub Actions secrets for CI |
