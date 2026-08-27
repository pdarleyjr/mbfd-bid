# Staging Runbook

## Domains

- Web: https://staging.bid.mbfdhub.com (after DNS configured)
- API:  https://api.staging.bid.mbfdhub.com (after DNS configured)

## How to deploy

GitHub Actions are unavailable through approximately 2026-09-01. Do not
invoke, dispatch, rerun, wait for, or rely on Actions for staging evidence or
deployment.

Build the exact commit in the proven clean Linux Node 22 / pnpm 9.12 path,
then deploy only the required staging Worker artifact directly with the
authenticated Cloudflare CLI. The Web target is the OpenNext Worker
`mbfd-bid-web-staging-opennext`, not a Pages project. Deploy the API Worker
only when API source or configuration genuinely changed; secret rotation alone
does not require an API source deployment. Confirm D1 migrations before any
API deployment and do not modify D1 when none are pending.

## How to rotate the PIN

The current staging Bid access PIN is **2300**. It is an explicit canonical KV
setting at `settings:member_bid_pin`, not a deploy-time value or a source-code
fallback. Enter it at the PIN gate, then complete normal authentication.

Administrators rotate the PIN through **Admin → Settings → Bid Access PIN**.
If an administrator changes it to another valid 4–8 digit PIN, that new value
becomes authoritative immediately and 2300 stops working. If the canonical
record is missing, malformed, or unavailable, verification fails closed with
`PIN_NOT_CONFIGURED` (503); the application must not restore or assume 2300.
Use `/admin-bootstrap` only for the documented one-time recovery path and
never to overwrite an already configured PIN.

## How to rotate the JWT signing key

Run the staging-only paired helper from the repository root:

```bash
bash ./scripts/rotate-staging-jwt-pair.sh --confirm-staging-jwt-rotation
```

It generates one new key in memory, writes it to exactly
`mbfd-bid-worker-staging` and `mbfd-bid-web-staging-opennext`, and verifies
secret names only. It has no production option, never retrieves or prints a
secret, and fails with `PARTIAL_OR_INDETERMINATE` after any attempted write
that cannot be confirmed. Each secret write creates a new staging Worker
version, even though no source deployment or D1 migration is needed. Do not
use `setup-cf-secrets.sh` for a JWT rotation.

After rotation, all existing sessions are invalidated. Verify a fresh API
login and same-origin Web session finalization before treating the pair as
operational.

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
| OpenNext deploy fails with module resolution errors | pnpm `node-linker=isolated` issue with OpenNext | Add `public-hoist-pattern[]` for `*next*`, `*react*` in `apps/web/.npmrc` |
| `/lobby` returns 500 in dev | Known Next 15.0.3 + React 19 RC RSC bug | Already mitigated — `runtime = 'edge'` removed (W10) |
| E2E happy-path skipped | `JWT_SIGNING_KEY` not set | Set it only in the local test environment; GitHub Actions are unavailable and are not a staging release gate |
