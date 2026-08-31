# Staging configuration and release-guard remediation

## Objective

Remove the configuration and automation prerequisites that block a later, separately authorized staging D1 migration and candidate deployment.

## 2026-08-31 update

The controlled staging sequence completed mock disposition, backup retrieval/hash verification, migrations through `0037`, exact-candidate Linux/OpenNext deployment, and fresh PIN/API/browser authentication. Production remains explicitly out of scope. The remaining staging acceptance gate is a real configuration dependency: no designated annual configuration or authoritative staffing baseline exists, so a fresh mock must not be created by direct D1 mutation.

## Boundaries

Do not apply migrations `0024`–`0037`, alter migration SQL or the D1 ledger, deploy the reviewed application candidate, touch production, enable portal writeback, create `PORTAL_BID_WRITER`, or change MBFD Hub, Media Control, GMKtec, Docker, tunnel, DNS, or shared infrastructure.

## Current progress

The ordinary staging deployment workflow now has a read-only D1-ledger guard and no migration-apply command. Secret rotation and the staging backup bucket remain pending because staging has an active mock `position_bid` session; an operator-safe maintenance window must be confirmed before any Cloudflare mutation.

## Required validation

Frozen install, lint, package builds, typecheck, full tests, backup preflight, migration-hash comparison, dependency audit, diff/secret/artifact review, and the deployment-guard static test. GitHub-hosted Actions remain an unavailable evidence gate until account minutes recover.

## Preserved reliability checkpoint

The prior checkpoint covered the Cloudflare Vitest / Durable Object reliability candidate: Workers Vitest v1 migration, genuine Durable Object eviction, and standard-WebSocket recovery coverage. Its non-goals were all staging, production, portal-publication, GitHub Actions, remote D1, deployment, MBFD Hub, Media Control, GMKtec, Docker, tunnel, and DNS changes. It required local deterministic gates, managed local D1 proofs, native Linux/OpenNext root-200 proof, and a P0/P1-free read-only review before its separate staging D1 migration-risk architecture review.
