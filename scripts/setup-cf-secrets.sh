#!/usr/bin/env bash
# Interactive non-JWT secret bootstrapper for Cloudflare workers.
# Requires an explicitly authorized production secret change.
# Inputs are read with -s (no echo); values are piped straight to `wrangler secret put`.
# JWT_SIGNING_KEY is intentionally excluded: an authorized rotation must update
# the production API and Web Workers together and prove a fresh login.

set -euo pipefail

if [[ "${1:-}" != "production" ]]; then
  echo "Usage: $0 production" >&2
  exit 1
fi

BID_ENVIRONMENT="$1"
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
  [PORTAL_BID_FEDERATION_TOKEN]="Dedicated Hub service token for Bid authorization code exchange and identity revalidation"
  [AUDIT_SIGNING_PRIVKEY]="ed25519 private key (PEM) for R2 audit chunk signatures. Plan 08 — can skip until then."
)

# Preserve insertion order
ORDER=(PORTAL_BID_FEDERATION_TOKEN AUDIT_SIGNING_PRIVKEY)

# Production writer setup is intentionally outside this bootstrapper.

pushd "$WORKER_DIR" > /dev/null

for name in "${ORDER[@]}"; do
  echo "── $name ──"
  echo "${SECRETS[$name]}"
  read -rsp "Value (hidden, empty=skip): " value
  echo
  if [[ -n "$value" ]]; then
    printf '%s' "$value" | pnpm exec wrangler secret put "$name" --env "$BID_ENVIRONMENT"
    echo
  else
    echo "  (skipped)"
  fi
  unset value
  echo
done

popd > /dev/null

echo "✅ Done. List names with: pnpm --filter @mbfd/worker exec wrangler secret list --env $BID_ENVIRONMENT"
