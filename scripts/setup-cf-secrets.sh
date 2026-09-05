#!/usr/bin/env bash
# Interactive non-JWT secret bootstrapper for Cloudflare workers.
# Run once per env (staging, production) when the worker is first deployed.
# Inputs are read with -s (no echo); values are piped straight to `wrangler secret put`.
# JWT_SIGNING_KEY is intentionally excluded: staging JWT rotation must update
# the API and OpenNext Web Workers together via rotate-staging-jwt-pair.sh.

set -euo pipefail

if [[ "${1:-}" != "staging" && "${1:-}" != "production" ]]; then
  echo "Usage: $0 <staging|production>" >&2
  exit 1
fi

ENV="$1"
WORKER_DIR="apps/worker"

if [[ ! -d "$WORKER_DIR" ]]; then
  echo "❌ $WORKER_DIR not found. Run from repo root after Plan 01 Task 4 lands the worker." >&2
  exit 1
fi

cat <<'EOF'
This script sets the Wrangler secrets required by the bid worker.
Each value is read with hidden input. Leave blank to skip a secret
(only useful when re-running and a particular value is already set).

EOF

declare -A SECRETS=(
  [PORTAL_BID_READER]="Portal service token for POST /api/v2/verify-credentials"
  [AUDIT_SIGNING_PRIVKEY]="ed25519 private key (PEM) for R2 audit chunk signatures. Plan 08 — can skip until then."
)

# Preserve insertion order
ORDER=(PORTAL_BID_READER AUDIT_SIGNING_PRIVKEY)

# The shared local-admin account is a staging-only bootstrap mechanism for a
# missing member-PIN record. Never configure it for production.
if [[ "$ENV" == "staging" ]]; then
  SECRETS[LOCAL_ADMIN_PASSWORD_HASH]="bcrypt digest of the staging-only local admin password; never enter the plaintext here"
  ORDER+=(LOCAL_ADMIN_PASSWORD_HASH)
fi

# Staging must never receive portal write capability. Production writer setup,
# if separately authorized, is intentionally not part of this bootstrapper.

pushd "$WORKER_DIR" > /dev/null

for name in "${ORDER[@]}"; do
  echo "── $name ──"
  echo "${SECRETS[$name]}"
  read -rsp "Value (hidden, empty=skip): " value
  echo
  if [[ -n "$value" ]]; then
    printf '%s' "$value" | pnpm dlx wrangler secret put "$name" --env "$ENV"
    echo
  else
    echo "  (skipped)"
  fi
  unset value
  echo
done

popd > /dev/null

echo "✅ Done. List with: pnpm --filter @mbfd/worker exec wrangler secret list --env $ENV"
