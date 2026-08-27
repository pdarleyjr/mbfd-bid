#!/usr/bin/env bash
# Rotate the shared staging JWT key for the API and OpenNext Web Workers.
#
# This script is deliberately staging-only. It never accepts an environment
# argument, never reads an existing key, and never prints the generated key.
# A failed write may still have reached Cloudflare, so any failure after the
# first attempted write is reported as PARTIAL_OR_INDETERMINATE for human
# recovery rather than retried automatically.

set -euo pipefail
set +x

readonly API_WORKER="mbfd-bid-worker-staging"
readonly WEB_WORKER="mbfd-bid-web-staging-opennext"
readonly API_DIR="apps/worker"
readonly WEB_DIR="apps/web"
readonly CONFIRMATION="--confirm-staging-jwt-rotation"

jwt_value=""

cleanup() {
  jwt_value=""
  unset jwt_value
}
trap cleanup EXIT

usage() {
  printf '%s\n' "Usage: $0 $CONFIRMATION" >&2
  printf '%s\n' "This rotates only the shared staging JWT pair on the two named staging Workers." >&2
}

fail_preflight() {
  printf 'STAGING_JWT_ROTATION_PRECHECK_FAILED: %s\n' "$1" >&2
  exit 1
}

fail_after_write_attempt() {
  printf 'STAGING_JWT_ROTATION_FAILED: %s\n' "$1" >&2
  printf '%s\n' "PARTIAL_OR_INDETERMINATE" >&2
  exit 1
}

secret_list_has_jwt() {
  local worker_dir="$1"
  local worker_name="$2"
  local secret_list

  if ! secret_list="$(pnpm --dir "$worker_dir" exec wrangler secret list --name "$worker_name" --format json)"; then
    return 2
  fi

  if ! printf '%s' "$secret_list" | node --input-type=module -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const entries = JSON.parse(input);
        process.exit(Array.isArray(entries) && entries.some((entry) => entry?.name === "JWT_SIGNING_KEY") ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  '; then
    unset secret_list
    return 1
  fi

  unset secret_list
  return 0
}

secret_list_is_reachable() {
  local worker_dir="$1"
  local worker_name="$2"

  # Keep the name/type JSON out of stdout during preflight. A missing key is
  # acceptable here because this helper can repair a missing Web-side key.
  pnpm --dir "$worker_dir" exec wrangler secret list --name "$worker_name" --format json >/dev/null
}

if [[ "$#" -ne 1 || "$1" != "$CONFIRMATION" ]]; then
  usage
  exit 64
fi

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  fail_preflight "This staging-only helper refuses to run inside GitHub Actions."
fi

if [[ ! -d "$API_DIR" || ! -d "$WEB_DIR" ]]; then
  fail_preflight "Run from the repository root with both app directories present."
fi

# Confirm that the authenticated Wrangler context can inspect each exact Worker
# before a new value is generated or either secret is changed. A missing key is
# not a preflight failure: the post-write checks below must establish it by name.
if ! secret_list_is_reachable "$API_DIR" "$API_WORKER"; then
  fail_preflight "Could not inspect $API_WORKER by secret name."
fi
if ! secret_list_is_reachable "$WEB_DIR" "$WEB_WORKER"; then
  fail_preflight "Could not inspect $WEB_WORKER by secret name."
fi

jwt_value="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"));')"
if [[ ! "$jwt_value" =~ ^[[:xdigit:]]{64}$ ]]; then
  fail_preflight "Generated JWT key did not have the expected 32-byte hex shape."
fi

# Use fully qualified Worker names without an environment selector so Wrangler
# cannot resolve a suffixed name differently. No retry or rollback is safe here.
if ! printf '%s' "$jwt_value" | pnpm --dir "$API_DIR" exec wrangler secret put JWT_SIGNING_KEY --name "$API_WORKER"; then
  fail_after_write_attempt "API Worker write returned an error."
fi
if ! secret_list_has_jwt "$API_DIR" "$API_WORKER"; then
  fail_after_write_attempt "API Worker name-only verification failed."
fi

if ! printf '%s' "$jwt_value" | pnpm --dir "$WEB_DIR" exec wrangler secret put JWT_SIGNING_KEY --name "$WEB_WORKER"; then
  fail_after_write_attempt "Web Worker write returned an error."
fi
if ! secret_list_has_jwt "$WEB_DIR" "$WEB_WORKER"; then
  fail_after_write_attempt "Web Worker name-only verification failed."
fi

printf '%s\n' "STAGING_JWT_PAIR_ROTATED_AND_NAME_VERIFIED"
