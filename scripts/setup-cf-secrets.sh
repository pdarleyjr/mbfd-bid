#!/usr/bin/env bash
# Interactive secret bootstrapper for Cloudflare workers.
# Run once per env (staging, production) when the worker is first deployed.
# Inputs are read with -s (no echo); values are piped straight to `wrangler secret put`.

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
  [JWT_SIGNING_KEY]="HS256 signing key, 64-char hex. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  [PIN_HASH]="bcrypt of the access PIN. Default PIN is 2300. Generate: node -e \"console.log(require('bcryptjs').hashSync('2300',12))\""
  [PORTAL_BID_READER]="Portal service token for POST /api/v2/verify-credentials"
  [PORTAL_BID_WRITER]="Portal service token for POST /api/v2/members/:emp/bid-assignment (Plan 08 — can skip until then)"
  [ANTHROPIC_API_KEY]="Anthropic API key (sk-ant-...) for AI Gateway. Plan 06 — can skip until then."
  [AUDIT_SIGNING_PRIVKEY]="ed25519 private key (PEM) for R2 audit chunk signatures. Plan 08 — can skip until then."
)

# Preserve insertion order
ORDER=(JWT_SIGNING_KEY PIN_HASH PORTAL_BID_READER PORTAL_BID_WRITER ANTHROPIC_API_KEY AUDIT_SIGNING_PRIVKEY)

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
